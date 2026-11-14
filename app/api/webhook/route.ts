/**
 * Posts a rule's payload to the webhook URL from the server, because browsers block
 * cross-origin POSTs to services like Slack and Zapier.
 *
 * This forwards to any URL the caller names, which is fine on localhost. Restrict the
 * allowed hosts before deploying this anywhere others can reach.
 *
 * Body: `{ url: string, payload: object }`. Returns `{ ok, status }` or `{ ok: false, error }`.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    payload?: unknown;
  } | null;

  let target: URL;
  try {
    target = new URL(typeof body?.url === "string" ? body.url : "");
  } catch {
    return Response.json({ ok: false, error: "That is not a valid URL." }, { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return Response.json({ ok: false, error: "The URL must start with http or https." }, { status: 400 });
  }

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body?.payload ?? {}),
      signal: AbortSignal.timeout(10_000),
    });
    return Response.json({ ok: response.ok, status: response.status });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    return Response.json({ ok: false, error: `Could not reach the webhook: ${reason}` }, { status: 502 });
  }
}
