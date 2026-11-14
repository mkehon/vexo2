// Starts the app for development with two entrances:
//   - http://localhost:PORT for this computer
//   - https://<this computer's network address>:PHONE_PORT for phones on the same network
//
// Browsers only allow camera access on https pages (localhost is the one exception), so a
// phone cannot use a plain http link to this computer. The https entrance forwards to the
// same dev server, using a self-signed certificate kept in .certs/.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPort = Number(process.env.PORT ?? 3000);
const phonePort = Number(process.env.PHONE_PORT ?? 3443);
const CERT_LIFETIME_DAYS = 365;

/** Addresses a phone on the same network can reach this computer at. */
function networkHosts() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  const hosts = [...new Set(addresses)];
  if (process.platform === "darwin") {
    try {
      // The Bonjour name stays the same when the network changes, unlike the IP address.
      const name = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim();
      if (name) hosts.push(`${name}.local`);
    } catch {
      // No Bonjour name: the IP addresses are enough.
    }
  }
  return hosts;
}

function certificateFor(hosts) {
  const dir = path.join(root, ".certs");
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  const hostsPath = path.join(dir, "hosts.json");

  let covered = [];
  try {
    covered = JSON.parse(readFileSync(hostsPath, "utf8"));
  } catch {
    // No certificate yet.
  }
  // Keep the existing certificate while it covers every address, so a phone that accepted
  // it does not have to accept a new one each time the server starts.
  const reusable =
    existsSync(keyPath) &&
    existsSync(certPath) &&
    hosts.every((host) => covered.includes(host)) &&
    Date.now() - statSync(certPath).mtimeMs < (CERT_LIFETIME_DAYS - 30) * 86_400_000;

  if (!reusable) {
    mkdirSync(dir, { recursive: true });
    const names = ["DNS:localhost", "IP:127.0.0.1", ...hosts.map((host) => `${net.isIP(host) ? "IP" : "DNS"}:${host}`)];
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
        "-days", String(CERT_LIFETIME_DAYS),
        "-keyout", keyPath,
        "-out", certPath,
        "-subj", "/CN=vexo dev server",
        "-addext", `subjectAltName=${names.join(",")}`,
        "-addext", "extendedKeyUsage=serverAuth",
      ],
      { stdio: "ignore" },
    );
    writeFileSync(hostsPath, JSON.stringify(hosts));
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

/** An https server that forwards everything to the dev server on this computer. */
function phoneEntrance(tls) {
  const server = https.createServer(tls, (request, response) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: appPort,
        method: request.method,
        path: request.url,
        // Marks the request as coming from another device, which may not change the API keys.
        headers: { ...request.headers, "x-vexo-remote": "1" },
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("The dev server is still starting. Reload in a moment.");
    });
    request.pipe(upstream);
  });

  // Live reload uses a WebSocket, which is forwarded as a raw connection.
  server.on("upgrade", (request, socket, head) => {
    const upstream = net.connect(appPort, "127.0.0.1", () => {
      const headers = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        headers.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
      }
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return server;
}

// The dev server listens on this computer only; the https entrance is the one way in from the network.
const next = spawn(
  process.execPath,
  [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(appPort), "-H", "127.0.0.1"],
  { cwd: root, stdio: "inherit" },
);
next.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => next.kill(signal));
}

const hosts = networkHosts();
if (hosts.length === 0) {
  console.log("\n  No network connection found, so there is no phone link.\n");
} else {
  const server = phoneEntrance(certificateFor(hosts));
  server.on("error", (error) => console.error(`\n  Phone link unavailable: ${error.message}\n`));
  server.listen(phonePort, "0.0.0.0", () => {
    const links = hosts.map((host) => `https://${host}:${phonePort}`);
    console.log(`\n  This computer:  http://localhost:${appPort}`);
    console.log(`  Phone, on the same Wi-Fi:`);
    for (const link of links) console.log(`    ${link}`);
    console.log("");
    qrcode.generate(links[0], { small: true }, (code) => console.log(code.replace(/^/gm, "  ")));
    console.log('  The first time, the phone warns that the connection is not private.');
    console.log('  Tap "Show Details", then "visit this website".\n');
  });
}
