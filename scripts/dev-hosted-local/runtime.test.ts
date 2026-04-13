import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { waitForHealthyHttpEndpoint } from "./runtime.ts";

describe("waitForHealthyHttpEndpoint", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    server = null;
  });

  it("accepts a slow cold-start health response before timing out the individual request", async () => {
    server = http.createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok");
      }, 6_000).unref();
    });

    const address = await new Promise<http.AddressInfo>((resolve, reject) => {
      server?.listen(0, "127.0.0.1", () => {
        const value = server?.address();
        if (!value || typeof value === "string") {
          reject(new Error("Expected a TCP listener address."));
          return;
        }

        resolve(value);
      });
      server?.once("error", reject);
    });

    await expect(waitForHealthyHttpEndpoint({
      host: "127.0.0.1",
      label: "test-server",
      path: "/health",
      port: address.port,
      protocol: "http",
    })).resolves.toBeUndefined();
  });
});
