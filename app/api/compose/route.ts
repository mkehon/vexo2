import { getKey, getProvider } from "@/lib/keys";
import { PROVIDERS } from "@/lib/providers";
import { SENSORS } from "@/lib/sensors";
import { compose, describeFailure } from "@/lib/sharpen";
import type { ComposedRule, SensorKind } from "@/lib/types";

/** Words that point at a sensor, used only when no AI provider is available. */
const HINTS: [SensorKind, RegExp][] = [
  ["glucose", /glucose|blood sugar|mg\/dl|mmol/i],
  ["heart", /heart|pulse|bpm/i],
  ["sound", /\b(hear|hears|heard|say|says|said|sound|noise|loud|quiet|shout|asks?|asking)\b/i],
  ["location", /\b(location|arrive|arrives|leave|leaves|home|office|metres?|meters?|km|miles?|away from|far from)\b/i],
  ["motion", /\b(shake|shaken|shaking|dropped|drop|fall|falls|fell|face down|face up|still|moving|moves)\b/i],
];

/** Used when no provider can be reached, so an automation can always be created. */
function asWritten(sentence: string, note: string): ComposedRule {
  const sensor = HINTS.find(([, pattern]) => pattern.test(sentence))?.[0] ?? "camera";
  const when = sentence.replace(/^\s*(when|if|whenever)\s+/i, "").replace(/[.,;]\s*$/, "");
  return {
    sensor,
    when,
    question: sensor === "camera" ? `Does the image show this: ${when}?` : `Does the reading show this: ${when}?`,
    yes: "",
    no: "",
    say: `Detected: ${when}`,
    action: /\b(text|sms|message|notify)\b/i.test(sentence) ? "text" : "call",
    message: `Detected: ${when}`,
    destination: "",
    url: "",
    compiled: false,
    note,
  };
}

/**
 * Turns one sentence, such as "when my heart rate goes above 120, tell me to slow down",
 * into a whole automation: which sensor, what to check, and what to do.
 * Body: `{ text: string }`. Returns a ComposedRule.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Describe the automation in a sentence." }, { status: 400 });
  }

  const provider = getProvider();
  const apiKey = getKey(provider);
  if (!apiKey) {
    return Response.json(asWritten(text, `Add a key for ${PROVIDERS[provider].label} in Settings to have sentences understood.`));
  }

  try {
    const result = await compose(provider, text, apiKey);
    const composed: ComposedRule = {
      sensor: result.sensor,
      when: result.trigger,
      question: result.question,
      yes: result.yes,
      no: result.no,
      say: result.message || `Detected: ${result.trigger}`,
      action: result.action,
      message: result.message,
      destination: result.destination,
      url: result.url,
      compiled: true,
    };
    // A sensor the model made up would leave the automation with nothing to watch.
    if (!(composed.sensor in SENSORS)) return Response.json(asWritten(text, "The sentence could not be matched to a sensor."));
    return Response.json(composed);
  } catch (error) {
    console.warn(`Composing with ${provider} failed:`, error instanceof Error ? error.message : error);
    return Response.json(asWritten(text, describeFailure(provider, error)));
  }
}
