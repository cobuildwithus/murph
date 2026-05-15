import { request as httpRequest, type ClientRequest } from "node:http";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostedAssistantConfigurationError } from "@murphai/assistant-runtime/hosted-assistant-env";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  classifyRunnerJobError,
  createRequestAbortController,
  startHostedContainerEntrypoint,
} from "../src/container-entrypoint.js";
import * as nodeRunner from "../src/node-runner.js";

const servers: Array<Awaited<ReturnType<typeof startHostedContainerEntrypoint>>> = [];
const nativeFetch = globalThis.fetch;
const hostedContainerRunRequestBodyLimitBytes = 8 * 1024 * 1024;

beforeEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = nativeFetch;
});

afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = nativeFetch;
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }));
});

interface ClassifiedRunnerPayload {
  code?: string;
  details?: {
    errorCodeDetail?: string;
    errorDetail?: string;
    stackPreview?: string[];
  };
  error?: string;
  errorName?: string;
}

async function sendHostedContainerJsonRequest(input: {
  authorization?: string;
  body: string;
  headers?: Record<string, string>;
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        ...(input.headers ?? {}),
        "connection": "close",
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
      path: input.path,
      port: input.port,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
          status: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.write(input.body);
    request.end();
  });
}

async function sendHostedContainerGetRequest(input: {
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        "connection": "close",
      },
      host: "127.0.0.1",
      method: "GET",
      path: input.path,
      port: input.port,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
          status: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}

async function sendHostedContainerDeclaredLengthRequest(input: {
  authorization?: string;
  contentLength: number;
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        "connection": "close",
        "content-length": String(input.contentLength),
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
      path: input.path,
      port: input.port,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
          status: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}

async function sendHostedContainerChunkedRequest(input: {
  authorization?: string;
  chunks: string[];
  path: string;
  port: number;
}): Promise<{ json: unknown; status: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        "connection": "close",
        "content-type": "application/json; charset=utf-8",
      },
      host: "127.0.0.1",
      method: "POST",
      path: input.path,
      port: input.port,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
          status: response.statusCode ?? 0,
        });
      });
    });

    request.on("error", reject);
    for (const chunk of input.chunks) {
      request.write(chunk);
    }
    request.end();
  });
}

function buildJobBody(input: {
  wake: {
    event: Record<string, unknown>;
    eventId: string;
    occurredAt: string;
  };
}) {
  const userId = typeof input.wake.event.userId === "string" ? input.wake.event.userId : "u1";

  return {
    job: {
      kind: "workspace-invocation",
      request: {
        attemptId: `attempt_${input.wake.eventId}`,
        leaseGeneration: "1",
        reason: "nudge",
        userId,
        workspaceVersion: "0",
      },
    },
  };
}

function buildWorkspaceRunnerResult() {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle" as const,
  };
}

function buildWorkspaceJobBody() {
  return {
    job: {
      kind: "workspace-invocation",
      request: {
        attemptId: "attempt_container_workspace",
        leaseGeneration: "8",
        reason: "nudge",
        userId: "u_container_workspace",
        workspaceVersion: "5",
      },
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-test",
        },
      },
    },
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

