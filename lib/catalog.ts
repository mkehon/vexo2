import type { Output, SensorKind } from "./types";

/**
 * The devices and apps the product knows by name, so they can be shown with their own
 * icon and picture. Icons live in /public/brands and belong to their owners.
 */

/** The drawing used for a device. */
export type DeviceArt =
  | "glasses"
  | "phone"
  | "laptop"
  | "watch"
  | "band"
  | "ring"
  | "pendant"
  | "strap"
  | "patch"
  | "window"
  | "film"
  | "sliders";

/** The way one of a device's senses reaches the app today. */
export type DeviceLink = {
  sense: SensorKind;
  via: "camera" | "screen" | "file" | "microphone" | "gps" | "motion" | "bluetooth" | "nightscout" | "simulator";
};

export type DeviceGroup = "Glasses" | "Phones and computers" | "Wrist and ring" | "Pendants" | "Health sensors" | "Feeds" | "Simulators";

export type Device = {
  id: string;
  name: string;
  maker: string;
  /** File name in /public/brands. Absent for generic devices. */
  icon?: string;
  art: DeviceArt;
  group: DeviceGroup;
  /** What the device can sense. */
  senses: SensorKind[];
  /** How each sense connects today. Empty when the device is not supported yet. */
  links: DeviceLink[];
  /** One line on how to connect it, or on why it cannot be connected yet. */
  how: string;
  /**
   * A device with a browser of its own, such as a phone. Picked on a computer, its sensors
   * arrive through the relay from a page opened on it; picked on the device itself, they are read directly.
   */
  remote?: boolean;
};

const PHONE_LINKS: DeviceLink[] = [
  { sense: "camera", via: "camera" },
  { sense: "sound", via: "microphone" },
  { sense: "location", via: "gps" },
  { sense: "motion", via: "motion" },
];

export const DEVICE_GROUPS: DeviceGroup[] = [
  "Glasses",
  "Phones and computers",
  "Wrist and ring",
  "Pendants",
  "Health sensors",
  "Feeds",
  "Simulators",
];

