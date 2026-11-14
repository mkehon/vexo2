import {
  AuthenticationError as TypeSafeAuthenticationError,
  PermissionDeniedError as TypeSafePermissionDeniedError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import { getKey, getReach, saveKey, saveProvider, saveReach } from "@/lib/keys";
import { isThisComputer, settingsFor } from "@/lib/local";
import { isProvider, PROVIDERS } from "@/lib/providers";
import { checkTwilio, defaultNumber, listNumbers, ReachError } from "@/lib/reach";
import { checkProviderKey, isKeyRejection } from "@/lib/sharpen";
import type { KeyName } from "@/lib/types";

const OTHER_KEYS = ["typesafe", "elevenlabs", "twilioSid", "twilioToken"] as const;

function isKeyName(name: unknown): name is KeyName {
  return isProvider(name) || OTHER_KEYS.includes(name as (typeof OTHER_KEYS)[number]);
}

function labelOf(name: KeyName): string {
  if (name === "typesafe") return "TypeSafe";
  if (name === "elevenlabs") return "ElevenLabs";
  if (name === "twilioSid" || name === "twilioToken") return "Twilio";
  return PROVIDERS[name].label;
}

/** Asks the provider whether it accepts the key. Only a clear rejection blocks saving. */
async function checkKey(name: KeyName, value: string): Promise<{ rejected: boolean; message: string }> {
  const label = labelOf(name);
  try {
    if (name === "typesafe") {
      await new TypeSafeClient({ apiKey: value }).models.list({ timeout: 8000, retry: { maxRetries: 0 } });
    } else if (name === "elevenlabs") {
      // Listing the numbers both checks the key and gives a number to start with.
      const numbers = await listNumbers(value);
      const reach = getReach();
      const start = numbers.find((item) => item.id === reach.numberId) ?? defaultNumber(numbers);
      if (!start) return { rejected: false, message: "Saved. This ElevenLabs account has no Twilio number yet, and calls need one." };
      saveReach({ numberId: start.id, number: start.number });
      return { rejected: false, message: `Saved. Calls will come from ${start.number}.` };
    } else if (name === "twilioSid" || name === "twilioToken") {
      // The two only mean something together, so they are checked once both are here.
      const sid = name === "twilioSid" ? value : getKey("twilioSid");
      const token = name === "twilioToken" ? value : getKey("twilioToken");
      if (name === "twilioSid" && !/^AC[0-9a-f]{32}$/i.test(value)) {
        return { rejected: true, message: "An Account SID starts with AC and has 34 characters. Check it and try again." };
      }
      if (!sid || !token) return { rejected: false, message: `Saved. Add the ${sid ? "Auth Token" : "Account SID"} to finish.` };
      await checkTwilio({ sid, token });
      return { rejected: false, message: "Saved. Twilio accepted the Account SID and Auth Token." };
    } else {
      await checkProviderKey(name, value);
    }
    return { rejected: false, message: `Saved. ${label} accepted the key.` };
  } catch (error) {
    const rejected =
      error instanceof TypeSafeAuthenticationError ||
      error instanceof TypeSafePermissionDeniedError ||
      (error instanceof ReachError && error.rejected) ||
      isKeyRejection(error);
    if (rejected) {
      const pair = name === "twilioSid" || name === "twilioToken";
      return { rejected: true, message: `${label} rejected ${pair ? "this Account SID and Auth Token together" : "this key"}. Check it and try again.` };
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    return { rejected: false, message: `Saved, but the key could not be checked (${reason}).` };
  }
}

export async function GET(request: Request): Promise<Response> {
  return Response.json(settingsFor(request));
}

/**
 * Body is one of:
 * - `{ name, value }`: save a key, or remove the saved one when `value` is null.
 * - `{ provider }`: choose which provider sharpens rules.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isThisComputer(request)) {
    return Response.json(
      { error: "Settings can only be changed on the computer running the app.", settings: settingsFor(request) },
      { status: 403 },
    );
  }
  // Requiring JSON stops another website from changing settings with a plain form post to localhost.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send the request as JSON." }, { status: 415 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    value?: unknown;
    provider?: unknown;
  } | null;

  if (body?.provider !== undefined) {
    if (!isProvider(body.provider)) return Response.json({ error: "Unknown provider." }, { status: 400 });
    saveProvider(body.provider);
    return Response.json({ settings: settingsFor(request) });
  }

  const name = body?.name;
  if (!isKeyName(name)) {
    return Response.json({ error: "Unknown key." }, { status: 400 });
  }

  if (body?.value === null) {
    saveKey(name, null);
    return Response.json({ message: "Removed.", settings: settingsFor(request) });
  }

  const value = typeof body?.value === "string" ? body.value.trim() : "";
  if (!value) {
    return Response.json({ error: "Paste a key first." }, { status: 400 });
  }

  const check = await checkKey(name, value);
  if (check.rejected) {
    return Response.json({ error: check.message, settings: settingsFor(request) }, { status: 400 });
  }
  saveKey(name, value);
  // Adding a key for a provider is taken as choosing it.
  if (isProvider(name)) saveProvider(name);
  return Response.json({ message: check.message, settings: settingsFor(request) });
}
