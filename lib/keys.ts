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
};

const FILE = path.join(process.cwd(), ".vexo", "keys.json");

type Saved = Partial<Record<KeyName, string>> & { provider?: Provider };

function readSaved(): Saved {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    // No file yet, or it is unreadable: nothing is saved.
    return {};
  }
}

function writeSaved(saved: Saved): void {
  mkdirSync(path.dirname(FILE), { recursive: true });
  // Readable by this user only.
  writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
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