export const DEVICES: Device[] = [
  {
    id: "ray-ban-meta",
    name: "Ray-Ban Meta",
    maker: "Meta",
    icon: "meta.svg",
    art: "glasses",
    group: "Glasses",
    senses: ["camera", "sound"],
    links: [{ sense: "camera", via: "screen" }],
    how: "Start a video call or live view from the glasses, then share the tab or window that shows it.",
  },
  {
    id: "mentra",
    name: "Mentra Live",
    maker: "Mentra",
    icon: "mentra.png",
    art: "glasses",
    group: "Glasses",
    senses: ["camera", "sound"],
    links: [{ sense: "camera", via: "screen" }],
    how: "Open the glasses' live stream in a tab, then share that tab.",
  },
  {
    id: "frame",
    name: "Frame",
    maker: "Brilliant Labs",
    icon: "brilliant.jpg",
    art: "glasses",
    group: "Glasses",
    senses: ["camera", "sound"],
    links: [],
    how: "Not connected yet. Its camera has no live feed a browser can read.",
  },
  {
    id: "even-g1",
    name: "Even G1",
    maker: "Even Realities",
    icon: "even-realities.png",
    art: "glasses",
    group: "Glasses",
    senses: ["sound"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "iphone",
    name: "iPhone",
    maker: "Apple",
    icon: "apple.svg",
    art: "phone",
    group: "Phones and computers",
    senses: ["camera", "sound", "location", "motion"],
    links: PHONE_LINKS,
    how: "Scan the code with the iPhone and turn on the sensors to share. They stream to this computer.",
    remote: true,
  },
  {
    id: "android",
    name: "Android phone",
    maker: "Android",
    icon: "android.svg",
    art: "phone",
    group: "Phones and computers",
    senses: ["camera", "sound", "location", "motion"],
    links: PHONE_LINKS,
    how: "Scan the code with the phone and turn on the sensors to share. They stream to this computer.",
    remote: true,
  },
  {
    id: "computer",
    name: "This computer",
    maker: "Webcam and microphone",
    art: "laptop",
    group: "Phones and computers",
    senses: ["camera", "sound", "location"],
    links: [
      { sense: "camera", via: "camera" },
      { sense: "sound", via: "microphone" },
      { sense: "location", via: "gps" },
    ],
    how: "Uses the camera and microphone of the computer this page is open on.",
  },
  {
    id: "whoop",
    name: "WHOOP",
    maker: "WHOOP",
    icon: "whoop.png",
    art: "band",
    group: "Wrist and ring",
    senses: ["heart"],
    links: [{ sense: "heart", via: "bluetooth" }],
    how: "Turn on Broadcast Heart Rate in the WHOOP app, then pair it here. Needs Chrome on a computer or Android.",
  },
  {
    id: "garmin",
    name: "Garmin watch",
    maker: "Garmin",
    icon: "garmin.png",
    art: "watch",
    group: "Wrist and ring",
    senses: ["heart"],
    links: [{ sense: "heart", via: "bluetooth" }],
    how: "Turn on Broadcast Heart Rate on the watch, then pair it here. Needs Chrome on a computer or Android.",
  },
  {
    id: "vexo",
    name: "Vexo band",
    maker: "Vexo",
    art: "band",
    group: "Wrist and ring",
    senses: ["heart", "motion"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "apple-watch",
    name: "Apple Watch",
    maker: "Apple",
    icon: "apple.svg",
    art: "watch",
    group: "Wrist and ring",
    senses: ["heart", "motion"],
    links: [],
    how: "Not connected yet. The watch does not broadcast its heart rate to a browser.",
  },
  {
    id: "oura",
    name: "Oura Ring",
    maker: "Oura",
    icon: "oura.png",
    art: "ring",
    group: "Wrist and ring",
    senses: ["heart"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "bee",
    name: "Bee",
    maker: "Bee",
    icon: "bee.png",
    art: "band",
    group: "Wrist and ring",
    senses: ["sound"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "omi",
    name: "Omi",
    maker: "Based Hardware",
    icon: "omi.png",
    art: "pendant",
    group: "Pendants",
    senses: ["sound"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "limitless",
    name: "Limitless Pendant",
    maker: "Limitless",
    icon: "limitless.jpg",
    art: "pendant",
    group: "Pendants",
    senses: ["sound"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "friend",
    name: "Friend",
    maker: "Friend",
    icon: "friend.png",
    art: "pendant",
    group: "Pendants",
    senses: ["sound"],
    links: [],
    how: "Not connected yet.",
  },
  {
    id: "polar",
    name: "Polar H10",
    maker: "Polar",
    icon: "polar.png",
    art: "strap",
    group: "Health sensors",
    senses: ["heart"],
    links: [{ sense: "heart", via: "bluetooth" }],
    how: "Put the strap on, then pair it here. Needs Chrome on a computer or Android.",
  },
  {
    id: "dexcom",
    name: "Dexcom G7",
    maker: "Dexcom",
    icon: "dexcom.png",
    art: "patch",
    group: "Health sensors",
    senses: ["glucose"],
    links: [{ sense: "glucose", via: "nightscout" }],
    how: "Reads through your Nightscout site.",
  },
  {
    id: "libre",
    name: "FreeStyle Libre",
    maker: "Abbott",
    icon: "libre.png",
    art: "patch",
    group: "Health sensors",
    senses: ["glucose"],
    links: [{ sense: "glucose", via: "nightscout" }],
    how: "Reads through your Nightscout site.",
  },
  {
    id: "stream",
    name: "Any live stream",
    maker: "A tab, a window or a whole screen",
    art: "window",
    group: "Feeds",
    senses: ["camera"],
    links: [{ sense: "camera", via: "screen" }],
    how: "Share the tab or window that shows the video.",
  },
  {
    id: "video",
    name: "Video file",
    maker: "Recorded footage, on a loop",
    art: "film",
    group: "Feeds",
    senses: ["camera"],
    links: [{ sense: "camera", via: "file" }],
    how: "Pick a video from this device.",
  },
  ...(["heart", "glucose", "motion", "location"] as const).map(
    (sense): Device => ({
      id: `simulated-${sense}`,
      name: { heart: "Heart rate", glucose: "Glucose", motion: "Motion", location: "Location" }[sense],
      maker: "Simulator",
      art: "sliders",
      group: "Simulators",
      senses: [sense],
      links: [{ sense, via: "simulator" }],
      how: "A pretend device you control, for trying an automation without the hardware.",
    }),
  ),
];

/**
 * A device such as "a shared tab" or "a video file" can be connected several times at once.
 * Each connection is a source of its own with its own id: the device's id for the first, then
 * the id followed by "~2", "~3" and so on. Automations name sources by these ids.
 */
export function baseId(sourceId: string): string {
  return sourceId.split("~")[0];
}

export function deviceById(id: string | undefined | null): Device | undefined {
  return id ? DEVICES.find((device) => device.id === baseId(id)) : undefined;
}

/** What to call a device where it is listed as the source of a sense. A simulator is named after its sense, which would repeat. */
export function sourceName(device: Device): string {
  return device.group === "Simulators" ? "Simulator" : device.name;
}

/** What to call one source, numbered when it is not the first of its device: "Any live stream 2". */
export function sourceLabel(sourceId: string): string {
  const device = deviceById(sourceId);
  if (!device) return "Unknown device";
  const number = Number(sourceId.split("~")[1]);
  return number > 1 ? `${sourceName(device)} ${number}` : sourceName(device);
}

export type App = {
  id: string;
  name: string;
  /** File name in /public/brands. */
  icon: string;
  /** Whether the app takes a webhook itself. The others are reached through an automation tool. */
  direct: boolean;
  /** What to paste, in a sentence. */
  hint: string;
  /** Recognises the app from a webhook address. */
  matches?: (url: URL) => boolean;
};

const through = (does: string) =>
  `Runs through Zapier, Make or n8n: start a flow there with a webhook that ${does}, and paste its address.`;
const host = (...endings: string[]) => (url: URL) => endings.some((ending) => url.hostname.endsWith(ending));

export const APPS: App[] = [
  { id: "slack", name: "Slack", icon: "slack.svg", direct: true, hint: "Paste an incoming webhook address from Slack.", matches: host("hooks.slack.com") },
  { id: "discord", name: "Discord", icon: "discord.svg", direct: true, hint: "Paste a channel webhook address from Discord.", matches: host("discord.com", "discordapp.com") },
  { id: "teams", name: "Teams", icon: "teams.svg", direct: true, hint: "Paste an incoming webhook address from Teams.", matches: host("webhook.office.com", "logic.azure.com") },
  { id: "google-calendar", name: "Google Calendar", icon: "google-calendar.svg", direct: false, hint: through("adds a calendar event") },
  { id: "gmail", name: "Gmail", icon: "gmail.svg", direct: false, hint: through("sends an email") },
  { id: "notion", name: "Notion", icon: "notion.svg", direct: false, hint: through("adds a page or a database row") },
  { id: "telegram", name: "Telegram", icon: "telegram.svg", direct: false, hint: through("sends a message") },
  { id: "whatsapp", name: "WhatsApp", icon: "whatsapp.svg", direct: false, hint: through("sends a message") },
  { id: "linear", name: "Linear", icon: "linear.svg", direct: false, hint: through("creates an issue") },
  { id: "github", name: "GitHub", icon: "github.svg", direct: false, hint: through("opens an issue") },
  { id: "airtable", name: "Airtable", icon: "airtable.svg", direct: false, hint: through("adds a record") },
  { id: "spotify", name: "Spotify", icon: "spotify.svg", direct: false, hint: through("plays or pauses music") },
  { id: "home-assistant", name: "Home Assistant", icon: "home-assistant.png", direct: true, hint: "Paste the address of a webhook trigger from Home Assistant.", matches: (url) => url.pathname.includes("/api/webhook/") },
  { id: "zapier", name: "Zapier", icon: "zapier.svg", direct: true, hint: "Paste the address of a Catch Hook from Zapier.", matches: host("zapier.com") },
  { id: "make", name: "Make", icon: "make.png", direct: true, hint: "Paste the address of a custom webhook from Make.", matches: host("make.com") },
  { id: "n8n", name: "n8n", icon: "n8n.svg", direct: true, hint: "Paste the address of a Webhook node from n8n.", matches: (url) => url.hostname.includes("n8n") },
  { id: "ifttt", name: "IFTTT", icon: "ifttt.svg", direct: true, hint: "Paste a Webhooks address from IFTTT.", matches: host("ifttt.com") },
];

export function appById(id: string | undefined): App | undefined {
  return APPS.find((app) => app.id === id);
}

/** The app a person named in a sentence, such as "Slack" or "google calendar". */
export function appByName(name: string): App | undefined {
  const wanted = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return undefined;
  return APPS.find((app) => app.name.toLowerCase() === wanted) ?? APPS.find((app) => wanted.includes(app.name.toLowerCase()));
}

/** The app an action sends to: the one chosen when it was made, else the one its address belongs to. */
export function appOf(output: Output): App | undefined {
  if (output.kind !== "webhook") return undefined;
  const chosen = appById(output.app);
  if (chosen) return chosen;
  try {
    const url = new URL(output.url);
    return APPS.find((app) => app.matches?.(url));
  } catch {
    return undefined;
  }
}
