import {
  AuthenticationError as TypeSafeAuthenticationError,
  PermissionDeniedError as TypeSafePermissionDeniedError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import { getProvider, keyStatus, saveKey, saveProvider } from "@/lib/keys";
import { isProvider, PROVIDERS } from "@/lib/providers";
import { checkProviderKey, isKeyRejection } from "@/lib/sharpen";
import type { KeyName, Settings } from "@/lib/types";

function labelOf(name: KeyName): string {
  return name === "typesafe" ? "TypeSafe" : PROVIDERS[name].label;
}

/**
 * Settings can be changed only from the computer running vexo. Requests from other devices
 * come through the https entrance, which marks them (see scripts/dev.mjs); the host check
 * covers a server that was started without it.
 */
function isThisComputer(request: Request): boolean {
  if (request.headers.has("x-vexo-remote")) return false;
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function settingsFor(request: Request): Settings {
  const canEdit = isThisComputer(request);
  return {
    canEdit,
    provider: getProvider(),
    keys: {
      typesafe: keyStatus("typesafe", canEdit),
      openai: keyStatus("openai", canEdit),
      anthropic: keyStatus("anthropic", canEdit),
      gemini: keyStatus("gemini", canEdit),
    },
  };
}

/** Asks the provider whether it accepts the key. Only a clear rejection blocks saving. */
async function checkKey(name: KeyName, value: string): Promise<{ rejected: boolean; message: string }> {
  const label = labelOf(name);
  try {
    if (name === "typesafe") {
      await new TypeSafeClient({ apiKey: value }).models.list({ timeout: 8000, retry: { maxRetries: 0 } });
    } else {
      await checkProviderKey(name, value);
    }
    return { rejected: false, message: `Saved. ${label} accepted the key.` };
  } catch (error) {
    const rejected =
      error instanceof TypeSafeAuthenticationError ||
      error instanceof TypeSafePermissionDeniedError ||
      isKeyRejection(error);
    if (rejected) {
      return { rejected: true, message: `${label} rejected this key. Check it and try again.` };
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
  if (name !== "typesafe" && !isProvider(name)) {
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
