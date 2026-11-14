# vexo

If the camera sees this, then do that. Connect a video source, describe what to watch for in a sentence, and choose what happens when it is seen.

## Run it

```sh
npm install
npm run dev
```

Then open **Settings** in the top right corner and paste your API keys:

- **TypeSafe** (required): detection runs on TypeSafe's Jev model.
- **Rule sharpening** (optional): pick OpenAI, Claude or Gemini and paste that provider's key. The model rewrites each rule into a sharper yes/no question about a single frame (`lib/sharpen.ts`). Without a key, the rule uses your sentence as written.

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
