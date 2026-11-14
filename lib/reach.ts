import type { PhoneNumber } from "./types";

/**
 * Reaching a phone. A call is placed by an ElevenLabs voice agent, which speaks the alert and
 * can answer a question about it; a text is sent through Twilio. Both come from the same
 * Twilio number, which is imported into the ElevenLabs account.
 */

const ELEVENLABS = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
const TWILIO = "https://api.twilio.com/2010-04-01";
const TIMEOUT_MS = 12_000;

/** The voice agent's name in the ElevenLabs account. It is found by this name, so it is made only once. */
export const AGENT_NAME = "Sensor alert line (hackathon)";

/** A call or text that could not be placed. The message is written for the person using the app. */
export class ReachError extends Error {
  constructor(
    message: string,
    /** The HTTP status the service answered with, or 0 when it did not answer. */
    readonly status = 0,
  ) {
    super(message);
  }

  /** The service rejected the key or credentials. */
  get rejected(): boolean {
    return this.status === 401;
  }
}

/** A phone number as carriers want it, such as "+14155550100", or null when it cannot be one. */
export function toE164(input: string): string | null {
  const text = input.trim();
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (text.startsWith("00")) return digits.length >= 10 && digits.length <= 17 ? `+${digits.slice(2)}` : null;
  // Without a country code, a ten-digit number is taken to be a US one.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/* ---------- ElevenLabs ---------- */

async function elevenlabs<T>(apiKey: string, path: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ELEVENLABS}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "xi-api-key": apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ReachError("ElevenLabs did not respond");
  }
  const result = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  if (response.ok && result) return result as T;

  // Errors come as `{ detail: { message } }`, `{ detail: "…" }` or, for a bad request, a list of `{ msg }`.
  const detail = result?.detail;
  let reason = `error ${response.status}`;
  if (typeof detail === "string") reason = detail;
  else if (Array.isArray(detail)) reason = detail.map((item) => (item as { msg?: string }).msg).filter(Boolean).join("; ") || reason;
  else if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    reason = (detail as { message: string }).message;
  }
  if (response.status === 401) throw new ReachError("ElevenLabs rejected the API key", 401);
  throw new ReachError(`ElevenLabs: ${reason}`, response.status);
}

/** The Twilio numbers in the ElevenLabs account, which are the ones a call can be placed from. */
export async function listNumbers(apiKey: string): Promise<PhoneNumber[]> {
  const items = await elevenlabs<{ provider?: string; phone_number: string; phone_number_id: string; label?: string }[]>(
    apiKey,
    "/v1/convai/phone-numbers",
  );
  return items
    .filter((item) => item.provider === "twilio")
    .map((item) => ({ id: item.phone_number_id, number: item.phone_number, label: item.label ?? "" }));
}

/** The number to start with: a US one when the account has one. */
export function defaultNumber(numbers: PhoneNumber[]): PhoneNumber | undefined {
  return numbers.find((item) => item.number.startsWith("+1")) ?? numbers[0];
}

const AGENT_PROMPT = `You are an automated alert line. A person set up an automation that watches a sensor, it has just fired, and you have phoned them to tell them.

What the automation watches for: {{trigger}}
What the sensor read when it fired: {{reading}}
The sensor: {{sensor}}
When it fired: {{fired_at}}

You have already said the alert as your first sentence. After that:
- If they ask what happened, answer in one or two short sentences, using only the facts above. If they ask something those facts do not cover, say you do not know.
- If they say thanks, okay, got it or goodbye, or have no questions, say a short goodbye and end the call.
- If nobody speaks, say the alert once more and end the call.

Keep every reply under two sentences. Speak plainly and calmly. Never ask for personal information, and never claim to be a person.`;

/**
 * The id of the voice agent that speaks on calls. Uses the saved one while it still exists,
 * else one with the expected name, else creates it.
 */
