import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  image,
  TypeSafeClient,
  type Questions,
} from "@typesafe-ai/sdk";
import { getKey } from "@/lib/keys";
import type { WatchQuestion } from "@/lib/types";

let cached: { apiKey: string; client: TypeSafeClient } | null = null;

function clientFor(apiKey: string): TypeSafeClient {
  if (cached?.apiKey !== apiKey) {
    cached = {
      apiKey,
      // Image input is experimental in TypeSafe and has to be opted into per request.
      client: new TypeSafeClient({ apiKey, defaultHeaders: { "TypeSafe-Danger-Zone-Images": "true" } }),
    };
  }
  return cached.client;
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * Answers every rule's yes/no question about one frame.
 * Body: multipart form with `frame` (JPEG) and `questions` (JSON array of WatchQuestion).
 * Returns `{ answers: { [ruleId]: probabilityOfYes }, ms, model }`.
 */
export async function POST(request: Request): Promise<Response> {
  const apiKey = getKey("typesafe");
  if (!apiKey) {
    return fail(500, "Add your TypeSafe API key in Settings to start detecting.");
  }

  const form = await request.formData();
  const frame = form.get("frame");
  const rawQuestions = form.get("questions");
  if (!(frame instanceof Blob) || typeof rawQuestions !== "string") {
    return fail(400, "Expected a `frame` image and a `questions` list.");
  }

  let items: WatchQuestion[];
  try {
    items = JSON.parse(rawQuestions);
  } catch {
    return fail(400, "`questions` is not valid JSON.");
  }
  if (!Array.isArray(items) || items.length === 0) {
    return fail(400, "`questions` must be a non-empty list.");
  }

  const questions: Questions = {};
  for (const item of items) {
    questions[item.id] = {
      type: "noul",
      instructions: `Look at the camera image in \`frame\`. ${item.question}`,
      ...(item.yes || item.no
        ? { criteria: { true: item.yes || null, false: item.no || null } }
        : {}),
    };
  }

  const started = performance.now();
  try {
    const result = await clientFor(apiKey).systemOne(
      { state: { frame: image(frame) }, questions },
      // A live loop is better served by dropping a slow frame than by waiting on retries.
      { timeout: 5000, retry: { maxRetries: 0 } },
    );

    const answers: Record<string, number> = {};
    for (const item of items) {
      const answer = result.answers[item.id];
      if (answer?.type === "noul") answers[item.id] = answer.noul;
    }
    return Response.json({
      answers,
      ms: Math.round(performance.now() - started),
      model: result.model,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return fail(401, "TypeSafe rejected the API key. Replace it in Settings.");
    }
    if (error instanceof APIError) {
      return fail(502, `TypeSafe returned ${error.status}: ${error.message}`);
    }
    if (error instanceof APIConnectionError) {
      return fail(504, `Could not reach TypeSafe: ${error.message}`);
    }
    throw error;
  }
}
