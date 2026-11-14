import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  TypeSafeClient,
  type EntryType,
  type Questions,
} from "@typesafe-ai/sdk";
import { getKey } from "./keys";
import type { WatchQuestion } from "./types";

/** A detector failure, with the HTTP status the route should answer with. */
export class DetectorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

export function parseQuestions(raw: unknown): WatchQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DetectorError(400, "`questions` must be a non-empty list.");
  }
  return raw as WatchQuestion[];
}

/**
 * Asks the detector every rule's yes/no question about one frame or one sensor reading.
 * `preface` tells it what the state is, and comes before each question.
 * Returns the probability of yes for each rule id.
 */
export async function judge(
  state: NonNullable<EntryType>,
  items: WatchQuestion[],
  preface: string,
): Promise<{ answers: Record<string, number>; ms: number; model: string }> {
  const apiKey = getKey("typesafe");
  if (!apiKey) {
    throw new DetectorError(500, "Add your TypeSafe API key in Settings to start detecting.");
  }

  const questions: Questions = {};
  for (const item of items) {
    questions[item.id] = {
      type: "noul",
      instructions: `${preface} ${item.question}`,
      ...(item.yes || item.no ? { criteria: { true: item.yes || null, false: item.no || null } } : {}),
    };
  }

  const started = performance.now();
  try {
    const result = await clientFor(apiKey).systemOne(
      { state, questions },
      // A live loop is better served by dropping a slow check than by waiting on retries.
      { timeout: 5000, retry: { maxRetries: 0 } },
    );
    const answers: Record<string, number> = {};
    for (const item of items) {
      const answer = result.answers[item.id];
      if (answer?.type === "noul") answers[item.id] = answer.noul;
    }
    return { answers, ms: Math.round(performance.now() - started), model: result.model };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw new DetectorError(401, "TypeSafe rejected the API key. Replace it in Settings.");
    }
    if (error instanceof APIError) {
      throw new DetectorError(502, `TypeSafe returned ${error.status}: ${error.message}`);
    }
    if (error instanceof APIConnectionError) {
      throw new DetectorError(504, `Could not reach TypeSafe: ${error.message}`);
    }
    throw error;
  }
}

/** Turns a failure from `judge` into the response a route sends. */
export function detectorFailure(error: unknown): Response {
  if (error instanceof DetectorError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
