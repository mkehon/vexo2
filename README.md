# Zapier for AI Wearable and Hardware

Vision automations for wearables and hardware: when your device sees it, your apps do it. Connect a camera or any video feed, describe a trigger in a sentence, and choose the action that runs when it is seen.

## Run it

```sh
npm install
npm run dev
```

Then open **Settings** in the top right corner and paste your API keys:

- **TypeSafe** (required): detection runs on TypeSafe's Jev model.
- **Trigger sharpening** (optional): pick OpenAI, Claude or Gemini and paste that provider's key. The model rewrites each rule into a sharper yes/no question about a single frame (`lib/sharpen.ts`). Without a key, the rule uses your sentence as written.

Keys are saved on this computer in `.vexo/keys.json`, which git ignores, and are used by every device that opens the app from it. They can only be changed from this computer, not from a phone. Setting the keys in `.env.local` also works; see `.env.example`.

`npm run dev` prints two links:

- **This computer:** `http://localhost:3000`
- **Phone on the same Wi-Fi:** `https://<this computer's address>:3443`, also shown as a QR code. Browsers only allow camera access on https pages, so the phone uses an https entrance with a self-signed certificate (`scripts/dev.mjs`). The first time, the phone warns that the connection is not private: tap "Show Details", then "visit this website".

Rules are stored per device, so the phone and the computer each keep their own list.

## How it works

1. **Video** (`lib/useVideoSource.ts`): a camera, a shared screen or tab, or a video file plays in one `<video>` element.
2. **Watch** (`lib/useWatcher.ts`, `app/api/watch`): about twice a second, the current frame is sent to Jev with one yes/no question per rule. Each answer is a probability.
3. **Decide** (`lib/trigger.ts`): 70% or more is a yes, 30% or less is a no, and anything between changes nothing. A rule fires when it gets two yes readings in a row after being off, then waits until the condition has gone away before it can fire again.
4. **Act** (`app/page.tsx`, `app/api/webhook`): say a sentence out loud in the browser, or POST a JSON payload to a webhook URL such as Slack or Zapier.

Rules are saved in the browser's local storage.

Set `PORT` or `PHONE_PORT` to change the two ports.

## Sensors

Step 1 has a tab per sensor. Each one offers the real device and, where a real one is hard to come by, a simulator, so a trigger can be tried without hardware.

| Sensor | Sources | What a rule can use |
| --- | --- | --- |
| Camera | Camera, shared screen or tab, video file | What is in the picture |
| Sound | Any microphone | How loud it is, and the words said in the last 15 seconds |
| Location | The device's GPS, or a simulator | Distance from the start, speed, time spent stationary, and named places saved from the current spot |
| Heart rate | A Bluetooth strap or band that broadcasts the standard heart-rate service (Chrome on a computer or Android), or a simulator | Current rate, one-minute average, five-minute range, change over 30 seconds |
| Glucose | A continuous glucose monitor through its Nightscout site (the open-source service many Dexcom and Libre users send readings to), or a simulator | Level in mg/dL and mmol/L, low / in range / high, trend, change over 15 minutes |
| Motion | A phone's motion sensors, or a simulator | Still, moving or shaking; orientation; a drop |

The camera sends frames. Every other sensor works a small JSON reading out on the device (`lib/sensor-hooks/`, fields described in `lib/sensors.ts`) and sends that instead (`lib/useStateWatcher.ts`, `app/api/judge`). Jev answers the same kind of yes/no question about a reading as about a frame, so every sensor shares the decide and act steps below.

Words are picked out of the sound with OpenAI speech-to-text (`app/api/transcribe`), so that part needs an OpenAI key whichever provider sharpens rules. Without one, sound rules can still use loudness.

Glucose readings are fetched from the Nightscout site by the server (`app/api/glucose`), since most such sites do not let a browser on another address read them.

Webhook payloads include `sensor` and, for sensors other than the camera, the `reading` that set the rule off.

## Deploying

The app runs on any host that supports Next.js. Settings only saves keys on a developer's own computer, so a deployed copy takes them from environment variables:

- `TYPESAFE_API_KEY`, and one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`.
- `VEXO_PASSWORD`: when set, the whole site asks for this password before showing anything (`proxy.ts`). Any username works. Set it on any public deployment, because every check is paid for with the server's keys.
