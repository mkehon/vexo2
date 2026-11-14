import { getKey, getReach, saveReach } from "@/lib/keys";
import { isThisComputer } from "@/lib/local";
import { ensureAgent, placeCall, ReachError, sendText, toE164 } from "@/lib/reach";

/**
 * Reaches a person's phone when an automation fires: a call in which a voice agent says the
 * message and can answer a question about it, or a text message carrying it.
 * Body: `{ kind: "call" | "text", to, message, when, detail, sensor, confirm? }`.
 * Returns `{ result }` or `{ error }`; both are sentences for the event log.
 */

/** How soon the same phone may be reached again, so an automation that keeps firing does not keep ringing it. */
const QUIET_MS = { call: 30_000, text: 10_000 };
const lastReached = new Map<string, number>();

/** Makes a fragment into a sentence: a capital first, a full stop last. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

export async function POST(request: Request): Promise<Response> {
  // Requiring JSON stops another website from placing calls with a plain form post to localhost.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send the request as JSON." }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind;
  if (kind !== "call" && kind !== "text") {
    return Response.json({ error: "Expected a call or a text." }, { status: 400 });
  }
  const what = kind === "call" ? "Call" : "Text";
  const to = typeof body?.to === "string" ? toE164(body.to) : null;
  if (!to) {
    return Response.json({ error: `${what} not placed: the phone number needs its country code, such as +1 415 555 0100` }, { status: 400 });
  }
  const text = (name: string) => (typeof body?.[name] === "string" ? (body[name] as string).trim().slice(0, 300) : "");
  const message = sentence(text("message")) || sentence(text("when")) || "An automation fired.";
  const when = text("when");
  const detail = text("detail");

  // Other devices on the network run automations too, but only this computer decides who can be reached.
  const reach = getReach();
  const local = isThisComputer(request);
  if (!local && !reach.allowed?.includes(to)) {
    return Response.json(
      { error: `${what} to ${to} not placed: reach this number once from the computer running the app, then other devices can` },
      { status: 403 },
    );
  }

  const key = `${kind}:${to}`;
  const since = Date.now() - (lastReached.get(key) ?? 0);
  if (since < QUIET_MS[kind]) {
    const done = kind === "call" ? "called" : "texted";
    return Response.json({ error: `${what} skipped: ${to} was ${done} ${Math.round(since / 1000)} s ago` }, { status: 429 });
  }

  try {
    let result: string;
    if (kind === "call") {
      const apiKey = getKey("elevenlabs");
      if (!apiKey || !reach.numberId) {
        const missing = apiKey ? "choose the number to call from" : "add an ElevenLabs key";
        return Response.json({ error: `Call to ${to} not placed: ${missing} in Settings` }, { status: 501 });
      }
      lastReached.set(key, Date.now());
      const agentId = await ensureAgent(apiKey, reach.agentId);
      if (agentId !== reach.agentId) saveReach({ agentId });
      await placeCall({
        apiKey,
        agentId,
        numberId: reach.numberId,
        to,
        variables: {
          message: `Hello, this is an automated alert. ${message}${detail ? ` The sensor read: ${detail}.` : ""}`,
          trigger: when || message,
          reading: detail || "not available",
          sensor: text("sensor") || "not given",
          fired_at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        },
      });
      result = `Calling ${to}${reach.number ? ` from ${reach.number}` : ""}`;
    } else {
      const sid = getKey("twilioSid");
      const token = getKey("twilioToken");
      if (!sid || !token || !reach.number) {
        const missing = sid && token ? "choose the number to text from" : "add the Twilio Account SID and Auth Token";
        return Response.json({ error: `Text to ${to} not sent: ${missing} in Settings` }, { status: 501 });
      }
      lastReached.set(key, Date.now());
      const lines = [`Alert: ${message}`, detail && `Reading: ${detail}`, when && `Automation: when ${when}`].filter(Boolean);
      const status = await sendText({ account: { sid, token }, from: reach.number, to, body: lines.join("\n"), confirm: body?.confirm === true });
      result = `Text ${status} to ${to}`;
    }
    if (local && !reach.allowed?.includes(to)) saveReach({ allowed: [...(reach.allowed ?? []), to].slice(-50) });
    return Response.json({ result });
  } catch (error) {
    // A failed attempt should not block the next try.
    lastReached.delete(key);
    const reason = error instanceof ReachError ? error.message : "something went wrong on this computer";
    return Response.json({ error: `${what} to ${to} ${kind === "call" ? "not placed" : "not sent"}: ${reason}` }, { status: 502 });
  }
}
