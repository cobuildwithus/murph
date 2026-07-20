import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

let server: http.Server | null = null;

describe("assertPortAvailable", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    if (server !== null) {
      await closeServer(server);
      server = null;
    }
  });

  it("fails closed when a port is occupied", async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("other service");
    });
    const port = await listen(server);

    const { assertPortAvailable } = await import("../../src/dev-hosted-local/runtime.ts");

    await expect(assertPortAvailable(
      "127.0.0.1",
      port,
      "web port busy",
    )).rejects.toThrow("web port busy");
  });

  it("never signals an occupied port owner", async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("existing web");
    });
    const port = await listen(server);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(
      (() => true) as typeof process.kill,
    );

    const { assertPortAvailable } = await import("../../src/dev-hosted-local/runtime.ts");

    await expect(assertPortAvailable(
      "127.0.0.1",
      port,
      "web port busy",
    )).rejects.toThrow("web port busy");

    expect(killSpy).not.toHaveBeenCalled();
  });
});

async function listen(input: http.Server): Promise<number> {
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    input.listen(0, "127.0.0.1", () => {
      const value = input.address();
      if (!value || typeof value === "string") {
        reject(new Error("Expected a TCP listener address."));
        return;
      }

      resolve(value);
    });
    input.once("error", reject);
  });
  return address.port;
}

async function closeServer(input: http.Server): Promise<void> {
  if (!input.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    input.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
