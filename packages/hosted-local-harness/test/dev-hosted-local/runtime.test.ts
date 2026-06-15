import http from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  redactHostedLocalDiagnosticText,
  resolveHostedLocalWorkerPortMode,
  spawnChildProcess,
  terminateChildProcessAndWait,
  waitForFirstChildExit,
  waitForHealthyHttpEndpoint,
} from "../../src/dev-hosted-local/runtime.ts";

let workerModeServer: http.Server | null = null;

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

describe("resolveHostedLocalWorkerPortMode", () => {
  afterEach(async () => {
    if (!workerModeServer) {
      return;
    }

    await closeServer(workerModeServer);
    workerModeServer = null;
  });

  it("starts a fresh worker when the port is free", async () => {
    const port = await reserveAndReleaseLocalPort();

    await expect(resolveHostedLocalWorkerPortMode({
      allowReuseExisting: true,
      host: "127.0.0.1",
      message: "worker port busy",
      port,
      protocol: "http",
    })).resolves.toBe("start");
  });

  it("reuses an existing Murph worker health endpoint", async () => {
    const port = await listenWithResponse((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        service: "cloudflare-hosted-runner",
      }));
    });

    await expect(resolveHostedLocalWorkerPortMode({
      allowReuseExisting: true,
      host: "127.0.0.1",
      message: "worker port busy",
      port,
      protocol: "http",
    })).resolves.toBe("reuse-existing");
  });

  it("fails closed when the occupied port is not the Murph worker", async () => {
    const port = await listenWithResponse((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        service: "other-local-service",
      }));
    });

    await expect(resolveHostedLocalWorkerPortMode({
      host: "127.0.0.1",
      message: "worker port busy",
      port,
      protocol: "http",
    })).rejects.toThrow("worker port busy");
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

describe("waitForFirstChildExit", () => {
  it("observes a child that exited before listeners were attached", async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal?: NodeJS.Signals | number) => boolean;
      once: EventEmitter["once"];
      pid: number;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = 1;
    child.signalCode = null;
    child.pid = 4242;
    child.kill = () => true;

    await expect(waitForFirstChildExit([
      {
        child,
        name: "web",
      },
    ])).resolves.toMatchObject({
      name: "web",
    });
  });
});

describe("redactHostedLocalDiagnosticText", () => {
  it("redacts hosted-local provider credentials and local paths in common diagnostic formats", () => {
    const text = [
      'OPENAI_API_KEY="openai-secret"',
      '"MURPH_HOSTED_CLI_BRIDGE_TOKEN":"bridge-secret"',
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: private-jwk",
      "Bearer provider-token",
      `${process.cwd()}/apps/cloudflare/.dev.vars`,
    ].join("\n");

    const redacted = redactHostedLocalDiagnosticText(text);

    expect(redacted).toContain("OPENAI_API_KEY=<redacted>");
    expect(redacted).toContain('"MURPH_HOSTED_CLI_BRIDGE_TOKEN":<redacted>');
    expect(redacted).toContain("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: <redacted>");
    expect(redacted).toContain("Bearer <redacted>");
    expect(redacted).toContain("<redacted-path>");
    expect(redacted).not.toContain("openai-secret");
    expect(redacted).not.toContain("bridge-secret");
    expect(redacted).not.toContain("private-jwk");
    expect(redacted).not.toContain("provider-token");
    expect(redacted).not.toContain(process.cwd());
  });

  it("redacts AUTH_JSON-suffixed env values, including the dev Codex subscription auth", () => {
    const text = [
      'HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON="chatgpt-subscription-token-material"',
      '"HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON":"chatgpt-subscription-token-material"',
      'HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON={"tokens":{"access_token":"chatgpt-access-token-material"}}',
    ].join("\n");

    const redacted = redactHostedLocalDiagnosticText(text);

    expect(redacted).toContain("HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON=<redacted>");
    expect(redacted).toContain('"HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON":<redacted>');
    expect(redacted).not.toContain("chatgpt-subscription-token-material");
    expect(redacted).not.toContain("chatgpt-access-token-material");
  });
});

describe("spawnChildProcess diagnostics", () => {
  it("tails captured child output before running expensive diagnostic redaction", async () => {
    const child = spawnChildProcess(
      "web",
      process.execPath,
      [
        "-e",
        "process.stdout.write('x'.repeat(200000) + process.cwd() + '/apps/cloudflare/.dev.vars')",
      ],
      process.env,
      { pipeOutput: false },
    );

    await new Promise<void>((resolve, reject) => {
      child.child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`child exited with ${String(code)}`));
      });
    });

    const outputTail = child.stdoutTail(128);
    expect(outputTail.length).toBeLessThan(256);
    expect(outputTail).toContain("<redacted-path>");
    expect(outputTail).not.toContain(process.cwd());
  });
});

async function reserveAndReleaseLocalPort(): Promise<number> {
  const temporaryServer = http.createServer();
  const address = await listen(temporaryServer);
  await closeServer(temporaryServer);
  return address.port;
}

async function listenWithResponse(
  handler: http.RequestListener,
): Promise<number> {
  workerModeServer = http.createServer(handler);
  const address = await listen(workerModeServer);
  return address.port;
}

async function listen(input: http.Server): Promise<AddressInfo> {
  return await new Promise<AddressInfo>((resolve, reject) => {
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
}

async function closeServer(input: http.Server): Promise<void> {
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
