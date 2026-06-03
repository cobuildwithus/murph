import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

let server: http.Server | null = null;

describe("assertHostedWebPortAvailable", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
    if (server !== null) {
      await closeServer(server);
      server = null;
    }
  });

  it("fails closed when an occupied web port is not a Murph hosted-web dev process", async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("other service");
    });
    const port = await listen(server);

    const { assertHostedWebPortAvailable } = await import("../../src/dev-hosted-local/runtime.ts");

    await expect(assertHostedWebPortAvailable({
      host: "127.0.0.1",
      message: "web port busy",
      port,
    })).rejects.toThrow("web port busy");
  });

  it("recovers a lockless Murph hosted-web dev listener on the requested port", async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.end("stale web");
    });
    const port = await listen(server);
    const repoRoot = process.cwd().replace(/\\/gu, "/");
    const listenerPid = 4242;
    const ownerPid = 4241;
    const processGroupId = 4000;
    let ownerAlive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((
      pid: number,
      signal?: NodeJS.Signals | number,
    ) => {
      if (pid === ownerPid && signal === "SIGTERM" && server !== null) {
        ownerAlive = false;
        void closeServer(server).then(() => {
          server = null;
        });
      }
      return true;
    }) as typeof process.kill);

    vi.doMock("node:child_process", async () => {
      const actual = await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );

      return {
        ...actual,
        execFileSync: vi.fn((command: string, args: readonly string[]) => {
          if (command === "lsof") {
            return ownerAlive ? `${listenerPid}\n` : "";
          }
          if (command === "ps" && args.includes(String(listenerPid))) {
            return ` ${ownerPid} ${processGroupId} next-server\n`;
          }
          if (command === "ps" && args.includes(String(ownerPid))) {
            return [
              ` 1 ${processGroupId}`,
              `node ${repoRoot}/node_modules/.bin/tsx`,
              `${repoRoot}/apps/web/scripts/dev-local.ts`,
              "-- --hostname 127.0.0.1",
              `--port ${port}`,
            ].join(" ");
          }

          throw new Error(`unexpected command: ${command}`);
        }),
      };
    });

    const { assertHostedWebPortAvailable } = await import("../../src/dev-hosted-local/runtime.ts");

    await expect(assertHostedWebPortAvailable({
      host: "127.0.0.1",
      message: "web port busy",
      port,
    })).resolves.toBeUndefined();

    expect(killSpy).toHaveBeenCalledWith(ownerPid, "SIGTERM");
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
