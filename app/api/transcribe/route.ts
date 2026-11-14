import OpenAI, { toFile } from "openai";
import { getKey } from "@/lib/keys";

/**
 * Turns a few seconds of microphone audio into text, so sound rules can react to what is said.
 * Body: multipart form with `audio` (webm or mp4). Returns `{ text }`.
 * Speech-to-text runs on OpenAI, so it needs an OpenAI key whichever provider sharpens rules.
 */
export async function POST(request: Request): Promise<Response> {
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
