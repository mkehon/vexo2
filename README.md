# Zapier for AI Wearable and Hardware

**IF this happens THEN do that, for anything a sensor can pick up.**

Point a camera, a microphone, a phone, a heart-rate strap or a glucose monitor at the world, say in plain words what to watch for, and choose what happens the moment it does: your phone rings and a voice tells you, you get a text, the computer says it out loud, an alarm sounds, or a webhook fires.

```
IF   the camera sees a person standing at the door      on  Front-door stream
AND  the heart rate is above 110                        on  Polar H10
THEN call +1 415 555 0100 and say it out loud
```

Each condition is a sentence. A small, fast model ([TypeSafe](https://typesafe.ai) Jev) answers it as a yes/no probability on every frame or reading, in about a tenth of a second, so a condition is checked many times a second and the action runs as it becomes true.

## Run it

```sh
npm install
npm run dev
```

Open `http://localhost:3000`, then **Settings** in the top right corner:

- **TypeSafe** (required): detection runs on TypeSafe's Jev model.
- **Trigger sharpening** (optional): an OpenAI, Claude or Gemini key. The model turns each sentence into a sharper yes/no question (`lib/sharpen.ts`). Without one, the sentence is checked as written. An OpenAI key is also what picks words out of sound.
- **Calls and texts** (optional): an ElevenLabs key for calls, a Twilio Account SID and Auth Token for texts. See [Calls and texts](#calls-and-texts).

Keys are saved on this computer in `.vexo/keys.json`, which git ignores. Setting them in `.env.local` also works; see `.env.example`.

## Building an automation

**Add automation** opens the builder. It reads as a sentence, top to bottom.

**IF.** Each row is one condition:

1. Pick the sensor: camera, microphone, location, heart rate, glucose or motion.
2. Pick the device to watch it on. A condition can watch several devices at once ("This computer **or** iPhone") and holds when it holds on any of them.
3. Finish the sentence: "the camera sees… *a package on the doorstep*", "the glucose… *drops below 70*".

The row shows the device's live feed and the model's answer right now, so you can try the condition before arming it. **Add a condition** joins rows with **AND** (all must hold together) or **OR** (any one is enough).

**THEN.** Pick one action or several; they all run together:

| Action | What happens |
| --- | --- |
| Call me | Your phone rings. A voice agent says what happened and what the sensor read, and answers a question about it. |
| Text me | A text with the same. |
| Say it out loud | The computer running the app speaks it. |
| Sound an alarm | The computer beeps for a couple of seconds. |
| Webhook | A JSON payload is posted to an address: Slack, Discord, Zapier, your own server. |

Templates on the left fill the builder with a ready-made automation. Each automation becomes a card on the main screen with a name, its live feeds, a row per condition showing which ones hold, and its history. Cards fold down to one line. The pencil reopens the builder to change or delete one.

## Sensors and devices

| Sensor | Where it can come from | What a condition can use |
| --- | --- | --- |
| Camera | A webcam, a shared tab or window (a YouTube live stream, a glasses' companion stream, an IP camera page), a video file, a paired phone | What is in the picture |
| Sound | A microphone on the computer or a paired phone | How loud it is, and the words said in the last 15 seconds |
| Location | The computer's or a paired phone's position, or a simulator | Distance from the start, speed, time stationary, distance to places you have saved by name |
| Heart rate | A Bluetooth strap or band that broadcasts the standard heart-rate service (Chrome on a computer or Android), or a simulator | Current rate, one-minute average, five-minute range, change over 30 seconds |
| Glucose | A continuous glucose monitor through its Nightscout site, or a simulator | Level in mg/dL and mmol/L, low / in range / high, trend, change over 15 minutes |
| Motion | A paired phone's motion sensors, or a simulator | Still, moving or shaking; orientation; a drop |

Up to three cameras and two of every other sensor can be connected at the same time, each checked on its own. Simulators stand in for hardware you do not have, so any automation can be tried at a desk.

Saved places are shared between location sources: save where the computer is as "Desk", then watch for a phone being "more than 100 m from Desk".

### Your phone as a sensor

Pick **iPhone** or **Android phone** as a device and the app shows a QR code. Scanning it opens a page on the phone with a switch for its camera, microphone, location and motion. What is switched on streams to the computer, where the phone then behaves like any other device.

Office, hotel and event Wi-Fi often stops devices from reaching each other. If the page will not load on the phone, run this next to `npm run dev`:

```sh
npm run tunnel
```

It opens a public https address through a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (needs `cloudflared`), and the QR code switches to it. The phone can then be on any network, mobile data included. Only the phone's page is served there, and only a phone that scanned the code can send.

## Calls and texts

- **Calls** are placed by an [ElevenLabs](https://elevenlabs.io) voice agent from a Twilio number imported into your ElevenLabs account. Paste an ElevenLabs API key in Settings and choose the number; the app creates the agent it needs.
- **Texts** are sent through [Twilio](https://www.twilio.com) from the same number. Paste the Account SID and Auth Token of the Twilio account that owns it. In the US, carriers only deliver texts from a number registered for A2P 10DLC.

Settings has a **Try it on your phone** box to check both. The same phone is not called again within 30 seconds, or texted within 10, so an automation that keeps firing does not keep ringing.

## How it works

1. **Sense.** A camera, shared tab or file plays in a `<video>` element (`lib/useVideoSource.ts`). Every other sensor works a small JSON reading out on the device (`lib/sensor-hooks/`, fields in `lib/sensors.ts`). A paired phone posts frames and readings to a relay on the computer (`lib/relay.ts`, `app/phone`).
2. **Check.** Each condition, on each device it watches, is a yes/no question sent to Jev with the latest frame (`lib/useWatcher.ts`, `app/api/watch`) or reading (`lib/useStateWatcher.ts`, `app/api/judge`). The answer is a probability. Frames are only sent when the picture changes, plus a slow heartbeat.
3. **Decide.** 70% or more is a yes, 30% or less is a no, anything between changes nothing, and two readings in a row are needed to change state (`lib/trigger.ts`). Conditions are then combined with AND or OR, and the automation fires on the change from not-true to true (`lib/useStudio.ts`).
4. **Act.** Every action of the automation runs at once and the result is logged (`lib/useStudio.ts`, `app/api/notify`, `app/api/webhook`, `lib/reach.ts`).

Automations are saved in the browser's local storage, so each browser keeps its own list. `PORT` and `PHONE_PORT` change the two ports `npm run dev` uses.

## Deploying

The app runs on any host that supports Next.js. Settings only saves keys on your own computer, so a hosted copy takes them from environment variables (all listed in `.env.example`):

- `TYPESAFE_API_KEY`, and optionally `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`.
- For calls and texts: `ELEVENLABS_API_KEY`, `ELEVENLABS_PHONE_NUMBER_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- `VEXO_PASSWORD`: when set, the whole site asks for this password before showing anything (`proxy.ts`). Any username works. Set it on any public deployment, because every check is paid for with the server's keys.

A hosted copy uses the sensors of whatever device opens it: open it on a phone and the phone's own camera, microphone, location and motion are there. Pairing a second device as a sensor needs the app running on your own computer.

## Built with

Next.js, React and Tailwind; TypeSafe Jev for detection; OpenAI, Anthropic or Google models to sharpen sentences; OpenAI speech-to-text; ElevenLabs Agents and Twilio to reach a phone.
