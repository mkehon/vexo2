import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError as GeminiError, GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { PROVIDERS } from "./providers";
import { SENSORS } from "./sensors";
import type { Provider, SensorKind } from "./types";

/**
 * Sharpening turns the sentence a user typed after "IF" into a yes/no question the
 * detector can answer from a single frame or sensor reading. Any of three providers can do it.
 */

const Sharpened = z.object({
  question: z.string(),
  yes: z.string(),
  no: z.string(),
  say: z.string(),
});
export type Sharpened = z.infer<typeof Sharpened>;

const CAMERA_SYSTEM = `You turn a person's description of something a camera should watch for into one yes/no question that a vision model answers from a single still image.

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

/** Instructions for a sensor that sends readings: the model has to know which fields a reading has. */
function readingSystem(sensor: SensorKind): string {
  const { source, fields } = SENSORS[sensor];
  return `You turn a person's description of something a sensor should watch for into one yes/no question that a model answers from a single reading.

The sensor is ${source}. The model sees one reading at a time, as JSON with these fields:
${fields}

So:
- Ask a question that can be answered from those fields alone. Name each quantity the way its field does and use the field's units. If the person uses other units, convert the number yourself: "five minutes" becomes 300 seconds.
- If the description is an event (arrives, leaves, spikes, is dropped), ask about the state that holds right after it happens.
- Phrase it so that yes means the trigger condition holds. Avoid negatives in the question.
- Ask about one condition only. Keep the person's meaning and do not add requirements they did not state.

Return:
- question: the yes/no question.
- yes: one sentence describing a reading for which the answer is yes.
- no: one sentence describing the readings that should count as no, especially near-misses.
- say: a short sentence, under ten words, to announce out loud when this triggers.`;
}

function systemFor(sensor: SensorKind): string {
  return sensor === "camera" ? CAMERA_SYSTEM : readingSystem(sensor);
}

/** Asks the chosen provider for an answer in the shape of `schema`. */
async function generate<Schema extends z.ZodType>(
  provider: Provider,
  apiKey: string,
  system: string,
  input: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const { label, model } = PROVIDERS[provider];

  if (provider === "openai") {
    const response = await new OpenAI({ apiKey }).responses.parse({
      model,
      // The task is a short rewrite, so skip the model's reasoning step for a faster reply.
      reasoning: { effort: "none" },
      instructions: system,
      input,
      text: { format: zodTextFormat(schema, "answer") },
    });
    if (!response.output_parsed) throw new Error(`${label} did not return an answer.`);
    // The SDK's inferred type and Zod's are the same shape under different names.
    return response.output_parsed as z.infer<Schema>;
  }

  if (provider === "anthropic") {
    const response = await new Anthropic({ apiKey }).beta.messages.parse({
      model,
      max_tokens: 16000,
      // If a safety classifier declines the request, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: input }],
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`${label} did not return an answer.`);
    }
    return response.parsed_output;
  }

  const response = await new GoogleGenAI({ apiKey }).models.generateContent({
    model,
    contents: input,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(schema),
    },
  });
  if (!response.text) throw new Error(`${label} did not return an answer.`);
  return schema.parse(JSON.parse(response.text));
}

export function sharpen(provider: Provider, sensor: SensorKind, when: string, apiKey: string): Promise<Sharpened> {
  return generate(provider, apiKey, systemFor(sensor), when, Sharpened);
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
