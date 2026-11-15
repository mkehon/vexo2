import { NextResponse, type NextRequest } from "next/server";

/**
 * Password for a deployed copy of the app.
 *
 * Every check and every sharpened rule is paid for with the server's API keys, so a link
 * anyone can open would let anyone spend them. When VEXO_PASSWORD is set, the whole app,
 * pages and API alike, asks for it through the browser's own sign-in prompt. Any username
 * is accepted. It is unset on a developer's machine, so localhost is unaffected.
 */

function sameText(a: string, b: string): boolean {
  // Compares every character so the time taken does not reveal how much of a guess was right.
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

/**
 * What a phone needs from the public address that `npm run tunnel` opens: its own page, the
 * relay it sends readings to, and speech-to-text for its microphone. Nothing else is served
 * there, so the address is no way into the app itself, its settings or its keys.
 */
const PHONE_PATHS = /^\/(phone$|api\/relay$|api\/transcribe$|_next\/|brands\/|favicon\.ico$|icon\.svg$)/;

export function proxy(request: NextRequest): NextResponse {
  // Cloudflare marks every request it forwards; requests made on this computer or its network carry neither header.
  const tunnelled = request.headers.has("cf-connecting-ip") || request.headers.has("cdn-loop");
  if (tunnelled && !PHONE_PATHS.test(request.nextUrl.pathname)) {
    return new NextResponse("This address only serves the phone's sensor page.", { status: 403 });
  }

  const password = process.env.VEXO_PASSWORD;
  if (!password) return NextResponse.next();

  const [scheme, encoded] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme === "Basic" && encoded) {
    let credentials = "";
    try {
      credentials = atob(encoded);
    } catch {
      // Not valid base64: treat as a wrong password.
    }
    const supplied = credentials.slice(credentials.indexOf(":") + 1);
    if (sameText(supplied, password)) return NextResponse.next();
  }

  return new NextResponse("Password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="vexo", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except the framework's static files, which hold nothing private.
  matcher: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
};
