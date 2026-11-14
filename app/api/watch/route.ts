import { image } from "@typesafe-ai/sdk";
import { detectorFailure, judge, parseQuestions } from "@/lib/detector";

/**
 * Answers every camera rule's yes/no question about one frame.
 * Body: multipart form with `frame` (JPEG) and `questions` (JSON array of WatchQuestion).
 * Returns `{ answers: { [ruleId]: probabilityOfYes }, ms, model }`.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const frame = form.get("frame");
  const rawQuestions = form.get("questions");
  if (!(frame instanceof Blob) || typeof rawQuestions !== "string") {
    return Response.json({ error: "Expected a `frame` image and a `questions` list." }, { status: 400 });
  }

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawQuestions);
    } catch {
      return Response.json({ error: "`questions` is not valid JSON." }, { status: 400 });
    }
    const result = await judge({ frame: image(frame) }, parseQuestions(parsed), "Look at the camera image in `frame`.");
    return Response.json(result);
  } catch (error) {
    return detectorFailure(error);
  }
}
