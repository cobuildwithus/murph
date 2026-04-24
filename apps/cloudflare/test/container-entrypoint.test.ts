import { request as httpRequest, type ClientRequest } from "node:http";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
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

function buildJobBody(input: {
  wake: {
    event: Record<string, unknown>;
    eventId: string;
    occurredAt: string;
  };
  run?: {
    attempt: number;
    runId: string;
    startedAt: string;
  };
}) {
  const run = input.run ?? {
    attempt: 1,
    runId: `run_${input.wake.eventId}`,
    startedAt: input.wake.occurredAt,
  };
  const wake = {
    ...input.wake.event,
    eventId: input.wake.eventId,
    occurredAt: input.wake.occurredAt,
  };
  const userId = typeof input.wake.event.userId === "string" ? input.wake.event.userId : "u1";
  const triggerKind = input.wake.event.kind === "runtime.timer"
    && typeof input.wake.event.triggerKind === "string"
    ? input.wake.event.triggerKind
    : "external_ingress";

  return {
    internalWorkerProxyToken: "proxy-token",
    job: {
      request: {
        bundle: null,
        currentBundleRef: null,
        run,
        runDrain: {
          acquiredAt: input.wake.occurredAt,
          events: [
            {
              seq: "1",
              wake,
              ingressEventId: `wake_${input.wake.eventId}`,
            },
          ],
          inputCommittedSeq: "0",
          inputCursorVersion: "1",
          runId: run.runId,
          triggerKind,
          userId,
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

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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

  it("initializes the in-memory runner control token from the first authorized request", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockResolvedValue({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });
    const server = await startHostedContainerEntrypoint({
      controlToken: null,
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const accepted = await sendHostedContainerJsonRequest({
      authorization: "Bearer first-runner-token",
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_first_control_token",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
      })),
      path: "/internal/run",
      port: address.port,
    });
    const rejected = await sendHostedContainerJsonRequest({
      authorization: "Bearer second-runner-token",
      body: JSON.stringify(buildJobBody({
        wake: {
          event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
          eventId: "evt_wrong_control_token",
          occurredAt: "2026-03-26T12:01:00.000Z",
        },
      })),
      path: "/internal/run",
      port: address.port,
    });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(401);
    expect(rejected.json).toEqual({ error: "Unauthorized" });
    expect(runnerSpy).toHaveBeenCalledTimes(1);
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

  it("returns a stable invalid JSON error for malformed run requests", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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

  it("rejects unauthorized run requests before decoding the body", async () => {
    const server = await startHostedContainerEntrypoint({
      controlToken: "runner-token",
      port: 0,
    });
    servers.push(server);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected the hosted container entrypoint to expose a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    const parsedJob = actualContractsModule.parseHostedAssistantRuntimeJobInput(requestBody.job);
    const parseHostedAssistantRuntimeJobInput = vi.fn(() => parsedJob);
    const contractsModule = {
      ...actualContractsModule,
      parseHostedAssistantRuntimeJobInput,
    };
    const runHostedExecutionJob = vi.fn().mockResolvedValue({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });
    const nodeRunnerModule = {
      ...await vi.importActual<typeof import("../src/node-runner.js")>("../src/node-runner.js"),
      runHostedExecutionJob,
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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    expect(parseHostedAssistantRuntimeJobInput).toHaveBeenCalledWith(requestBody.job);
    expect(runHostedExecutionJob).toHaveBeenCalledWith(
      parsedJob,
      expect.objectContaining({
        internalWorkerProxyToken: "proxy-token",
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

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(loadNodeRunner).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  });

  it("forwards the per-run proxy token and local bridge config into the node runner", async () => {
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockResolvedValue({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

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

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
        internalWorkerProxyToken: "proxy-token",
        localInternalProxyBaseUrl: null,
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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockRejectedValue(
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

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockRejectedValue(
      new Error("Authorization: Bearer secret-token for ops@example.com OPENAI_API_KEY=sk-live-secret"),
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

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockRejectedValue(
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

      const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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

  it("passes the hosted run context through request parsing into the node runner", async () => {
    const spy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockResolvedValue({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: { eventsHandled: 1, summary: "ok" },
      },
    });

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

      const run = {
        attempt: 4,
        runId: "run_trace",
        startedAt: "2026-03-26T12:00:00.000Z",
      };
      const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
        body: JSON.stringify(buildJobBody({
          wake: {
            event: { kind: "runtime.timer", triggerKind: "runtime_timer", userId: "u1" },
            eventId: "evt_with_run",
            occurredAt: "2026-03-26T12:00:00.000Z",
          },
          run,
        })),
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
            run,
            runDrain: expect.objectContaining({
              events: expect.arrayContaining([
                expect.objectContaining({
                  wake: expect.objectContaining({
                    eventId: "evt_with_run",
                  }),
                }),
              ]),
            }),
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

  it("rejects concurrent run requests inside one warm container shell", async () => {
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
          path: "/internal/run",
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
      path: "/internal/run",
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
    const runnerSpy = vi.spyOn(nodeRunner, "runHostedExecutionJob").mockResolvedValue({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    vi.spyOn(nodeRunner, "runHostedExecutionJob").mockRejectedValue(
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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
    expect(readdir).toHaveBeenCalledTimes(2);
    expect(exit).not.toHaveBeenCalled();
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
    vi.spyOn(nodeRunner, "runHostedExecutionJob").mockResolvedValue({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "ok",
        },
      },
    });

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

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/run`, {
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
});
