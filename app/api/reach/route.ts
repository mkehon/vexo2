import { getKey, getReach, saveReach } from "@/lib/keys";
import { isThisComputer, settingsFor } from "@/lib/local";
import { ensureAgent, listNumbers, ReachError } from "@/lib/reach";

/**
 * The number that calls and texts come from. Only the computer running the app may see the
 * account's numbers or choose one.
 *
 * GET returns `{ numbers }`, the Twilio numbers in the ElevenLabs account.
 * POST `{ numberId }` chooses one and makes sure the voice agent exists; returns `{ message, settings }`.
 */

function refuse(request: Request): Response | null {
  if (isThisComputer(request)) return null;
  return Response.json({ error: "This can only be done on the computer running the app." }, { status: 403 });
}

function failure(error: unknown): Response {
  const reason = error instanceof ReachError ? error.message : "Something went wrong on this computer.";
  return Response.json({ error: reason }, { status: 502 });
}

export async function GET(request: Request): Promise<Response> {
  const refused = refuse(request);
  if (refused) return refused;
  const apiKey = getKey("elevenlabs");
  if (!apiKey) return Response.json({ numbers: [] });
  try {
    return Response.json({ numbers: await listNumbers(apiKey), numberId: getReach().numberId ?? "" });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const refused = refuse(request);
  if (refused) return refused;
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send the request as JSON." }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as { numberId?: unknown } | null;
  const apiKey = getKey("elevenlabs");
  if (!apiKey) return Response.json({ error: "Add an ElevenLabs key first." }, { status: 400 });
  try {
    const chosen = (await listNumbers(apiKey)).find((item) => item.id === body?.numberId);
    if (!chosen) return Response.json({ error: "That number is not in the ElevenLabs account." }, { status: 400 });
    const agentId = await ensureAgent(apiKey, getReach().agentId);
    saveReach({ numberId: chosen.id, number: chosen.number, agentId });
    return Response.json({ message: `Calls and texts will come from ${chosen.number}.`, settings: settingsFor(request) });
  } catch (error) {
    return failure(error);
  }
}
