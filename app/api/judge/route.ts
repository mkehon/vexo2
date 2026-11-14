import { detectorFailure, judge, parseQuestions } from "@/lib/detector";
import { isSensorKind, SENSORS } from "@/lib/sensors";

/**
 * Answers every rule's yes/no question about one reading from a sensor other than the camera.
 * Body: `{ sensor, state, questions }`, where `state` is the reading as JSON.
 * Returns `{ answers: { [ruleId]: probabilityOfYes }, ms, model }`.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    sensor?: unknown;
    state?: unknown;
    questions?: unknown;
  } | null;

  const sensor = body?.sensor;
  if (!isSensorKind(sensor) || sensor === "camera") {
    return Response.json({ error: "Unknown sensor." }, { status: 400 });
  }
  const state = body?.state;
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    return Response.json({ error: "`state` must be a reading." }, { status: 400 });
  }

  try {
    const result = await judge(
      state as Record<string, never>,
      parseQuestions(body?.questions),
      `The state is the latest reading from ${SENSORS[sensor].source}.`,
    );
    return Response.json(result);
  } catch (error) {
    return detectorFailure(error);
  }
}
