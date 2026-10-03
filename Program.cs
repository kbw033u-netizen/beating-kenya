using System.Buffers.Binary;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 20 * 1024 * 1024);
var app = builder.Build();
var root = app.Environment.ContentRootPath;

app.MapGet("/", () => Results.File(Path.Combine(root, "index.html"), "text/html"));
app.MapGet("/app.js", () => Results.File(Path.Combine(root, "app.js"), "text/javascript"));
app.MapGet("/style.css", () => Results.File(Path.Combine(root, "style.css"), "text/css"));

app.MapPost("/api/analyze", async (HttpRequest request) =>
{
    const int defaultSampleRate = 11025;
    var sampleRate = defaultSampleRate;
    if (request.Query.TryGetValue("sampleRate", out var sampleRateValue)
        && (!int.TryParse(sampleRateValue.ToString(), out sampleRate) || sampleRate is < 1000 or > 48000))
        return Results.BadRequest(new { error = "Sample rate must be between 1,000 and 48,000 Hz." });

    if (request.ContentLength is > 20 * 1024 * 1024)
        return Results.BadRequest(new { error = "Audio is too large to analyze." });

    await using var stream = new MemoryStream();
    await request.Body.CopyToAsync(stream);
    var bytes = stream.ToArray();
    if (bytes.Length == 0 || bytes.Length % sizeof(float) != 0 || bytes.Length > sampleRate * 30 * sizeof(float))
        return Results.BadRequest(new { error = "Choose a recording up to 30 seconds long." });

    var samples = new float[bytes.Length / sizeof(float)];
    for (var index = 0; index < samples.Length; index++)
    {
        var bits = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(index * sizeof(float), sizeof(float)));
        samples[index] = BitConverter.Int32BitsToSingle(bits);
    }

    try
    {
        return Results.Ok(BeatAnalyzer.Analyze(samples, sampleRate));
    }
    catch (BadHttpRequestException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.Run();

static class BeatAnalyzer
{
    public static AnalysisResult Analyze(float[] samples, int sampleRate)
    {
        const int framesPerSecond = 100;
        var frameSize = sampleRate / framesPerSecond;
        var frameCount = samples.Length / frameSize;
        if (frameCount < framesPerSecond * 2)
            throw new BadHttpRequestException("Record at least two seconds of audio.");

        var energy = new double[frameCount];
        var lowEnergy = new double[frameCount];
        var highEnergy = new double[frameCount];
        var lowPass = 0.0;
        var lowPassFactor = 1 - Math.Exp(-2 * Math.PI * 180 / sampleRate);

        for (var frame = 0; frame < frameCount; frame++)
        {
            double total = 0;
            double low = 0;
            double high = 0;
            var start = frame * frameSize;
            for (var offset = 0; offset < frameSize; offset++)
            {
                var sample = Math.Clamp(samples[start + offset], -1, 1);
                lowPass += lowPassFactor * (sample - lowPass);
                var upper = sample - lowPass;
                total += sample * sample;
                low += lowPass * lowPass;
                high += upper * upper;
            }
            energy[frame] = Math.Sqrt(total / frameSize);
            lowEnergy[frame] = Math.Sqrt(low / frameSize);
            highEnergy[frame] = Math.Sqrt(high / frameSize);
        }

        var onset = new double[frameCount];
        for (var frame = 1; frame < frameCount; frame++)
            onset[frame] = Math.Max(0, energy[frame] - energy[frame - 1] * 0.7);

        var maxOnset = onset.Max();
        if (maxOnset < 0.0001)
            throw new BadHttpRequestException("No clear percussive hits found in this recording.");

        var bpm = EstimateTempo(onset, sampleRate / frameSize);
        var threshold = maxOnset * 0.16;
        var peakFrames = new List<int>();
        for (var frame = 2; frame < frameCount - 1; frame++)
        {
            if (onset[frame] < threshold || onset[frame] < onset[frame - 1] || onset[frame] <= onset[frame + 1])
                continue;
            if (peakFrames.Count > 0 && frame - peakFrames[^1] < 8)
            {
                if (onset[frame] > onset[peakFrames[^1]]) peakFrames[^1] = frame;
                continue;
            }
            peakFrames.Add(frame);
        }

        var stepFrames = (sampleRate / (double)frameSize) * 60 / bpm / 4;
        var phase = peakFrames.Count > 0 ? peakFrames[0] % stepFrames : 0;
        var hits = peakFrames.Select(frame =>
        {
            var step = ((int)Math.Round((frame - phase) / stepFrames) % 16 + 16) % 16;
            var kind = lowEnergy[frame] >= highEnergy[frame] * 0.9 ? "kick" : onset[frame] > maxOnset * 0.38 ? "snare" : "hat";
            return new DetectedHit(step, kind, (float)(onset[frame] / maxOnset));
        })
        .GroupBy(hit => (hit.Step, hit.Type))
        .Select(group => group.OrderByDescending(hit => hit.Strength).First())
        .OrderBy(hit => hit.Step)
        .ToArray();

        return new AnalysisResult(bpm, peakFrames.Count, hits);
    }

    private static int EstimateTempo(double[] onset, int framesPerSecond)
    {
        var bestBpm = 120;
        var bestScore = double.NegativeInfinity;
        for (var bpm = 180; bpm >= 60; bpm--)
        {
            var lag = (int)Math.Round(framesPerSecond * 60.0 / bpm);
            double score = 0;
            for (var frame = lag; frame < onset.Length; frame++)
                score += onset[frame] * onset[frame - lag];
            score /= onset.Length - lag;
            if (score > bestScore)
            {
                bestScore = score;
                bestBpm = bpm;
            }
        }
        return bestBpm;
    }
}

sealed record AnalysisResult(int Bpm, int HitCount, DetectedHit[] Hits);
sealed record DetectedHit(int Step, string Type, float Strength);