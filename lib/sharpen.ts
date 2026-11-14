import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError as GeminiError, GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { PROVIDERS } from "./providers";
import type { Provider } from "./types";

/**
 * Sharpening turns the sentence a user typed after "IF" into a yes/no question the
 * detector can answer from a single frame. Any of three providers can do it.
 */

const Sharpened = z.object({
  question: z.string(),
  yes: z.string(),
  no: z.string(),
  say: z.string(),
});
export type Sharpened = z.infer<typeof Sharpened>;

const SYSTEM = `You turn a person's description of something a camera should watch for into one yes/no question that a vision model answers from a single still image.

The vision model sees one frame at a time and has no memory of earlier frames. So:
- If the description is an event or action (picks up, enters, opens, falls, leaves), ask about the visible state that holds right after it happens. "Someone picks up the mug" becomes "Is a person holding a mug in their hand?"
- Ask about what is visible, in plain concrete terms: objects, people, positions, colors. Do not ask about intent, sound, or anything outside the frame.
- Phrase it so that yes means the trigger condition holds. Avoid negatives in the question. If the trigger is an absence, such as "nobody is at the desk", ask "Is the desk unattended, with no person sitting at it?"
- Ask about one condition only. Keep the person's meaning and do not add requirements they did not state.

Return:
- question: the yes/no question.
- yes: one sentence describing what the image shows when the answer is yes.
- no: one sentence describing the situations that should count as no, especially near-misses that look similar.
- say: a short sentence, under ten words, to announce out loud when this triggers.`;

const sharpeners: Record<Provider, (when: string, apiKey: string) => Promise<Sharpened>> = {
  async openai(when, apiKey) {
    const response = await new OpenAI({ apiKey }).responses.parse({
      model: PROVIDERS.openai.model,
      // The task is a short rewrite, so skip the model's reasoning step for a faster reply.
      reasoning: { effort: "none" },
      instructions: SYSTEM,
      input: when,
      text: { format: zodTextFormat(Sharpened, "rule") },
    });
    if (!response.output_parsed) throw new Error("OpenAI did not return a question.");
    return response.output_parsed;
  },

  async anthropic(when, apiKey) {
    const response = await new Anthropic({ apiKey }).beta.messages.parse({
      model: PROVIDERS.anthropic.model,
      max_tokens: 16000,
      // If a safety classifier declines the request, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: when }],
      output_config: { effort: "low", format: betaZodOutputFormat(Sharpened) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error("Claude did not return a question.");
    }
    return response.parsed_output;
  },

  async gemini(when, apiKey) {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: PROVIDERS.gemini.model,
      contents: when,
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(Sharpened),
      },
    });
    if (!response.text) throw new Error("Gemini did not return a question.");
    return Sharpened.parse(JSON.parse(response.text));
  },
};

export function sharpen(provider: Provider, when: string, apiKey: string): Promise<Sharpened> {
  return sharpeners[provider](when, apiKey);
}

/** Makes a free call that fails if the provider does not accept the key. */
export async function checkProviderKey(provider: Provider, apiKey: string): Promise<void> {
  if (provider === "openai") {
    await new OpenAI({ apiKey, maxRetries: 0, timeout: 8000 }).models.list();
  } else if (provider === "anthropic") {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 8000 }).models.list({ limit: 1 });
  } else {
    await new GoogleGenAI({ apiKey }).models.list({ config: { pageSize: 1 } });
  }
}

/** True when a provider turned the key down, as opposed to being unreachable or busy. */
export function isKeyRejection(error: unknown): boolean {
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) return true;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return true;
  // Gemini reports an invalid key as a 400 as well as 401 and 403.
  if (error instanceof GeminiError) {
    return error.status === 401 || error.status === 403 || /api key/i.test(error.message);
  }
  return false;
}

/** A sentence for the user saying why sharpening did not happen. */
export function describeFailure(provider: Provider, error: unknown): string {
  const { label } = PROVIDERS[provider];
  if (isKeyRejection(error)) return `${label} rejected the API key. Replace it in Settings.`;
  if (error instanceof OpenAI.APIConnectionError || error instanceof Anthropic.APIConnectionError) {
    return `Could not reach ${label}.`;
  }
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError || error instanceof GeminiError) {
    return `${label} returned an error (${error.status}).`;
  }
  return `${label} could not sharpen this rule.`;
}
