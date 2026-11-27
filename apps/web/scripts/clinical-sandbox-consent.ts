import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:https";
import { readClinicalResponseBytes } from "../src/lib/clinical-records/response-bytes";
import { clinicalReturnQuery } from "../src/lib/clinical-records/return-query";

export async function step<T>(label: string, run: () => Promise<T>) {
  try {
    const result = await run();
    console.log(label, "PASS");
    return result;
  } catch {
    console.log(label, "FAIL");
    throw new Error("Sandbox proof failed");
  }
}

export async function readJson(url: string, headers?: HeadersInit) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  assert(response.ok);
  const bytes = await readClinicalResponseBytes(response, 1024 * 1024);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function receiveCode(redirect: URL, tls: { cert: Buffer; key: Buffer }, authorizationUrl: string, state: string) {
  const server = createServer(tls);
  const launch = new URL(`/start/${randomUUID()}`, redirect.origin);
  let launched = false;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Consent timed out")), 600_000);
      server.once("close", () => clearTimeout(timer));
      server.once("error", reject);
      server.on("request", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        const url = URL.parse(req.url ?? "/", redirect.origin);
        if (req.method !== "GET" || req.headers.host !== redirect.host || url?.origin !== redirect.origin) {
          res.writeHead(404).end();
          return;
        }
        if (!launched && url.href === launch.href) {
          launched = true;
          res.writeHead(302, { Location: authorizationUrl }).end();
          return;
        }
        if (url.pathname !== redirect.pathname) {
          res.writeHead(404).end();
          return;
        }
        const query = clinicalReturnQuery(url.searchParams);
        if (!query || query.get("state") !== state) {
          res.writeHead(400).end();
          return;
        }
        res.end("Return to the terminal.");
        const code = query.get("code");
        if (code) resolve(code);
        else reject(new Error("Consent declined"));
      });
      server.listen(Number(redirect.port), redirect.hostname, () => {
        // The browser never inherits the sandbox client ID or signing key.
        // Node skips undefined entries.
        const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
        for (const name of ["PATH", "HOME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
          env[name] = process.env[name];
        }
        const browser = spawn(process.platform === "darwin" ? "open" : "xdg-open", [launch.href], { env, stdio: "ignore" });
        browser.once("error", reject);
        browser.once("exit", status => { if (status !== 0) reject(new Error("Browser launch failed")); });
      });
    });
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
