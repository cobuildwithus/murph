import { createServer } from "node:http";
import { request } from "node:https";
import { describe, expect, it } from "vitest";
import { startHostedBrowserHttps } from "./helpers/hosted-browser-https.js";

describe("hosted browser TLS transport", () => {
  it("passes real Set-Cookie and request bodies while owning forwarded origin", async () => {
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(201, { "set-cookie": "__Host-test=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax" });
        res.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), host: req.headers.host, protocol: req.headers["x-forwarded-proto"], path: req.url }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("No upstream port.");
    let proxy: Awaited<ReturnType<typeof startHostedBrowserHttps>> | undefined;
    try {
      proxy = await startHostedBrowserHttps({ upstream: `http://127.0.0.1:${address.port}`, port: 0 });
      const result = await new Promise<{ status: number | undefined; cookie: string[] | undefined; body: string }>((resolve, reject) => {
        const req = request(`${proxy!.origin}/api/real?case=1`, { method: "POST", rejectUnauthorized: false,
          headers: { "x-forwarded-proto": "http", "x-forwarded-host": "untrusted.example" } }, (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => resolve({ body, cookie: res.headers["set-cookie"], status: res.statusCode }));
        });
        req.on("error", reject);
        req.end("synthetic-request");
      });
      expect(result.status).toBe(201);
      expect(result.cookie).toEqual(["__Host-test=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax"]);
      expect(JSON.parse(result.body)).toEqual({ body: "synthetic-request", host: new URL(proxy.origin).host, path: "/api/real?case=1", protocol: "https" });
    } finally {
      await proxy?.stop();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
  it("rejects non-loopback upstreams before opening a listener", async () => {
    await expect(startHostedBrowserHttps({ upstream: "https://example.test" })).rejects.toThrow("loopback");
  });
});
