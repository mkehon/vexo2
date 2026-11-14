import { getKey, getProvider } from "@/lib/keys";
import { PROVIDERS } from "@/lib/providers";
import { isSensorKind } from "@/lib/sensors";
import { describeFailure, sharpen } from "@/lib/sharpen";
import type { CompiledRule, SensorKind } from "@/lib/types";

/** Used when sharpening is unavailable, so a rule can always be created. */
function asWritten(sensor: SensorKind, when: string, note: string): CompiledRule {
  return {
    question: sensor === "camera" ? `Does the image show this: ${when}?` : `Does the reading show this: ${when}?`,
    yes: "",
    no: "",
    say: `Detected: ${when}`,
    compiled: false,
    note,
  };
}

/**
 * Turns the user's "IF" sentence into a question the detector can answer from one frame or
 * sensor reading, using the provider chosen in Settings.
 * Body: `{ when: string, sensor?: SensorKind }`; the sensor defaults to the camera. Returns a CompiledRule.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { when?: unknown; sensor?: unknown } | null;
  const when = typeof body?.when === "string" ? body.when.trim() : "";
  const sensor = isSensorKind(body?.sensor) ? body.sensor : "camera";
  if (!when) {
    return Response.json({ error: "Describe what to watch for." }, { status: 400 });
  }

  const provider = getProvider();
  const apiKey = getKey(provider);
  if (!apiKey) {
    return Response.json(
      asWritten(sensor, when, `Add a key for ${PROVIDERS[provider].label} in Settings to have rules sharpened.`),
    );
  }

  try {
    const compiled: CompiledRule = { ...(await sharpen(provider, sensor, when, apiKey)), compiled: true };
    return Response.json(compiled);
  } catch (error) {
    console.warn(`Rule sharpening with ${provider} failed:`, error instanceof Error ? error.message : error);
    return Response.json(asWritten(sensor, when, describeFailure(provider, error)));
  }
}
