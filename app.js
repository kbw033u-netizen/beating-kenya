const steps = 16;
const tracks = [
  { id: "kick", name: "Kick", symbol: "K", type: "kick", volume: 0.9 },
  { id: "snare", name: "Snare / clap", symbol: "S", type: "snare", volume: 0.55 },
  { id: "hat", name: "Closed hat", symbol: "H", type: "hat", volume: 0.27 },
  { id: "openHat", name: "Open hat", symbol: "O", type: "openHat", volume: 0.25 },
  { id: "perc", name: "Perc", symbol: "P", type: "perc", volume: 0.32 },
  { id: "bass", name: "808 bass", symbol: "8", type: "bass", volume: 0.58 },
];

const grooves = {
  dandora: {
    kick: [0, 6, 10, 14], snare: [4, 12], hat: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
    openHat: [11], perc: [3, 9, 14], bass: [0, 6, 10, 14],
  },
  matatu: {
    kick: [0, 5, 8, 11, 14], snare: [4, 12], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14],
    openHat: [7, 15], perc: [2, 9, 13], bass: [0, 5, 8, 11, 14],
  },
  estate: {
    kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [14], perc: [6, 11], bass: [0, 7, 10, 14],
  },
};

const patterns = Object.fromEntries(tracks.map((track) => [track.id, Array(steps).fill(false)]));
let audioContext;
let noiseBuffer;
let isPlaying = false;
let timerId;
let nextStepTime = 0;
let currentStep = 0;
let activeTimeouts = [];
let visualEnergy = 0;
let animationId;
let sourceFile;
let sourceUrl;
let mediaRecorder;
let recordingStream;
let recordingParts = [];
let recordingTimeout;

const trackRows = document.querySelector("#trackRows");
const tempoInput = document.querySelector("#tempo");
const swingInput = document.querySelector("#swing");
const keySelect = document.querySelector("#keySelect");
const canvas = document.querySelector("#visualizer");
const canvasContext = canvas.getContext("2d");

function renderTracks() {
  trackRows.innerHTML = tracks.map((track) => `
    <div class="track-row" data-track="${track.id}">
      <div class="track-name"><span class="track-symbol">${track.symbol}</span>${track.name}<small>16</small></div>
      ${Array.from({ length: steps }, (_, index) => `<button class="step" type="button" data-step="${index}" aria-label="${track.name}, step ${index + 1}, off" aria-pressed="false"></button>`).join("")}
    </div>
  `).join("");
}

function renderPattern() {
  for (const track of tracks) {
    const row = trackRows.querySelector(`[data-track="${track.id}"]`);
    row.querySelectorAll(".step").forEach((button, index) => {
      const enabled = patterns[track.id][index];
      button.classList.toggle("is-on", enabled);
      button.classList.toggle("accent", enabled && (track.id === "snare" || track.id === "kick"));
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute("aria-label", `${track.name}, step ${index + 1}, ${enabled ? "on" : "off"}`);
    });
  }
}

function loadGroove(name) {
  for (const track of tracks) {
    patterns[track.id] = Array.from({ length: steps }, (_, index) => grooves[name][track.id].includes(index));
  }
  renderPattern();
}

function setPlayhead(step) {
  trackRows.querySelectorAll(".step.is-current").forEach((button) => button.classList.remove("is-current"));
  trackRows.querySelectorAll(`[data-step="${step}"]`).forEach((button) => button.classList.add("is-current"));
  document.querySelector("#barCount").innerHTML = `BAR 01 <b>·</b> BEAT ${String(Math.floor(step / 4) + 1).padStart(2, "0")}`;
}

function makeNoiseBuffer() {
  const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function playNoise(time, duration, frequency, volume) {
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = noiseBuffer;
  filter.type = "highpass";
  filter.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start(time);
  source.stop(time + duration);
}

function playKick(time, volume) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(150, time);
  oscillator.frequency.exponentialRampToValueAtTime(43, time + 0.14);
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.42);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.43);
}

function playSnare(time, volume) {
  playNoise(time, 0.19, 1100, volume * 0.75);
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(190, time);
  gain.gain.setValueAtTime(volume * 0.22, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.12);
}

function playBass(time, volume, step) {
  const notes = { C: 130.81, D: 146.83, F: 174.61, G: 196, A: 220 };
  const root = notes[keySelect.value];
  const offsets = [0, 0, 3, 0, 7, 0, 10, 0, 5, 0, 3, 0, 7, 0, 10, 0];
  const frequency = root * 0.5 * Math.pow(2, offsets[step] / 12);
  const oscillator = audioContext.createOscillator();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(frequency, time);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(240, time);
  filter.frequency.exponentialRampToValueAtTime(75, time + 0.2);
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.27);
  oscillator.connect(filter).connect(gain).connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.28);
}

