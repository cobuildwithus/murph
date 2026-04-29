import http from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  terminateChildProcessAndWait,
  waitForHealthyHttpEndpoint,
} from "./runtime.ts";

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

    const address = await new Promise<AddressInfo>((resolve, reject) => {
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

describe("terminateChildProcessAndWait", () => {
  it("escalates to SIGKILL when the child ignores the initial graceful signal", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal?: NodeJS.Signals | number) => boolean;
      once: EventEmitter["once"];
      pid: number;
    };
    const killCalls: Array<NodeJS.Signals | number | undefined> = [];
    child.exitCode = null;
    child.pid = 4242;
    child.kill = (signal?: NodeJS.Signals | number) => {
      killCalls.push(signal);
      if (signal === "SIGKILL") {
        child.exitCode = 137;
        queueMicrotask(() => {
          child.emit("exit", 137, "SIGKILL");
        });
      }
      return true;
    };

    await terminateChildProcessAndWait(child, {
      graceMs: 1,
      signal: "SIGTERM",
    });

    expect(killCalls).toEqual(["SIGTERM", "SIGKILL"]);
    platformSpy.mockRestore();
  });

  it("terminates the detached process group after the direct child has exited", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal?: NodeJS.Signals | number) => boolean;
      once: EventEmitter["once"];
      pid: number;
    };
    const groupSignals: Array<NodeJS.Signals | number | undefined> = [];
    let gracefulSignalSent = false;
    child.exitCode = 0;
    child.pid = 5252;
    child.kill = vi.fn(() => true);
    const killSpy = vi.spyOn(process, "kill").mockImplementation((
      ((pid: number, signal?: NodeJS.Signals | number) => {
        if (pid !== -child.pid) {
          return true;
        }

        groupSignals.push(signal);
        if (signal === 0 && gracefulSignalSent) {
          const error = new Error("process group exited") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        if (signal === "SIGTERM") {
          gracefulSignalSent = true;
        }
        return true;
      }) as typeof process.kill
    ));

    try {
      await terminateChildProcessAndWait(child, {
        graceMs: 1,
        signal: "SIGTERM",
      });
    } finally {
      killSpy.mockRestore();
      platformSpy.mockRestore();
    }

    expect(groupSignals).toContain("SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });
});
