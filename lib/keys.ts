import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isProvider, PROVIDER_ORDER } from "./providers";
import type { KeyName, KeyStatus, Provider } from "./types";

/**
 * API keys and the chosen provider for the server routes. Values saved from the app's
 * Settings are kept in a file on this computer and win over ones set in the environment,
 * so the app works with either.
 */

const ENV_NAME: Record<KeyName, string> = {
  typesafe: "TYPESAFE_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  twilioSid: "TWILIO_ACCOUNT_SID",
  twilioToken: "TWILIO_AUTH_TOKEN",
};

const FILE = path.join(process.cwd(), ".vexo", "keys.json");

/** How calls and texts are placed. None of it is secret. */
export type ReachConfig = {
  /** The ElevenLabs id of the number calls come from, and the number itself, which texts come from. */
  numberId?: string;
  number?: string;
  /** The ElevenLabs voice agent that speaks on calls. Created the first time it is needed. */
  agentId?: string;
  /** Numbers that have been reached from this computer. Other devices may reach only these. */
  allowed?: string[];
};

type Saved = Partial<Record<KeyName, string>> & { provider?: Provider; reach?: ReachConfig };

function readSaved(): Saved {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    // No file yet, or it is unreadable: nothing is saved.
    return {};
  }
}

function writeSaved(saved: Saved): void {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    // Readable by this user only.
    writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  } catch {
    // A hosted copy has nowhere to write. It takes everything from its environment, so nothing is lost.
  }
}

export function getKey(name: KeyName): string | undefined {
  return readSaved()[name] || process.env[ENV_NAME[name]] || undefined;
}

/** Saves a key, or removes the saved one when `value` is null. */
export function saveKey(name: KeyName, value: string | null): void {
  const saved = readSaved();
  if (value) saved[name] = value;
  else delete saved[name];
  writeSaved(saved);
}

/** Where a key comes from, without revealing it. */
export function keyStatus(name: KeyName, includeHint: boolean): KeyStatus {
  const saved = readSaved()[name];
  const value = saved || process.env[ENV_NAME[name]];
  if (!value) return { source: "none", hint: "" };
  return { source: saved ? "app" : "env", hint: includeHint ? value.slice(-4) : "" };
}

/** The provider that sharpens rules: the one chosen in Settings, else the first that has a key. */
export function getProvider(): Provider {
  const chosen = readSaved().provider;
  if (isProvider(chosen)) return chosen;
  return PROVIDER_ORDER.find((provider) => getKey(provider)) ?? PROVIDER_ORDER[0];
}

export function saveProvider(provider: Provider): void {
  writeSaved({ ...readSaved(), provider });
}

/** How calls and texts are placed: what was chosen in Settings, else what the environment sets. */
export function getReach(): ReachConfig {
  const saved = readSaved().reach ?? {};
  return {
    ...saved,
    numberId: saved.numberId || process.env.ELEVENLABS_PHONE_NUMBER_ID || undefined,
    number: saved.number || process.env.TWILIO_FROM_NUMBER || undefined,
    agentId: saved.agentId || process.env.ELEVENLABS_AGENT_ID || undefined,
  };
}

export function saveReach(change: ReachConfig): void {
  const saved = readSaved();
  writeSaved({ ...saved, reach: { ...saved.reach, ...change } });
}
