import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode-terminal/vendor/QRCode";
import QRErrorCorrectLevel from "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel";
import { isThisComputer } from "@/lib/local";
import { isChannel, pairingCode } from "@/lib/relay";

/**
 * The link a phone opens to become a sensor for this computer, and a QR code of it.
 * GET ?channel -> `{ url, qr, via }`, where `qr` is an SVG; `url` is null when there is no network.
 *
 * A phone's browser only gives a page its camera over https. While `npm run tunnel` is running
 * the link is its public address, which works from any network. Otherwise it is the https
 * entrance that `npm run dev` opens on the local network (see scripts/dev.mjs).
 */

/** This computer's address on the local network, preferring Wi-Fi or Ethernet over virtual interfaces. */
function networkAddress(): string | null {
  const found: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) found.push({ name, address: entry.address });
    }
  }
  const rank = ({ name, address }: { name: string; address: string }) =>
    (name.startsWith("en") ? 0 : 2) + (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b))[0]?.address ?? null;
}

/** The public address opened by `npm run tunnel`, while that is still running. */
function tunnelAddress(): string | null {
  try {
    const saved = JSON.parse(readFileSync(path.join(process.cwd(), ".vexo", "public-url.json"), "utf8")) as { url?: string; pid?: number };
    if (!saved.url || !saved.pid) return null;
    // Signal 0 only asks whether the process exists; it throws when the tunnel has gone.
    process.kill(saved.pid, 0);
    return saved.url;
  } catch {
    return null;
  }
}

function qrSvg(text: string): string {
  const code = new QRCode(-1, QRErrorCorrectLevel.M);
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  const margin = 2;
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) path += `M${column + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const size = count + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export async function GET(request: Request): Promise<Response> {
  if (!isThisComputer(request)) {
    return Response.json(
      { error: "Pairing a phone works when the app is running on your own computer and opened there, at http://localhost:3000. Here, open this page on the phone itself to use its sensors." },
      { status: 403 },
    );
  }
  const channel = new URL(request.url).searchParams.get("channel");
  if (!isChannel(channel)) return Response.json({ error: "Expected a channel." }, { status: 400 });
  const tunnel = tunnelAddress();
  const address = networkAddress();
  if (!tunnel && !address) return Response.json({ url: null, qr: null, via: null });
  // The code at the end is what lets this phone, and nothing else that finds the address, send to the relay.
  const page = `/phone?as=${channel}&k=${pairingCode()}`;
  const url = tunnel ? `${tunnel}${page}` : `https://${address}:${process.env.PHONE_PORT ?? 3443}${page}`;
  return Response.json({ url, qr: qrSvg(url), via: tunnel ? "tunnel" : "wifi" });
}
