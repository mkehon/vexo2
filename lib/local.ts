import { getKey, getProvider, getReach, keyStatus } from "./keys";
import type { ReachStatus, Settings } from "./types";

/**
 * True when a request comes from the computer running the app. Requests from other devices
 * come through the https entrance, which marks them (see scripts/dev.mjs); the host check
 * covers a server that was started without it.
 */
export function isThisComputer(request: Request): boolean {
  if (request.headers.has("x-vexo-remote")) return false;
  // Through the public tunnel (scripts/tunnel.mjs) the request reaches the server from this computer, but did not start here.
  if (request.headers.has("cf-connecting-ip") || request.headers.has("cdn-loop")) return false;
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function reachStatus(): ReachStatus {
  const reach = getReach();
  return {
    number: reach.number ?? "",
    call: Boolean(getKey("elevenlabs") && reach.numberId),
    text: Boolean(getKey("twilioSid") && getKey("twilioToken") && reach.number),
  };
}

/** The settings as one device may see them. Key endings are shown only on the computer running the app. */
export function settingsFor(request: Request): Settings {
  const canEdit = isThisComputer(request);
  return {
    canEdit,
    provider: getProvider(),
    keys: {
      typesafe: keyStatus("typesafe", canEdit),
      openai: keyStatus("openai", canEdit),
      anthropic: keyStatus("anthropic", canEdit),
      gemini: keyStatus("gemini", canEdit),
      elevenlabs: keyStatus("elevenlabs", canEdit),
      twilioSid: keyStatus("twilioSid", canEdit),
      twilioToken: keyStatus("twilioToken", canEdit),
    },
    reach: reachStatus(),
  };
}
