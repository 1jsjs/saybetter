# SayBetter Drill (watchOS)

A watch-only companion app for [SayBetter](../saybetter). SayBetter turns English you actually said
(captured by Bee) into nightly "Say it: …" Bee todos. This app closes the loop on the wrist:

1. **Today's drills** – `GET /api/drills` from the SayBetter server on the Mac.
2. **Drill** – shows the natural sentence and what you originally said. Tap **Say it**, speak (up to 8 s,
   16 kHz mono WAV), and the app transcribes, aligns word by word with the target, and shows a score
   (missed words red, near-misses orange). Pass = 80%.
3. **On pass** – `POST /api/drills/complete` → the server runs `bee todos complete <id>` and logs the
   attempt to `~/.saybetter/pronunciation.jsonl` (`source: "watch"`). The watch shows **Done in Bee ✓**.

## Transcription paths

| Setting | What runs | Where |
|---|---|---|
| `auto` (default) | WhisperKit `openai_whisper-tiny.en` on the watch; falls back to the Mac if it fails | watch, then Mac |
| `device` | WhisperKit only | watch |
| `server` | WAV uploaded to `POST /api/pronounce`; Mac runs whisper.cpp (large-v3-turbo) + alignment + Korean tips | Mac |

The result screen always prints which path produced it ("On-watch WhisperKit" or "Mac whisper.cpp").
The WhisperKit model (146 MB on disk as downloaded in the simulator) is downloaded once from Hugging Face (`argmaxinc/whisperkit-coreml`) into
the app's Documents on first use; a folder named `openai_whisper-tiny.en` in the app bundle is used instead
if present. On-device scoring is strict (exact words only; extra inserted words count against you) because
there are no per-word confidences; the server path uses whisper.cpp token probabilities.

Verified 2026-10-23 on the watchOS 27 simulator (Apple Watch Series 12 46mm): both paths ran end to end,
see `docs/`. Physical Apple Watch SE 3: build + signing OK, install blocked by the device connection (see below).

## Build

```sh
brew install xcodegen          # project is generated from project.yml
xcodegen generate
# simulator
xcodebuild -project SayBetterDrill.xcodeproj -scheme SayBetterDrill \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 12 (46mm)' -derivedDataPath build/dd build
# device (team GBM4Q27QYW, bundle id build.jinsu.saybetter.drill)
xcodebuild -project SayBetterDrill.xcodeproj -scheme SayBetterDrill -destination 'id=<watch udid>' \
  -derivedDataPath build/dd -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <watch udid> "build/dd/Build/Products/Debug-watchos/SayBetter Drill.app"
```

## Server address

Simulator default `http://localhost:4173`, device default `http://192.168.123.105:4173`.
Override with a launch argument `-server http://host:port`. The SayBetter server binds `127.0.0.1` by
default; for a real watch start it with `SAYBETTER_HOST=0.0.0.0` so the LAN IP is reachable.

## Test hooks (simulator demos)

Launch arguments: `-mode auto|device|server`, `-openFirst YES` (open the first open drill),
`-testAudio /path/to/16k.wav` (use a file instead of the microphone and run immediately).

```sh
say -o s.aiff "Can you explain how this API works?" && afconvert -f WAVE -d LEI16@16000 -c 1 s.aiff s.wav
xcrun simctl launch --console-pty <sim> build.jinsu.saybetter.drill -server http://localhost:4174 \
  -openFirst YES -testAudio "$PWD/s.wav" -mode device
```

Use a throwaway server (`SAYBETTER_HOME=<tmp>`, a fake `bee` on `PATH`) when testing, otherwise a pass
completes the real Bee todo.

## License

MIT. Uses [WhisperKit](https://github.com/argmaxinc/WhisperKit) (MIT).