function triggerTrack(track, time, step) {
  if (track.type === "kick") playKick(time, track.volume);
  if (track.type === "snare") playSnare(time, track.volume);
  if (track.type === "hat") playNoise(time, 0.045, 6500, track.volume);
  if (track.type === "openHat") playNoise(time, 0.22, 4300, track.volume);
  if (track.type === "perc") playNoise(time, 0.075, 1800, track.volume);
  if (track.type === "bass") playBass(time, track.volume, step);
}

function scheduleStep(step, time) {
  tracks.forEach((track) => {
    if (patterns[track.id][step]) triggerTrack(track, time, step);
  });
  const delay = Math.max(0, (time - audioContext.currentTime) * 1000);
  activeTimeouts.push(window.setTimeout(() => {
    if (!isPlaying) return;
    setPlayhead(step);
    visualEnergy = 1;
  }, delay));
}

function scheduler() {
  while (nextStepTime < audioContext.currentTime + 0.12) {
    scheduleStep(currentStep, nextStepTime);
    const baseDuration = 60 / Number(tempoInput.value) / 4;
    const swing = Number(swingInput.value) / 100 * 0.6;
    nextStepTime += baseDuration * (currentStep % 2 === 0 ? 1 + swing : 1 - swing);
    currentStep = (currentStep + 1) % steps;
  }
}

async function startPlayback() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuffer = makeNoiseBuffer();
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  if (isPlaying) return;
  isPlaying = true;
  currentStep = 0;
  nextStepTime = audioContext.currentTime + 0.05;
  document.querySelector("#playLabel").textContent = "PLAYING";
  document.querySelector("#liveIndicator").classList.add("is-playing");
  timerId = window.setInterval(scheduler, 25);
  scheduler();
}

async function loadAudioSource(file) {
  sourceFile = file;
  document.querySelector("#analyzeButton").disabled = true;
  document.querySelector("#sourceStatus").textContent = `Ready: ${file.name}`;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  const preview = document.querySelector("#sourcePreview");
  preview.src = sourceUrl;
  preview.hidden = false;
  document.querySelector("#analyzeButton").disabled = false;
}

async function toggleRecording() {
  const recordButton = document.querySelector("#recordButton");
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    document.querySelector("#sourceStatus").textContent = "Microphone recording is not supported in this browser.";
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingParts = [];
    mediaRecorder = new MediaRecorder(recordingStream);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordingParts.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      window.clearTimeout(recordingTimeout);
      recordingStream.getTracks().forEach((track) => track.stop());
      recordButton.textContent = "RECORD";
      const recording = new File(recordingParts, "beat-reference.webm", { type: mediaRecorder.mimeType || "audio/webm" });
      loadAudioSource(recording);
    }, { once: true });
    mediaRecorder.start();
    recordButton.textContent = "STOP RECORDING";
    document.querySelector("#sourceStatus").textContent = "Recording from your microphone. Maximum 30 seconds.";
    recordingTimeout = window.setTimeout(() => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, 30000);
  } catch (error) {
    document.querySelector("#sourceStatus").textContent = error.name === "NotAllowedError"
      ? "Microphone permission was denied. You can import an audio file instead."
      : "Could not start microphone recording. Try importing an audio file.";
  }
}

