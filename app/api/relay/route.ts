import { isThisComputer } from "@/lib/local";
import { heardFrom, isChannel, isPaired, isRelayKind, latest, nextFrame, put, statusOf } from "@/lib/relay";

/**
 * The relay's two ends. A phone posts what its sensors read; the page on the computer reads it.
 *
 * POST ?channel&kind=camera  with a JPEG as the body            (from the phone)
 * POST ?channel&kind=sound|location|motion  with `{ state }`    (from the phone)
 * GET  ?channel                       -> `{ live, wanted }`      (either end)
 * GET  ?channel&kind=camera&after=N   -> the next JPEG, with its number in `x-seq`, or 204
 * GET  ?channel&kind=sound|…          -> `{ state, at }`, or 204
 *
 * Only the computer running the app may read what a phone sends: other devices on the network
 * have no business seeing its camera. And only a phone that opened the link the computer showed
 * may send, which it proves with the pairing code in that link (`k`): what arrives here can set
 * off an automation, so it must come from the phone the person paired.
 */

const EXPIRED = "This link is no longer valid. Scan the code on the computer again.";

const MAX_FRAME_BYTES = 600_000;
const MAX_STATE_BYTES = 20_000;
/** How long a request for the next frame waits for one. Short, so a stopped phone does not hold connections open. */
const FRAME_WAIT_MS = 1000;

function target(request: Request) {
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  const kind = url.searchParams.get("kind");
  return { url, channel: isChannel(channel) ? channel : null, kind: isRelayKind(kind) ? kind : null, hasKind: kind !== null };
}

export async function POST(request: Request): Promise<Response> {
  const { channel, kind } = target(request);
  if (!channel || !kind) return Response.json({ error: "Expected a channel and a kind." }, { status: 400 });
  if (!isPaired(request)) return Response.json({ error: EXPIRED }, { status: 403 });
  // Refused by its declared size, before any of it is read into memory.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > (kind === "camera" ? MAX_FRAME_BYTES : MAX_STATE_BYTES)) {
    return Response.json({ error: "The body is missing or too large." }, { status: 413 });
  }
  heardFrom(channel);

  if (kind === "camera") {
    const frame = new Uint8Array(await request.arrayBuffer());
    if (frame.length === 0 || frame.length > MAX_FRAME_BYTES) return Response.json({ error: "Expected one JPEG frame." }, { status: 400 });
    put(channel, kind, { frame });
  } else {
    const text = await request.text();
    if (text.length > MAX_STATE_BYTES) return Response.json({ error: "The reading is too large." }, { status: 400 });
    let body: { state?: unknown } | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Handled below.
    }
    if (!body || typeof body.state !== "object" || body.state === null) return Response.json({ error: "Expected a reading." }, { status: 400 });
    put(channel, kind, { state: body.state });
  }
  // The phone learns what the computer is asking for with every send, so it needs no second request.
  return Response.json(statusOf(channel));
}

export async function GET(request: Request): Promise<Response> {
  const { url, channel, kind, hasKind } = target(request);
  if (!channel || (hasKind && !kind)) return Response.json({ error: "Expected a channel." }, { status: 400 });
  if (!kind) {
    // A status request from this computer is the pairing sheet; one with the code is the phone's page saying it is open.
    if (!isThisComputer(request)) {
      if (!isPaired(request)) return Response.json({ error: EXPIRED }, { status: 403 });
      heardFrom(channel);
    }
    return Response.json(statusOf(channel), { headers: { "cache-control": "no-store" } });
  }
  if (!isThisComputer(request)) return Response.json({ error: "Only the computer running the app can read a phone's sensors." }, { status: 403 });

  if (kind === "camera") {
    const entry = await nextFrame(channel, Number(url.searchParams.get("after")) || 0, FRAME_WAIT_MS);
    if (!entry?.frame) return new Response(null, { status: 204 });
    return new Response(Buffer.from(entry.frame), { headers: { "content-type": "image/jpeg", "x-seq": String(entry.seq), "cache-control": "no-store" } });
  }
  const entry = latest(channel, kind);
  if (!entry) return new Response(null, { status: 204 });
  return Response.json({ state: entry.state, at: entry.at }, { headers: { "cache-control": "no-store" } });
}
