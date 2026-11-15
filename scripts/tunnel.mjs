// Opens a public https address for phones that cannot reach this computer directly, which is
// the usual case on office, hotel and event Wi-Fi where devices are kept apart.
//
// It runs a Cloudflare quick tunnel to the dev server and records the address in .vexo/, where
// the app picks it up for the code it shows when pairing a phone. The address only serves the
// phone's sensor page and the endpoints that page sends to (see proxy.ts); the app itself, its
// settings and its keys are not reachable through it. Stop it with Ctrl+C.
//
// Needs `cloudflared` (brew install cloudflared) and `npm run dev` running.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPort = Number(process.env.PORT ?? 3000);
const record = path.join(root, ".vexo", "public-url.json");

const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${appPort}`], { stdio: ["ignore", "pipe", "pipe"] });
tunnel.on("error", (error) => {
  console.error(error.code === "ENOENT" ? "\n  cloudflared is not installed. Install it with: brew install cloudflared\n" : `\n  The tunnel could not start: ${error.message}\n`);
  process.exit(1);
});

let announced = false;
const read = (chunk) => {
  const address = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!address || announced) return;
  announced = true;
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, JSON.stringify({ url: address, pid: process.pid }));
  console.log(`\n  Phones can now reach this computer from any network, through ${address}`);
  console.log("  In the app, pick iPhone or Android phone as a device and scan the code it shows.");
  console.log("  Only the phone's sensor page is served at this address. Ctrl+C closes it.\n");
};
tunnel.stdout.on("data", read);
tunnel.stderr.on("data", read);

const close = () => {
  rmSync(record, { force: true });
  tunnel.kill();
};
tunnel.on("exit", (code) => {
  rmSync(record, { force: true });
  if (!announced) console.error("\n  The tunnel closed before it gave an address. Check that this computer is online.\n");
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, close);
