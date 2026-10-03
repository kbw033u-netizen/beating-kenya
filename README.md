# Beat / Kenya

A browser-based Kenyan trap beat sketchpad with an original drum sequencer and a short-clip beat analyzer. The analyzer estimates tempo and maps detected transients into the sequencer; it does not separate stems or reproduce a recording.

## Run locally

Requires the .NET 10 SDK.

```sh
dotnet run
```

Open the local URL printed by ASP.NET Core. Import a 2–30 second audio clip or record through your microphone, then choose **Find the groove**. Microphone access requires a secure browser context, such as localhost.