export async function ensureAgent(apiKey: string, savedId?: string): Promise<string> {
  if (savedId) {
    try {
      await elevenlabs(apiKey, `/v1/convai/agents/${encodeURIComponent(savedId)}`);
      return savedId;
    } catch (error) {
      // A deleted agent is replaced; anything else is a real failure.
      if (!(error instanceof ReachError) || error.status !== 404) throw error;
    }
  }

  const found = await elevenlabs<{ agents: { agent_id: string; name: string }[] }>(
    apiKey,
    `/v1/convai/agents?page_size=20&search=${encodeURIComponent(AGENT_NAME)}`,
  );
  const existing = found.agents.find((agent) => agent.name === AGENT_NAME);
  if (existing) return existing.agent_id;

  const created = await elevenlabs<{ agent_id: string }>(apiKey, "/v1/convai/agents/create", {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        // The whole alert is passed in when the call is placed.
        first_message: "{{message}}",
        language: "en",
        dynamic_variables: {
          dynamic_variable_placeholders: {
            message: "This is an automated alert. This is only a test.",
            trigger: "a test of the alert line",
            reading: "not available",
            sensor: "none",
            fired_at: "just now",
          },
        },
        prompt: {
          prompt: AGENT_PROMPT,
          built_in_tools: {
            end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
          },
        },
      },
      // Phone audio, the same way the account's other phone agents are set up.
      asr: { user_input_audio_format: "ulaw_8000" },
      tts: { agent_output_audio_format: "ulaw_8000" },
      // An alert takes seconds. These stop a call that was left open from running on.
      conversation: { max_duration_seconds: 120 },
      turn: { silence_end_call_timeout: 20 },
    },
  });
  return created.agent_id;
}

/** Rings a phone. The agent says `variables.message` when the call is picked up. */
export async function placeCall(input: {
  apiKey: string;
  agentId: string;
  numberId: string;
  to: string;
  variables: { message: string; trigger: string; reading: string; sensor: string; fired_at: string };
}): Promise<void> {
  const result = await elevenlabs<{ success?: boolean; message?: string }>(input.apiKey, "/v1/convai/twilio/outbound-call", {
    agent_id: input.agentId,
    agent_phone_number_id: input.numberId,
    to_number: input.to,
    conversation_initiation_client_data: { dynamic_variables: input.variables },
  });
  if (result.success === false) throw new ReachError(`ElevenLabs: ${result.message ?? "the call was not started"}`);
}

/* ---------- Twilio ---------- */

export type TwilioAccount = { sid: string; token: string };

/** Why Twilio or a carrier refused a text, for the error codes people actually hit. */
const TWILIO_REASONS: Record<number, string> = {
  20003: "Twilio rejected the Account SID and Auth Token",
  21211: "that is not a valid phone number",
  21408: "the Twilio account is not allowed to text that country",
  21606: "the sending number cannot send texts",
  21608: "a Twilio trial account can only text numbers verified in the Twilio console",
  21610: "that phone has opted out of texts from this number",
  21612: "Twilio cannot send from this number to that one",
  21614: "that number cannot receive texts",
  21659: "the sending number is not in this Twilio account",
  21660: "the sending number is not in this Twilio account",
  30007: "the carrier filtered the text",
  30032: "the toll-free sending number is not verified",
  30034: "US carriers block texts from a number that is not registered for A2P 10DLC",
};

async function twilio<T>(account: TwilioAccount, path: string, form?: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${TWILIO}/Accounts/${encodeURIComponent(account.sid)}${path}`, {
      method: form ? "POST" : "GET",
      headers: { authorization: `Basic ${Buffer.from(`${account.sid}:${account.token}`).toString("base64")}` },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ReachError("Twilio did not respond");
  }
  const result = (await response.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (response.ok && result) return result as T;
  if (response.status === 401) throw new ReachError(TWILIO_REASONS[20003], 401);
  const known = result?.code ? TWILIO_REASONS[result.code] : undefined;
  throw new ReachError(known ?? `Twilio: ${result?.message ?? `error ${response.status}`}`, response.status);
}

/** Checks that the Account SID and Auth Token belong together. Throws a `ReachError` when they do not. */
export async function checkTwilio(account: TwilioAccount): Promise<void> {
  await twilio(account, ".json");
}

type TwilioMessage = { sid: string; status: string; error_code: number | null };

/**
 * Sends a text and returns how far it got: "delivered", or "sent" when the carrier has not
 * confirmed yet. With `confirm`, waits a few seconds for the carrier's answer, which is where a
 * blocked text shows up; without it, returns as soon as Twilio accepts the text.
 */
export async function sendText(input: {
  account: TwilioAccount;
  from: string;
  to: string;
  body: string;
  confirm?: boolean;
}): Promise<"sent" | "delivered"> {
  let message = await twilio<TwilioMessage>(input.account, "/Messages.json", { To: input.to, From: input.from, Body: input.body });
  const failed = () => message.status === "failed" || message.status === "undelivered";
  for (let attempt = 0; input.confirm && attempt < 4 && message.status !== "delivered" && !failed(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    message = await twilio<TwilioMessage>(input.account, `/Messages/${message.sid}.json`);
  }
  if (failed()) {
    const reason = message.error_code ? (TWILIO_REASONS[message.error_code] ?? `Twilio error ${message.error_code}`) : "the carrier did not accept it";
    throw new ReachError(reason);
  }
  return message.status === "delivered" ? "delivered" : "sent";
}
