/**
 * Reads recent glucose readings from a Nightscout site, from the server, because most
 * Nightscout sites do not allow a browser on another address to read them.
 *
 * Like the webhook route, this fetches whatever address the caller names, which is fine on
 * localhost. Restrict the allowed hosts before deploying this anywhere others can reach.
 *
 * Body: `{ url: string, token?: string }`. Returns `{ readings: [{ at, mgDl }] }`, oldest first.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: unknown; token?: unknown } | null;

  let site: URL;
  try {
    site = new URL(typeof body?.url === "string" ? body.url.trim() : "");
  } catch {
    return Response.json({ error: "Enter the address of the Nightscout site, starting with https://" }, { status: 400 });
  }
  if (site.protocol !== "https:" && site.protocol !== "http:") {
    return Response.json({ error: "The address must start with http or https." }, { status: 400 });
  }

  // The last half hour at one reading every five minutes, with a little to spare.
  // Relative to the address given, so a site served under a path keeps working.
  const entries = new URL("api/v1/entries/sgv.json?count=8", site.href.endsWith("/") ? site.href : `${site.href}/`);
  if (typeof body?.token === "string" && body.token.trim()) {
    entries.searchParams.set("token", body.token.trim());
  }

  let response: Response;
  try {
    response = await fetch(entries, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch {
    return Response.json({ error: "That Nightscout site could not be reached." }, { status: 502 });
  }
  if (response.status === 401 || response.status === 403) {
    return Response.json({ error: "The Nightscout site refused access. Add its access token." }, { status: 401 });
  }
  if (!response.ok) {
    return Response.json({ error: `The Nightscout site returned an error (${response.status}).` }, { status: 502 });
  }

  const raw = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(raw)) {
    return Response.json({ error: "That address did not answer like a Nightscout site." }, { status: 502 });
  }
  // Nightscout reports sensor glucose as `sgv`, in mg/dL, with `date` in milliseconds.
  const readings = raw
    .filter(
      (entry): entry is { sgv: number; date: number } =>
        typeof entry?.sgv === "number" && typeof entry?.date === "number",
    )
    .map((entry) => ({ at: entry.date, mgDl: entry.sgv }))
    .sort((a, b) => a.at - b.at);
  return Response.json({ readings });
}
