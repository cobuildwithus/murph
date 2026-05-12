import { request as httpRequest, type ClientRequest } from "node:http";
import { EventEmitter } from "node:events";

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

describe("startHostedContainerEntrypoint", () => {
  it("serves a lightweight health endpoint", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
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

  it("includes runner bundle metadata on the health endpoint when the manifest is present", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
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

  it("rejects the removed legacy internal run alias", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("returns gone for the removed browser-vault refresh side path after auth without loading the runner", async () => {
    const runHostedWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const nodeRunnerModule = {
      ...nodeRunner,
      runHostedWorkspaceInvocation,
    };
    const loadNodeRunner = vi.fn(async () => nodeRunnerModule);
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: "browser_vault_refresh_removed",
      error: "Browser-vault refresh side path removed.",
    });
    expect(loadNodeRunner).not.toHaveBeenCalled();
    expect(runHostedWorkspaceInvocation).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        level: "info",
        message: "Hosted container entrypoint rejected removed browser-vault refresh side path.",
        phase: "failed",
      }),
    );
  });

  it("rejects unauthorized removed browser-vault refresh requests without route details", async () => {
    const runHostedWorkspaceInvocation = vi.fn().mockResolvedValue(buildWorkspaceRunnerResult());
    const nodeRunnerModule = {
      ...nodeRunner,
      runHostedWorkspaceInvocation,
    };
    const loadNodeRunner = vi.fn(async () => nodeRunnerModule);
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
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
    mocks.emitHostedExecutionStructuredLog.mockClear();

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/browser-vault-refresh`, {
      body: "{]",
      headers: {
        authorization: "Bearer stale-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(loadNodeRunner).not.toHaveBeenCalled();
    expect(runHostedWorkspaceInvocation).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "container",
        level: "warn",
        message: "Hosted container entrypoint rejected an unauthorized request.",
        phase: "failed",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Hosted container entrypoint rejected removed browser-vault refresh side path.",
      }),
    );
  });

  it("fails closed when the initial runner control token header is missing", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
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
          eventId: "evt_missing_token",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects a first run bearer token when no startup control token exists", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const rejected = await sendHostedContainerJsonRequest({
      authorization: "Bearer first-runner-token",
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_first_control_token",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      path: "/internal/workspace-invocation",
      port: address.port,
    });

    expect(rejected.status).toBe(401);
    expect(rejected.json).toEqual({ error: "Unauthorized" });
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("requires the startup control token for control-health probes", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const rejected = await fetch(`http://127.0.0.1:${address.port}/internal/control-health`, {
      headers: {
        authorization: "Bearer stale-token",
      },
    });
    expect(rejected.status).toBe(401);
    await expect(rejected.json()).resolves.toEqual({ error: "Unauthorized" });

    const accepted = await fetch(`http://127.0.0.1:${address.port}/internal/control-health`, {
      headers: {
        authorization: "Bearer runner-token",
      },
    });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("logs a structured listen failure when the container cannot start", async () => {
    await expect(startHostedContainerEntrypoint({
      controlToken: "runner-token",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerDeclaredLengthRequest({
      authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await sendHostedContainerChunkedRequest({
      authorization: "Bearer runner-token",
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

  it("rejects unauthorized invocation requests before decoding the body", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
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
        authorization: "Bearer runner-tokez",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
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

  it("forwards the invocation proxy token and local bridge config into the node runner", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedWorkspaceInvocation").mockResolvedValue(
      buildWorkspaceRunnerResult(),
    );

    try {
      const server = await startHostedContainerEntrypoint({
        controlToken: "runner-token",
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
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(runnerSpy).toHaveBeenCalledTimes(1);
      expect(runnerSpy.mock.calls[0]?.[1]).toEqual({
        runtimeCallbackBaseUrl: null,
        signal: expect.any(AbortSignal),
      });
    } finally {
      runnerSpy.mockRestore();
    }
  });

  it("returns a stable invalid request error when the run body is not an object", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
        controlToken: "runner-token",
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
          Authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "type_error",
        details: {
          errorDetail: "missing hosted runtime config",
        },
        error: "Hosted execution runtime failed.",
        errorName: "TypeError",
      });
      expect(payload.details?.stackPreview).toEqual(expect.any(Array));
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
        controlToken: "runner-token",
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
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(500);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "authorization_error",
        details: {
          errorDetail: "Authorization=Bearer [redacted] for [redacted-email] OPENAI_API_KEY=[redacted]",
        },
        error: "Hosted execution authorization failed.",
        errorName: "Error",
      });
      expect(payload.details?.stackPreview).toEqual(expect.any(Array));
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
        controlToken: "runner-token",
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
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });

      expect(response.status).toBe(503);
      const payload = await response.json() as ClassifiedRunnerPayload;
      expect(payload).toMatchObject({
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        details: {
          errorCodeDetail: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        },
        error: "Hosted assistant defaults are missing.",
      });
      expect(payload.details?.stackPreview).toEqual(expect.any(Array));
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
        controlToken: "runner-token",
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
          authorization: "Bearer runner-token",
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
    const server = await startHostedContainerEntrypoint({ controlToken: "runner-token", port: 0 });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const headers = {
      authorization: "Bearer runner-token",
    };

    const firstRequest: {
      finish: () => void;
      responsePromise: Promise<{ json: unknown; status: number }>;
    } = (() => {
      let request!: ClientRequest;
      const responsePromise = new Promise<{ json: unknown; status: number }>((resolve, reject) => {
        const initializedRequest = httpRequest({
          headers: {
            authorization: headers.authorization,
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
      authorization: headers.authorization,
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
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
      controlToken: "runner-token",
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
        authorization: "Bearer runner-token",
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });

    expect(response.status).toBe(500);
    const payload = await response.json() as ClassifiedRunnerPayload;
    expect(payload).toMatchObject({
      code: "runtime_error",
      error: "Hosted execution runtime failed.",
    });
    expect(payload.details?.errorDetail).toContain(String(childPid));
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
          errorCodeDetail: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        },
        error: "Hosted assistant defaults are missing.",
      },
      statusCode: 503,
    });
    expect((classified.payload as ClassifiedRunnerPayload).details?.stackPreview).toEqual(expect.any(Array));
  });

  it("surfaces safe generic runner failure metadata", () => {
    const classified = classifyRunnerJobError(new Error("boom"));

    expect(classified).toMatchObject({
      payload: {
        code: "runtime_error",
        details: {
          errorDetail: "boom",
        },
        error: "Hosted execution runtime failed.",
        errorName: "Error",
      },
      statusCode: 500,
    });
    expect((classified.payload as ClassifiedRunnerPayload).details?.stackPreview).toEqual(expect.any(Array));
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
          bundleArchiveOperation: "runner-input",
          bundleRefPresent: false,
          errorDetail: "Hosted bundle archive is invalid.",
          errorProperties: {
            operation: "runner-input",
          },
        },
        error: "Hosted bundle archive validation failed.",
        errorName: "HostedBundleArchiveValidationError",
      },
      statusCode: 500,
    });
  });
});
