import type { Provider } from "./types";

/**
 * The AI providers that can sharpen a rule, and the model each one uses.
 * The models are each provider's quick option, because a rule is created while the user waits.
 */
export const PROVIDERS: Record<Provider, { label: string; model: string }> = {
  openai: { label: "OpenAI", model: "gpt-6-luna" },
  anthropic: { label: "Claude", model: "claude-opus-5-5" },
  gemini: { label: "Gemini", model: "gemini-3.5-flash-lite" },
};

export const PROVIDER_ORDER: Provider[] = ["openai", "anthropic", "gemini"];

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && value in PROVIDERS;
}
