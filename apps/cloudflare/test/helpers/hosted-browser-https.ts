import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/** Real local TLS/cookie transport; this adapter never changes application responses. */
export async function startHostedBrowserHttps(input: { upstream: string; port?: number }) {
  const upstream = new URL(input.upstream);
  if (upstream.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(upstream.hostname)
    || upstream.pathname !== "/" || upstream.username || upstream.password) {
    throw new Error("Browser TLS upstream must be a loopback HTTP origin.");
  }
  const directory = await mkdtemp(join(tmpdir(), "murph-browser-tls-"));
  try {
    await promisify(execFile)("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ], { timeout: 30_000 });
    const server = createServer({
      cert: await readFile(join(directory, "cert.pem")),
      key: await readFile(join(directory, "key.pem")),
    }, (incoming, outgoing) => {
      // The TLS ingress is authoritative; never forward attacker-supplied origin metadata.
      const address = server.address();
      if (!address || typeof address === "string") { outgoing.writeHead(503).end(); return; }
      const host = `localhost:${address.port}`;
      const forwarded = request(upstream, {
        path: incoming.url ?? "/",
        headers: { ...incoming.headers, host, "x-forwarded-host": host, "x-forwarded-proto": "https" },
        method: incoming.method,
      }, (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      });
      forwarded.setTimeout(120_000, () => forwarded.destroy());
      forwarded.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
      outgoing.on("close", () => forwarded.destroy());
      incoming.pipe(forwarded);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port ?? 3443, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Browser TLS address unavailable.");
    return {
      origin: `https://localhost:${address.port}`,
      async stop() {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
        await rm(directory, { force: true, recursive: true });
      },
    };
  } catch {
    await rm(directory, { force: true, recursive: true });
    throw new Error("Local browser TLS setup failed; check openssl and the dedicated port.");
  }
}