describe("startHostedContainerEntrypoint", () => {
  it("serves a lightweight health endpoint", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("accepts runtime wakes only after the active child reports readiness", async () => {
    const childReady = createDeferred();
    const releaseInvocation = createDeferred();
    let runtimeWakeCount = 0;
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        options?.onChildReadyForRuntimeWake?.(() => {
          runtimeWakeCount += 1;
          return true;
        });
        childReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const idleWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    expect(idleWake.status).toBe(204);
    expect(idleWake.headers.get("x-runtime-wake-accepted")).toBe("0");

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_ready",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await childReady.promise;

    const firstWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    const secondWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    expect(firstWake.status).toBe(204);
    expect(secondWake.status).toBe(204);
    expect(firstWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(secondWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(runtimeWakeCount).toBe(2);
    expect(invocationResponse.status).toBe(200);
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    const logInputs = mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input);
    expect(logInputs).toContainEqual(expect.objectContaining({
      details: {
        activeHostedRunnerJobCount: 1,
        activeRuntimeWakePresent: true,
        workspaceAttemptId: "attempt_evt_runtime_wake_ready",
      },
      message: "Hosted container child reported runtime wake readiness.",
      userId: null,
    }));
    expect(logInputs
      .filter((input) =>
        input.message === "Hosted container entrypoint handled runtime wake request."
      )
      .map((input) => input.details)).toEqual([
        {
          activeHostedRunnerJobCount: 0,
          activeRuntimeWakePresent: false,
          runtimeWakeAccepted: false,
          workspaceAttemptId: null,
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: true,
          workspaceAttemptId: "attempt_evt_runtime_wake_ready",
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: true,
          workspaceAttemptId: "attempt_evt_runtime_wake_ready",
        },
      ]);
  });

  it("does not mark runtime wakes accepted when the ready child cannot receive IPC", async () => {
    const childReady = createDeferred();
    const releaseInvocation = createDeferred();
    let childCanReceiveWake = false;
    vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockImplementation(
      async (_job, options) => {
        options?.onChildReadyForRuntimeWake?.(() => childCanReceiveWake);
        childReady.resolve();
        await releaseInvocation.promise;
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const invocation = fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_runtime_wake_disconnected",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    await childReady.promise;

    const rejectedWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    childCanReceiveWake = true;
    const acceptedWake = await fetch(`http://127.0.0.1:${address.port}/internal/runtime-wake`, {
      method: "POST",
    });
    releaseInvocation.resolve();
    const invocationResponse = await invocation;

    expect(rejectedWake.status).toBe(204);
    expect(rejectedWake.headers.get("x-runtime-wake-accepted")).toBe("0");
    expect(acceptedWake.status).toBe(204);
    expect(acceptedWake.headers.get("x-runtime-wake-accepted")).toBe("1");
    expect(invocationResponse.status).toBe(200);
    expect(mocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .filter((input) =>
        input.message === "Hosted container entrypoint handled runtime wake request."
      )
      .map((input) => input.details)).toEqual([
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: false,
          workspaceAttemptId: "attempt_evt_runtime_wake_disconnected",
        },
        {
          activeHostedRunnerJobCount: 1,
          activeRuntimeWakePresent: true,
          runtimeWakeAccepted: true,
          workspaceAttemptId: "attempt_evt_runtime_wake_disconnected",
        },
      ]);
  });

  it("includes runner bundle metadata on the health endpoint when the manifest is present", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        processApi: {
          async readFile(filePath: string) {
            expect(filePath.endsWith(".murph-runner-bundle-manifest.json")).toBe(true);
            return JSON.stringify({
              buildSkipped: false,
              bundleFingerprint: "bundle-fingerprint",
              generatedAt: "2026-04-24T00:00:00.000Z",
              schemaVersion: 2,
              sourceFingerprint: "source-fingerprint",
            });
          },
        },
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      runnerBundle: {
        buildSkipped: false,
        bundleFingerprint: "bundle-fingerprint",
        generatedAt: "2026-04-24T00:00:00.000Z",
        schemaVersion: 2,
        sourceFingerprint: "source-fingerprint",
      },
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("runs the managed-container OpenAI intercept smoke through the Codex client hook", async () => {
    const runOpenAiInterceptSmoke = vi.fn(async () => ({
      client: "codex" as const,
      model: "gpt-5.4-mini",
      stderrBytes: 0,
      stdoutBytes: 128,
    }));
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        runOpenAiInterceptSmoke,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerJsonRequest({
      body: "",
      path: "/internal/deploy-openai-intercept-smoke",
      port: address.port,
      headers: {
        "x-hosted-runner-bound-user-id": "member_smoke",
        "x-hosted-runtime-attempt-id": "attempt_smoke",
        "x-hosted-runtime-lease-generation": "17",
        "x-hosted-runtime-workspace-version": "42",
      },
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      ok: true,
      openAiIntercept: {
        client: "codex",
        model: "gpt-5.4-mini",
        stderrBytes: 0,
        stdoutBytes: 128,
      },
    });
    expect(runOpenAiInterceptSmoke).toHaveBeenCalledWith({
      authority: {
        attemptId: "attempt_smoke",
        leaseGeneration: "17",
        userId: "member_smoke",
        workspaceVersion: "42",
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("runs the OpenAI intercept smoke Codex process with an allowlisted environment", async () => {
    const originalPath = process.env.PATH;
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    const originalSecret = process.env.HOSTED_CONTAINER_SMOKE_SECRET_SHOULD_NOT_LEAK;
    const originalCaCert = process.env.CODEX_CA_CERTIFICATE;
    const originalSslCertFile = process.env.SSL_CERT_FILE;
    const originalAllProxy = process.env.ALL_PROXY;
    const originalHttpProxy = process.env.HTTP_PROXY;
    const originalHttpsProxy = process.env.HTTPS_PROXY;
    const originalNoProxy = process.env.NO_PROXY;
    const root = await mkdtemp(path.join(tmpdir(), "hosted-container-codex-smoke-test-"));
    const binDir = path.join(root, "bin");
    const capturePath = path.join(root, "env.json");
    const codexPath = path.join(binDir, "codex");

    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(
        codexPath,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
          "  ALL_PROXY: process.env.ALL_PROXY,",
          "  CODEX_CA_CERTIFICATE: process.env.CODEX_CA_CERTIFICATE,",
          "  CODEX_HOME: process.env.CODEX_HOME,",
          "  CODEX_CONFIG: fs.readFileSync(`${process.env.CODEX_HOME}/config.toml`, 'utf8'),",
          "  HOME: process.env.HOME,",
          "  HTTP_PROXY: process.env.HTTP_PROXY,",
          "  HTTPS_PROXY: process.env.HTTPS_PROXY,",
          "  MURPH_HOSTED_CODEX_BOUND_USER_ID: process.env.MURPH_HOSTED_CODEX_BOUND_USER_ID,",
          "  MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID: process.env.MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID,",
          "  MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION: process.env.MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION,",
          "  MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION: process.env.MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION,",
          "  NO_PROXY: process.env.NO_PROXY,",
          "  NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,",
          "  OPENAI_API_KEY: process.env.OPENAI_API_KEY,",
          "  REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,",
          "  SECRET: process.env.HOSTED_CONTAINER_SMOKE_SECRET_SHOULD_NOT_LEAK,",
          "  SSL_CERT_FILE: process.env.SSL_CERT_FILE,",
          "}));",
          "process.stdout.write('OK\\n');",
          "",
        ].join("\n"),
        "utf8",
      );
      await chmod(codexPath, 0o700);

      process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
      process.env.OPENAI_API_KEY = "real-provider-secret";
      process.env.HOSTED_CONTAINER_SMOKE_SECRET_SHOULD_NOT_LEAK = "do-not-forward";
      process.env.CODEX_CA_CERTIFICATE = "/managed-container/cloudflare-ca.pem";
      process.env.SSL_CERT_FILE = "/managed-container/ssl-cert-file.pem";
      process.env.ALL_PROXY = "http://cloudflare-local-all-proxy.example.test:8080";
      process.env.HTTP_PROXY = "http://cloudflare-local-proxy.example.test:8080";
      process.env.HTTPS_PROXY = "http://cloudflare-local-proxy.example.test:8080";
      process.env.NO_PROXY = "localhost,127.0.0.1,host.docker.internal";

      const server = await startHostedContainerEntrypoint({ port: 0 });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await sendHostedContainerJsonRequest({
        body: "",
        path: "/internal/deploy-openai-intercept-smoke",
        port: address.port,
        headers: {
          "x-hosted-runner-bound-user-id": "member_smoke",
          "x-hosted-runtime-attempt-id": "attempt_smoke",
          "x-hosted-runtime-lease-generation": "17",
          "x-hosted-runtime-workspace-version": "42",
        },
      });

      expect(response.status).toBe(200);
      expect(response.json).toMatchObject({
        ok: true,
        openAiIntercept: {
          client: "codex",
          model: "gpt-5.4-mini",
        },
      });
      const captured = JSON.parse(await readFile(capturePath, "utf8")) as Record<string, unknown>;
      expect(captured).toMatchObject({
        ALL_PROXY: "http://cloudflare-local-all-proxy.example.test:8080",
        CODEX_CA_CERTIFICATE: "/managed-container/cloudflare-ca.pem",
        HTTP_PROXY: "http://cloudflare-local-proxy.example.test:8080",
        HTTPS_PROXY: "http://cloudflare-local-proxy.example.test:8080",
        MURPH_HOSTED_CODEX_BOUND_USER_ID: "member_smoke",
        MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID: "attempt_smoke",
        MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION: "17",
        MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION: "42",
        NO_PROXY: "localhost,127.0.0.1,host.docker.internal",
        OPENAI_API_KEY: "__cloudflare_injected__",
        SSL_CERT_FILE: "/managed-container/ssl-cert-file.pem",
      });
      expect(captured.CODEX_HOME).toEqual(expect.stringContaining(".codex-smoke"));
      expect(captured.CODEX_CONFIG).toEqual(expect.stringContaining("env_http_headers"));
      expect(captured.CODEX_CONFIG).toEqual(expect.stringContaining(
        '"x-hosted-runner-bound-user-id" = "MURPH_HOSTED_CODEX_BOUND_USER_ID"',
      ));
      expect(captured.CODEX_CONFIG).toEqual(expect.stringContaining(
        '"x-hosted-runtime-attempt-id" = "MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID"',
      ));
      expect(captured.CODEX_CONFIG).toEqual(expect.stringContaining(
        '"x-hosted-runtime-lease-generation" = "MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION"',
      ));
      expect(captured.CODEX_CONFIG).toEqual(expect.stringContaining(
        '"x-hosted-runtime-workspace-version" = "MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION"',
      ));
      expect(captured.HOME).toEqual(expect.stringContaining("hosted-openai-intercept-smoke-"));
      expect(captured.NODE_EXTRA_CA_CERTS).toEqual(expect.any(String));
      expect(captured.REQUESTS_CA_BUNDLE).toEqual(expect.any(String));
      expect(captured.SECRET).toBeUndefined();
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }
      if (originalSecret === undefined) {
        delete process.env.HOSTED_CONTAINER_SMOKE_SECRET_SHOULD_NOT_LEAK;
      } else {
        process.env.HOSTED_CONTAINER_SMOKE_SECRET_SHOULD_NOT_LEAK = originalSecret;
      }
      if (originalCaCert === undefined) {
        delete process.env.CODEX_CA_CERTIFICATE;
      } else {
        process.env.CODEX_CA_CERTIFICATE = originalCaCert;
      }
      if (originalSslCertFile === undefined) {
        delete process.env.SSL_CERT_FILE;
      } else {
        process.env.SSL_CERT_FILE = originalSslCertFile;
      }
      if (originalAllProxy === undefined) {
        delete process.env.ALL_PROXY;
      } else {
        process.env.ALL_PROXY = originalAllProxy;
      }
      if (originalHttpProxy === undefined) {
        delete process.env.HTTP_PROXY;
      } else {
        process.env.HTTP_PROXY = originalHttpProxy;
      }
      if (originalHttpsProxy === undefined) {
        delete process.env.HTTPS_PROXY;
      } else {
        process.env.HTTPS_PROXY = originalHttpsProxy;
      }
      if (originalNoProxy === undefined) {
        delete process.env.NO_PROXY;
      } else {
        process.env.NO_PROXY = originalNoProxy;
      }
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects the removed legacy internal run alias", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/__internal/run`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_removed_alias",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("does not expose the removed browser-vault refresh side path", async () => {
    const runHostedWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const nodeRunnerModule = {
      ...nodeRunner,
      runHostedWorkspaceInvocation,
    };
    const loadNodeRunner = vi.fn(async () => nodeRunnerModule);
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        loadNodeRunner,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    await vi.waitFor(() => expect(loadNodeRunner).toHaveBeenCalledTimes(1));
    loadNodeRunner.mockClear();

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/browser-vault-refresh`, {
      body: "{]",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
    expect(loadNodeRunner).not.toHaveBeenCalled();
    expect(runHostedWorkspaceInvocation).not.toHaveBeenCalled();
  });

  it("does not expose the removed warm-shell health side route", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/control-health`);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("logs a structured listen failure when the container cannot start", async () => {
    await expect(startHostedContainerEntrypoint({
      port: -1,
    })).rejects.toThrow();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          port: -1,
        }),
        level: "error",
        message: "Hosted container entrypoint failed to start listening.",
        phase: "failed",
      }),
    );
  });

  it("returns a stable invalid JSON error for malformed invocation requests", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: "{]",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "syntax_error",
      details: {
        errorDetail: expect.stringContaining("Expected property name or '}'"),
      },
      error: "Invalid JSON.",
      errorName: "SyntaxError",
    });
  });

  it("rejects oversized invocation requests before parsing JSON", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerDeclaredLengthRequest({
      contentLength: hostedContainerRunRequestBodyLimitBytes + 1,
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    expect(response.status).toBe(413);
    expect(response.json).toEqual({
      code: "request_body_too_large",
      error: "Request body too large.",
    });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized invocation requests while receiving the body", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerChunkedRequest({
      chunks: [
        " ".repeat(hostedContainerRunRequestBodyLimitBytes),
        " ",
      ],
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    expect(response.status).toBe(413);
    expect(response.json).toEqual({
      code: "request_body_too_large",
      error: "Request body too large.",
    });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("decodes invocation requests without bearer-token auth", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: "{]",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "syntax_error",
      error: "Invalid JSON.",
    });
  });

  it("preloads the node runner after listen while parsing requests through hosted runtime contracts", async () => {
    const requestBody = buildJobBody({
      wake: {
        event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u_loader_split" },
        eventId: "evt_loader_split",
        occurredAt: "2026-04-21T12:00:00.000Z",
      },
    });
    const actualContractsModule =
      await vi.importActual<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>(
        "@murphai/assistant-runtime/hosted-runtime-contracts",
      );
    const parsedJob =
      actualContractsModule.parseHostedAssistantWorkspaceRuntimeJobInput(requestBody.job);
    const parseHostedAssistantWorkspaceRuntimeJobInput = vi.fn(() => parsedJob);
    const contractsModule = {
      ...actualContractsModule,
      parseHostedAssistantWorkspaceRuntimeJobInput,
    };
    const runHostedWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const nodeRunnerModule = {
      ...await vi.importActual<typeof import("../src/node-runner.js")>("../src/node-runner.js"),
      runHostedWorkspaceInvocation,
    };
    const loadRuntimeContracts = vi.fn(async () => contractsModule);
    const loadNodeRunner = vi.fn(async () => nodeRunnerModule);

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        loadNodeRunner,
        loadRuntimeContracts,
      },
    });
    servers.push(server);

    expect(loadNodeRunner).toHaveBeenCalledTimes(1);
    expect(loadRuntimeContracts).not.toHaveBeenCalled();

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(requestBody),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(loadRuntimeContracts).toHaveBeenCalledTimes(1);
    expect(loadNodeRunner).toHaveBeenCalledTimes(1);
    expect(parseHostedAssistantWorkspaceRuntimeJobInput).toHaveBeenCalledWith(requestBody.job);
    expect(runHostedWorkspaceInvocation).toHaveBeenCalledWith(
      {
        ...parsedJob,
        kind: "workspace-invocation",
      },
      expect.objectContaining({
      }),
    );
  });

  it("parses workspace-invocation requests through the workspace contract before invoking the node runner", async () => {
    const requestBody = buildWorkspaceJobBody();
    const actualContractsModule =
      await vi.importActual<typeof import("@murphai/assistant-runtime/hosted-runtime-contracts")>(
        "@murphai/assistant-runtime/hosted-runtime-contracts",
      );
    const parsedJob =
      actualContractsModule.parseHostedAssistantWorkspaceRuntimeJobInput(requestBody.job);
    const parseHostedAssistantWorkspaceRuntimeJobInput = vi.fn(() => parsedJob);
    const contractsModule = {
      ...actualContractsModule,
      parseHostedAssistantWorkspaceRuntimeJobInput,
    };
    const runHostedWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const nodeRunnerModule = {
      ...await vi.importActual<typeof import("../src/node-runner.js")>("../src/node-runner.js"),
      runHostedWorkspaceInvocation,
    };
    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        loadNodeRunner: vi.fn(async () => nodeRunnerModule),
        loadRuntimeContracts: vi.fn(async () => contractsModule),
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(requestBody),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(parseHostedAssistantWorkspaceRuntimeJobInput).toHaveBeenCalledWith(requestBody.job);
    expect(runHostedWorkspaceInvocation).toHaveBeenCalledWith(
      {
        ...parsedJob,
        kind: "workspace-invocation",
      },
      expect.objectContaining({
      }),
    );
  });

  it("keeps startup healthy when the background node-runner preload fails", async () => {
    const loadNodeRunner = vi.fn(async () => {
      throw new Error("preload failed");
    });

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        loadNodeRunner,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "container",
          level: "error",
          message: "Hosted runner runtime preload failed.",
          phase: "failed",
        }),
      );
    });

    const response = await sendHostedContainerGetRequest({
      path: "/health",
      port: address.port,
    });

    expect(loadNodeRunner).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("forwards only the hosted runner job and abort signal into the node runner", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_direct_proxy_token_only",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(runnerSpy).toHaveBeenCalledTimes(1);
      expect(runnerSpy.mock.calls[0]?.[1]).toEqual({
        onChildReadyForRuntimeWake: expect.any(Function),
        signal: expect.any(AbortSignal),
      });
    } finally {
      runnerSpy.mockRestore();
    }
  });

  it("returns a stable invalid request error when the run body is not an object", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(["not-an-object"]),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "type_error",
      details: {
        errorDetail: "Hosted container runner request must be an object.",
      },
      error: "Invalid request.",
      errorName: "TypeError",
    });
  });

  it("surfaces the failing nested request field when the hosted runtime job payload is malformed", async () => {
    const server = await startHostedContainerEntrypoint({
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify({
        ...buildJobBody({
          wake: {
            event: {
              kind: "member.activated",
              memberChannels: {
                email: false,
                linq: false,
                telegram: false,
              },
              userId: "member_123",
            },
            eventId: "evt_bad_nested_field",
            occurredAt: "2026-04-01T00:00:00.000Z",
          },
        }),
        job: {
          ...buildJobBody({
            wake: {
              event: {
                kind: "member.activated",
                memberChannels: {
                  email: false,
                  linq: false,
                  telegram: false,
                },
                userId: "member_123",
              },
              eventId: "evt_bad_nested_field",
              occurredAt: "2026-04-01T00:00:00.000Z",
            },
          }).job,
          runtime: {
            userEnv: {
              OPENAI_API_KEY: 123,
            },
          },
        },
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "type_error",
      details: {
        errorDetail: expect.stringContaining("config.userEnv.OPENAI_API_KEY must be a string"),
      },
      error: "Invalid request.",
      errorName: "TypeError",
    });
  });

  it("surfaces safe downstream runtime TypeError diagnostics after request decoding succeeds", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockRejectedValue(
      new TypeError("missing hosted runtime config"),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_type_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "type_error",
        details: {
          detailsPresent: false,
          errorMessagePresent: true,
          errorName: "TypeError",
          stackPresent: true,
        },
        error: "Hosted execution runtime failed.",
        errorName: "TypeError",
      });
      expect(JSON.stringify(payload)).not.toContain("missing hosted runtime config");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns metadata-only downstream child process failure diagnostics", async () => {
    const hiddenStderrTail = "hidden child stderr tail";
    const hiddenStdoutTail = "hidden child stdout tail";
    const hiddenAbortReason = "hidden child abort reason";
    const hiddenCompletionKind = "hidden_completion_kind";
    const spy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockRejectedValue(
      Object.assign(new Error("hidden child failure message"), {
        details: {
          childRuntimeErrorCode: "invalid_request",
          childRuntimeErrorName: "Error",
          childRuntimeErrorStatus: 404,
          childRuntimeFailureKind: "control_plane_http",
          childRuntimeHttpOperation: "workspace_read",
          childRuntimeStage: "runtime.in-process",
          childProcess: {
            abortedByParent: false,
            abortReasonMessage: hiddenAbortReason,
            abortReasonName: "AbortError",
            exitCode: 1,
            firstCompletionKind: hiddenCompletionKind,
            runtimeWakeReady: true,
            signal: "SIGTERM",
            stderrTail: hiddenStderrTail,
            stderrTailLineCount: 2,
            stderrTailMarkers: [
              "module_resolution_failed",
              "hidden_code_marker",
            ],
            stdoutTail: hiddenStdoutTail,
            stdoutTailLineCount: 1,
            stdoutTailMarkers: ["hosted_child_prepared"],
          },
          errorDetail: "hidden child detail",
        },
      }),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_child_process_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as Record<string, unknown>;
      expect(payload).toMatchObject({
        code: "runtime_error",
        details: {
          childProcess: {
            abortedByParent: false,
            abortReasonMessagePresent: true,
            abortReasonName: "AbortError",
            exitCode: 1,
            runtimeWakeReady: true,
            signal: "SIGTERM",
            stderrTailLineCount: 2,
            stderrTailMarkers: ["module_resolution_failed"],
            stderrTailPresent: true,
            stdoutTailLineCount: 1,
            stdoutTailMarkers: ["hosted_child_prepared"],
            stdoutTailPresent: true,
          },
          childRuntimeErrorCode: "invalid_request",
          childRuntimeErrorName: "Error",
          childRuntimeErrorStatus: 404,
          childRuntimeFailureKind: "control_plane_http",
          childRuntimeHttpOperation: "workspace_read",
          childRuntimeStage: "runtime.in-process",
          detailsKeys: [
            "childProcess",
            "childRuntimeErrorCode",
            "childRuntimeErrorName",
            "childRuntimeErrorStatus",
            "childRuntimeFailureKind",
            "childRuntimeHttpOperation",
            "childRuntimeStage",
            "errorDetail",
          ],
          errorDetailPresent: true,
          errorMessagePresent: true,
          errorName: "Error",
          stackPresent: true,
        },
        error: "Hosted execution runtime failed.",
        errorName: "Error",
      });
      const serializedPayload = JSON.stringify(payload);
      expect(serializedPayload).not.toContain("hidden child failure message");
      expect(serializedPayload).not.toContain("hidden child detail");
      expect(serializedPayload).not.toContain(hiddenAbortReason);
      expect(serializedPayload).not.toContain(hiddenCompletionKind);
      expect(serializedPayload).not.toContain("firstCompletionKind");
      expect(serializedPayload).not.toContain(hiddenStderrTail);
      expect(serializedPayload).not.toContain(hiddenStdoutTail);
      expect(serializedPayload).not.toContain("hidden_code_marker");

      const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
        .map(([input]) => input)
        .find((input) => input.message === "Hosted container entrypoint failed a runner job.");
      expect(failureLogInput).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          childProcess: expect.objectContaining({
            stderrTailMarkers: ["module_resolution_failed"],
            stderrTailPresent: true,
            stdoutTailMarkers: ["hosted_child_prepared"],
            stdoutTailPresent: true,
          }),
          childRuntimeErrorCode: "invalid_request",
          childRuntimeErrorName: "Error",
          childRuntimeErrorStatus: 404,
          childRuntimeFailureKind: "control_plane_http",
          childRuntimeHttpOperation: "workspace_read",
          childRuntimeStage: "runtime.in-process",
        }),
        userId: null,
      }));
      const serializedFailureLog = JSON.stringify(failureLogInput);
      expect(serializedFailureLog).not.toContain("hidden child failure message");
      expect(serializedFailureLog).not.toContain("hidden child detail");
      expect(serializedFailureLog).not.toContain(hiddenAbortReason);
      expect(serializedFailureLog).not.toContain(hiddenCompletionKind);
      expect(serializedFailureLog).not.toContain("firstCompletionKind");
      expect(serializedFailureLog).not.toContain(hiddenStderrTail);
      expect(serializedFailureLog).not.toContain(hiddenStdoutTail);
      expect(serializedFailureLog).not.toContain("hidden_code_marker");
    } finally {
      spy.mockRestore();
    }
  });

  it("drops non-allowlisted child runtime error diagnostics at the entrypoint boundary", async () => {
    const hiddenErrorName = "UntrustedCustomErrorName";
    const hiddenErrorCode = "untrusted_custom_error_code";
    const spy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockRejectedValue(
      Object.assign(new Error("hidden child failure message"), {
        details: {
          childRuntimeErrorCode: hiddenErrorCode,
          childRuntimeErrorName: hiddenErrorName,
          childRuntimeErrorStatus: 499,
          childRuntimeFailureKind: "unclassified_runtime_error",
          childRuntimeHttpOperation: "hidden_http_operation",
          childRuntimeStage: "runtime.in-process",
        },
      }),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_child_untrusted_diagnostics",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as Record<string, unknown>;
      expect(payload).toMatchObject({
        details: {
          childRuntimeErrorStatus: 499,
          childRuntimeFailureKind: "unclassified_runtime_error",
          childRuntimeStage: "runtime.in-process",
        },
      });
      const serializedPayload = JSON.stringify(payload);
      expect(serializedPayload).not.toContain(hiddenErrorName);
      expect(serializedPayload).not.toContain(hiddenErrorCode);
      expect(serializedPayload).not.toContain("hidden_http_operation");

      const failureLogInput = mocks.emitHostedExecutionStructuredLog.mock.calls
        .map(([input]) => input)
        .find((input) => input.message === "Hosted container entrypoint failed a runner job.");
      expect(failureLogInput).toEqual(expect.objectContaining({
        details: expect.objectContaining({
          childRuntimeErrorStatus: 499,
          childRuntimeFailureKind: "unclassified_runtime_error",
          childRuntimeStage: "runtime.in-process",
        }),
      }));
      const serializedFailureLog = JSON.stringify(failureLogInput);
      expect(serializedFailureLog).not.toContain(hiddenErrorName);
      expect(serializedFailureLog).not.toContain(hiddenErrorCode);
      expect(serializedFailureLog).not.toContain("hidden_http_operation");
    } finally {
      spy.mockRestore();
    }
  });

  it("redacts downstream runtime secrets while surfacing safe failure diagnostics", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockRejectedValue(
      new Error("Authorization: Bearer placeholder for ops@example.com OPENAI_API_KEY=placeholder"),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_secret_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "authorization_error",
        details: {
          detailsPresent: false,
          errorMessagePresent: true,
          errorName: "Error",
          stackPresent: true,
        },
        error: "Hosted execution authorization failed.",
        errorName: "Error",
      });
      const serializedPayload = JSON.stringify(payload);
      expect(serializedPayload).not.toContain("placeholder");
      expect(serializedPayload).not.toContain("ops@example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns safe configuration error details from the inner hosted runtime", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockRejectedValue(
      new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        "Hosted assistant defaults are missing.",
      ),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_runtime_config_error",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
        })),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(503);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        details: {
          detailsPresent: false,
          errorCodeDetail: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
          errorMessagePresent: true,
          stackPresent: true,
        },
        error: "Hosted execution configuration is invalid.",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("passes the workspace-invocation context through request parsing into the node runner", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        port: 0,
      });
      servers.push(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
      }

      const requestBody = buildWorkspaceJobBody();
      const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            attemptId: "attempt_container_workspace",
            leaseGeneration: "8",
            userId: "u_container_workspace",
            workspaceVersion: "5",
          }),
        }),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects concurrent invocation requests inside one warm container shell", async () => {
    const server = await startHostedContainerEntrypoint({ port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const firstRequest: {
      finish: () => void;
      responsePromise: Promise<{ json: unknown; status: number }>;
    } = (() => {
      let request!: ClientRequest;
      const responsePromise = new Promise<{ json: unknown; status: number }>((resolve, reject) => {
        const initializedRequest = httpRequest({
          headers: {
            connection: "close",
            "content-type": "application/json; charset=utf-8",
          },
          host: "127.0.0.1",
          method: "POST",
          path: "/internal/workspace-invocation",
          port: address.port,
        }, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            const bodyText = Buffer.concat(chunks).toString("utf8");
            resolve({
              json: bodyText.length > 0 ? JSON.parse(bodyText) : null,
              status: response.statusCode ?? 0,
            });
          });
        });
        request = initializedRequest;
        initializedRequest.on("error", reject);
        initializedRequest.write("{");
      });
      return {
        finish: () => {
          request.end();
        },
        responsePromise,
      };
    })();

    const secondResponse = await sendHostedContainerJsonRequest({
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_busy",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      path: "/internal/workspace-invocation",
      port: address.port,
    });
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.json).toEqual({
      error: "Hosted runner is busy.",
    });

    firstRequest.finish();
    const firstResponse = await firstRequest.responsePromise;
    expect(firstResponse.status).toBe(400);
    expect(firstResponse.json).toMatchObject({
      code: "syntax_error",
      details: {
        errorDetail: expect.stringContaining("Expected property name or '}'"),
      },
      error: "Invalid JSON.",
      errorName: "SyntaxError",
    });
  });

  it("aborts the hosted job when the response closes before completion", async () => {
    const request = new EventEmitter();
    const response = new EventEmitter() as EventEmitter & { writableEnded: boolean };
    response.writableEnded = false;

    const controller = createRequestAbortController(request, response);

    response.emit("close");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(Error);
    expect((controller.signal.reason as Error).message).toMatch(/response closed before completion/u);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        details: expect.objectContaining({
          exitReason: "response.closed",
        }),
        level: "warn",
        message: "Hosted container entrypoint exited because the response closed before completion.",
        phase: "failed",
      }),
    );

    controller.cleanup();
  });

  it("ignores non-descendant sibling processes during warm-container cleanup", async () => {
    const siblingPid = process.pid + 1000;

    const readdir = vi.fn(async () => [
      { isDirectory: () => true, name: String(process.pid) },
      { isDirectory: () => true, name: String(siblingPid) },
    ]);
    const readFile = vi.fn(async (filePath: string) => {
      if (String(filePath).endsWith(`/${siblingPid}/stat`)) {
        return `${siblingPid} (proxy) S 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      }

      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        processApi: { readFile, readdir },
        processIsolation: true,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_sibling_cleanup",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(readdir).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalled();
  });

  it("runs warm-container cleanup after a failed runner job", async () => {
    const childPid = process.pid + 1500;
    let killed = false;
    const kill = vi.fn(() => {
      killed = true;
    });
    const exit = vi.fn();
    const readdir = vi.fn(async () => [
      { isDirectory: () => true, name: String(process.pid) },
      { isDirectory: () => true, name: String(childPid) },
    ]);
    const readFile = vi.fn(async (filePath: string) => {
      if (String(filePath).endsWith(`/${childPid}/stat`)) {
        const state = killed ? "Z" : "S";
        return `${childPid} (child) ${state} ${process.pid} 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      }

      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockRejectedValue(
      new TypeError("missing hosted runtime config"),
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
        processApi: { kill, readFile, readdir },
        processIsolation: true,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_failed_cleanup",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(500);
    const payload = await response.json() as ClassifiedRunnerPayload;
    expect(payload).toMatchObject({
      code: "type_error",
      error: "Hosted execution runtime failed.",
    });
    expect(kill).toHaveBeenCalledWith(childPid, "SIGKILL");
    expect(readdir).toHaveBeenCalledTimes(3);
    expect(exit).not.toHaveBeenCalled();
  });

  it("kills daemonized same-user processes created during a warm-container job", async () => {
    const daemonPid = process.pid + 1750;
    let runnerStarted = false;
    let killed = false;
    const kill = vi.fn(() => {
      killed = true;
    });
    const readdir = vi.fn(async () => [
      { isDirectory: () => true, name: String(process.pid) },
      ...(runnerStarted ? [{ isDirectory: () => true, name: String(daemonPid) }] : []),
    ]);
    const readFile = vi.fn(async (filePath: string) => {
      if (String(filePath).endsWith(`/${process.pid}/stat`)) {
        return `${process.pid} (node) S 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      }

      if (String(filePath).endsWith(`/${process.pid}/status`)) {
        return "Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n";
      }

      if (String(filePath).endsWith(`/${daemonPid}/stat`)) {
        const state = killed ? "Z" : "S";
        return `${daemonPid} (daemon) ${state} 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      }

      if (String(filePath).endsWith(`/${daemonPid}/status`)) {
        return "Name:\tdaemon\nUid:\t1000\t1000\t1000\t1000\n";
      }

      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockImplementation(
      async () => {
        runnerStarted = true;
        return buildWorkspaceRunnerResult();
      },
    );

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        processApi: { kill, readFile, readdir },
        processIsolation: true,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_daemon_cleanup",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(daemonPid, "SIGKILL");
    expect(readdir).toHaveBeenCalledTimes(3);
  });

  it("still rejects lingering descendant processes after the cleanup pass", async () => {
    const childPid = process.pid + 2000;

    const kill = vi.fn();
    const exit = vi.fn();
    const readdir = vi.fn(async () => [
      { isDirectory: () => true, name: String(process.pid) },
      { isDirectory: () => true, name: String(childPid) },
    ]);
    const readFile = vi.fn(async (filePath: string) => {
      if (String(filePath).endsWith(`/${childPid}/stat`)) {
        return `${childPid} (child) S ${process.pid} 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      }

      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(buildWorkspaceRunnerResult());

    const server = await startHostedContainerEntrypoint({
      port: 0,
      runtime: {
        exitScheduler: exit,
        processApi: { kill, readFile, readdir },
        processIsolation: true,
      },
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/workspace-invocation`, {
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_descendant_cleanup",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(500);
    const payload = await response.json() as ClassifiedRunnerPayload;
    expect(payload).toMatchObject({
      code: "runtime_error",
      details: {
        detailsPresent: false,
        errorMessagePresent: true,
        stackPresent: true,
      },
      error: "Hosted execution runtime failed.",
    });
    expect(JSON.stringify(payload)).not.toContain(String(childPid));
    expect(kill).toHaveBeenCalledWith(childPid, "SIGKILL");
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe("classifyRunnerJobError", () => {
  it("returns a configuration failure payload for hosted assistant config errors", () => {
    const classified = classifyRunnerJobError(
      new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        "Hosted assistant defaults are missing.",
      ),
    );

    expect(classified).toMatchObject({
      payload: {
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        details: {
          detailsPresent: false,
          errorCodeDetail: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
          errorMessagePresent: true,
          stackPresent: true,
        },
        error: "Hosted execution configuration is invalid.",
      },
      statusCode: 503,
    });
  });

  it("surfaces safe generic runner failure metadata", () => {
    const classified = classifyRunnerJobError(new Error("boom"));

    expect(classified).toMatchObject({
      payload: {
        code: "runtime_error",
        details: {
          detailsPresent: false,
          errorMessagePresent: true,
          errorName: "Error",
          stackPresent: true,
        },
        error: "Hosted execution runtime failed.",
        errorName: "Error",
      },
      statusCode: 500,
    });
    expect(JSON.stringify(classified.payload)).not.toContain("boom");
  });

  it("surfaces bundle-validation failures with their dedicated code and safe properties", () => {
    const classified = classifyRunnerJobError(
      Object.assign(new Error("Hosted bundle archive is invalid."), {
        code: "bundle_archive_validation_error",
        details: {
          bundleArchiveOperation: "runner-input",
          bundleRefPresent: false,
        },
        name: "HostedBundleArchiveValidationError",
        operation: "runner-input",
      }),
    );

    expect(classified).toMatchObject({
      payload: {
        code: "bundle_archive_validation_error",
        details: {
          detailsKeys: ["bundleArchiveOperation", "bundleRefPresent"],
          detailsPresent: true,
          errorCodeDetail: "bundle_archive_validation_error",
          errorMessagePresent: true,
          stackPresent: true,
        },
        error: "Hosted bundle archive validation failed.",
        errorName: "HostedBundleArchiveValidationError",
      },
      statusCode: 500,
    });
  });
});