async function analyzeSource() {
  if (!sourceFile) return;
  const analyzeButton = document.querySelector("#analyzeButton");
  const status = document.querySelector("#sourceStatus");
  analyzeButton.disabled = true;
  status.textContent = "Listening for the pulse...";
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(await sourceFile.arrayBuffer());
    if (audioBuffer.duration < 2 || audioBuffer.duration > 30) {
      throw new Error("Choose a clip between 2 and 30 seconds long.");
    }

    const sampleRate = Math.min(11025, audioBuffer.sampleRate);
    const ratio = audioBuffer.sampleRate / sampleRate;
    const samples = new Float32Array(Math.floor(audioBuffer.length / ratio));
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
    for (let outputIndex = 0; outputIndex < samples.length; outputIndex += 1) {
      const inputStart = Math.floor(outputIndex * ratio);
      const inputEnd = Math.min(audioBuffer.length, Math.floor((outputIndex + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let inputIndex = inputStart; inputIndex < Math.max(inputStart + 1, inputEnd); inputIndex += 1) {
        for (const channel of channels) {
          sum += channel[Math.min(inputIndex, audioBuffer.length - 1)];
          count += 1;
        }
      }
      samples[outputIndex] = sum / count;
    }

    const response = await fetch(`/api/analyze?sampleRate=${sampleRate}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: samples,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Audio analysis failed.");

    tracks.forEach((track) => { patterns[track.id] = Array(steps).fill(false); });
    for (const hit of result.hits) {
      if (hit.type === "kick") {
        patterns.kick[hit.step] = true;
        patterns.bass[hit.step] = true;
      } else if (hit.type === "snare") {
        patterns.snare[hit.step] = true;
      } else {
        patterns.hat[hit.step] = true;
      }
    }
    tempoInput.value = String(Math.max(Number(tempoInput.min), Math.min(Number(tempoInput.max), result.bpm)));
    document.querySelector("#tempoValue").value = tempoInput.value;
    renderPattern();
    status.textContent = `Found about ${result.bpm} BPM and ${result.hitCount} hits. Pattern added to the sequencer.`;
  } catch (error) {
    status.textContent = error.message || "Could not read that audio. Try another file.";
  } finally {
    analyzeButton.disabled = false;
  }
}

function stopPlayback() {
  isPlaying = false;
  window.clearInterval(timerId);
  activeTimeouts.forEach(window.clearTimeout);
  activeTimeouts = [];
  document.querySelector("#playLabel").textContent = "PLAY";
  document.querySelector("#liveIndicator").classList.remove("is-playing");
  trackRows.querySelectorAll(".step.is-current").forEach((button) => button.classList.remove("is-current"));
  document.querySelector("#barCount").innerHTML = "BAR 01 <b>·</b> BEAT 01";
}

function randomize() {
  const density = { kick: 0.21, snare: 0.12, hat: 0.57, openHat: 0.09, perc: 0.16, bass: 0.2 };
  for (const track of tracks) {
    patterns[track.id] = Array.from({ length: steps }, (_, index) => {
      if (track.id === "snare" && (index === 4 || index === 12)) return true;
      return Math.random() < density[track.id];
    });
  }
  renderPattern();
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawVisualizer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.strokeStyle = "#383c33";
  canvasContext.lineWidth = 1;
  for (let x = 0; x < width; x += 34) {
    canvasContext.beginPath();
    canvasContext.moveTo(x, 0);
    canvasContext.lineTo(x, height);
    canvasContext.stroke();
  }
  const bars = Math.max(16, Math.floor(width / 7));
  for (let index = 0; index < bars; index += 1) {
    const pulse = Math.sin(index * 0.41 + performance.now() / 430) * 0.12;
    const random = Math.sin(index * 12.9898) * 0.5 + 0.5;
    const energy = Math.max(0.08, random * (0.22 + visualEnergy * 0.7) + pulse);
    const barHeight = Math.max(2, energy * (height - 18));
    const x = index * (width / bars);
    canvasContext.fillStyle = index % 16 === 0 ? "#e35b3f" : "#d5f052";
    canvasContext.fillRect(x + 1, (height - barHeight) / 2, Math.max(1, width / bars - 3), barHeight);
  }
  visualEnergy *= 0.91;
  animationId = window.requestAnimationFrame(drawVisualizer);
}

trackRows.addEventListener("click", (event) => {
  const button = event.target.closest(".step");
  if (!button) return;
  const trackId = button.closest(".track-row").dataset.track;
  const step = Number(button.dataset.step);
  patterns[trackId][step] = !patterns[trackId][step];
  renderPattern();
});

tempoInput.addEventListener("input", () => { document.querySelector("#tempoValue").value = tempoInput.value; });
swingInput.addEventListener("input", () => { document.querySelector("#swingValue").value = swingInput.value; });
document.querySelector("#grooveSelect").addEventListener("change", (event) => loadGroove(event.target.value));
document.querySelector("#playButton").addEventListener("click", startPlayback);
document.querySelector("#stopButton").addEventListener("click", stopPlayback);
document.querySelector("#randomButton").addEventListener("click", randomize);
document.querySelector("#audioFile").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) loadAudioSource(file);
});
document.querySelector("#recordButton").addEventListener("click", toggleRecording);
document.querySelector("#analyzeButton").addEventListener("click", analyzeSource);
document.querySelector("#clearButton").addEventListener("click", () => {
  tracks.forEach((track) => { patterns[track.id] = Array(steps).fill(false); });
  renderPattern();
});
window.addEventListener("resize", resizeCanvas);

renderTracks();
loadGroove("dandora");
resizeCanvas();
drawVisualizer();