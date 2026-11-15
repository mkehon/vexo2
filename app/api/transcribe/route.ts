import OpenAI, { toFile } from "openai";
import { getKey } from "@/lib/keys";
import { isPaired } from "@/lib/relay";

/**
 * Turns a few seconds of microphone audio into text, so sound rules can react to what is said.
 * Body: multipart form with `audio` (webm or mp4). Returns `{ text }`.
 * A phone sending through the public address adds its pairing code in the `x-vexo-pair` header.
 * Speech-to-text runs on OpenAI, so it needs an OpenAI key whichever provider sharpens rules.
 */
export async function POST(request: Request): Promise<Response> {
  // Through the public address this is reachable by anyone who learns it, and every call spends the
  // OpenAI key, so there it is only for a phone that was paired from the computer.
  if ((request.headers.has("cf-connecting-ip") || request.headers.has("cdn-loop")) && !isPaired(request)) {
    return Response.json({ error: "This link is no longer valid. Scan the code on the computer again." }, { status: 403 });
  }
  const apiKey = getKey("openai");
  if (!apiKey) {
    return Response.json(
      { error: "Add an OpenAI API key in Settings so the microphone can make out words." },
      { status: 501 },
    );
  }

  const audio = (await request.formData()).get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "Expected an `audio` recording." }, { status: 400 });
  }

  try {
    const extension = audio.type.includes("mp4") ? "m4a" : "webm";
    const result = await new OpenAI({ apiKey, maxRetries: 0, timeout: 15_000 }).audio.transcriptions.create({
      file: await toFile(audio, `chunk.${extension}`, { type: audio.type }),
      model: "gpt-transcribe",
    });
    return Response.json({ text: result.text.trim() });
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return Response.json({ error: "OpenAI rejected the API key. Replace it in Settings." }, { status: 401 });
    }
    if (error instanceof OpenAI.APIError) {
      return Response.json({ error: `OpenAI returned an error (${error.status}).` }, { status: 502 });
    }
    throw error;
  }
}
