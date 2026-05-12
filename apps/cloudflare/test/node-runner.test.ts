import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantWorkspaceRuntimeJobResult,
  HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import {
  buildHostedExecutionJobRuntime,
  createHostedWorkspaceInvocationRunner,
} from "../src/node-runner.ts";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../src/runtime-mailbox-payload-decode-contract.ts";
import {
  createHostedRunnerNativeParserToolchain,
} from "../src/runner-native-parser-toolchain.ts";
import type { HostedExecutionWorkspaceInvocationJobInput } from "../src/runner-job-transport.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const cleanupPaths: string[] = [];

describe("createHostedWorkspaceInvocationRunner", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      })
    ));
  });

  it("routes workspace-invocation jobs through the workspace runtime without run authority", async () => {
    vi.stubEnv("VAULT", "/tmp/hosted-workspace-in-process-vault");
    const request = createWorkspaceRequest("member_workspace_node");
    const result = createWorkspaceResult();
    const buildRuntime = vi.fn((runtime: HostedAssistantRuntimeConfig) => ({
      ...runtime,
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    }));
    const runWorkspaceInProcess = vi.fn(async () => result);
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime,
      runMode: "in-process",
      runWorkspaceInProcess,
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
      request,
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-test",
        },
      },
    }, {
    })).resolves.toEqual(result);

    expect(buildRuntime).toHaveBeenCalledWith({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    });
    expect(runWorkspaceInProcess).toHaveBeenCalledWith(
      {
        request,
        runtime: expect.objectContaining({
          forwardedEnv: {
            HOSTED_ASSISTANT_MODEL: "gpt-test",
          },
        }),
      },
      expect.objectContaining({
        createCheckpointSnapshot: expect.any(Function),
        importItem: expect.any(Function),
        platform: expect.objectContaining({
          artifactStore: expect.any(Object),
          effectsPort: expect.any(Object),
        }),
        vaultRoot: "/tmp/hosted-workspace-in-process-vault",
      }),
    );
  });

  it("uses proxy mailbox decoding in-process when no local proxy base URL is present", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-node-runner-decode-"));
    cleanupPaths.push(vaultRoot);
    vi.stubEnv("VAULT", vaultRoot);
    const request = createWorkspaceRequest("member_workspace_decode");
    const importItem = createSystemMailboxImportItem(request.userId);
    const result = createWorkspaceResult();
    const fetchMock = vi.fn(async (
      requestInfo: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestObject = requestInfo instanceof Request
        ? requestInfo
        : new Request(requestInfo, init);
      expect(requestObject.url).toBe(
        `https://worker.example.test/__murph/runtime-callback/users/${request.userId}/web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`,
      );
      expect(requestObject.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
      expect(requestObject.headers.get("x-hosted-runtime-attempt-id")).toBe(
        request.attemptId,
      );
      expect(requestObject.headers.get("x-hosted-runtime-lease-generation")).toBe(
        request.leaseGeneration,
      );
      expect(requestObject.headers.get("x-hosted-runtime-workspace-version")).toBe(
        request.workspaceVersion,
      );
      await expect(requestObject.json()).resolves.toMatchObject({
        payloadCiphertext: "opaque-mailbox-ciphertext",
      });

      return new Response(JSON.stringify({
        status: "decoded",
        wake: createSystemMailboxWake(importItem.item),
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const runWorkspaceInProcess = vi.fn(async (
      _input: unknown,
      options: HostedWorkspaceRuntimeJobOptions,
    ) => {
      await expect(options.importItem(importItem)).resolves.toEqual({
        reasonCode: "system_mailbox.queued",
        status: "imported",
      });
      return result;
    });
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime: (runtime) => ({
        ...runtime,
        platformEnv: {},
      }),
      runMode: "in-process",
      runWorkspaceInProcess,
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
      request,
      runtime: {
        platformEnv: {},
      },
    }, {
      runtimeCallbackBaseUrl: "https://worker.example.test",
    })).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails mailbox import instead of falling back to platformEnv when proxy decode fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-node-runner-decode-"));
    cleanupPaths.push(vaultRoot);
    vi.stubEnv("VAULT", vaultRoot);
    const request = createWorkspaceRequest("member_workspace_decode_failure");
    const importItem = createSystemMailboxImportItem(request.userId);
    const fetchMock = vi.fn(async (): Promise<Response> =>
      new Response(JSON.stringify({
        error: "decode unavailable",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 503,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const runWorkspaceInProcess = vi.fn(async (
      _input: unknown,
      options: HostedWorkspaceRuntimeJobOptions,
    ) => {
      await options.importItem(importItem);
      return createWorkspaceResult();
    });
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime: (runtime) => ({
        ...runtime,
        platformEnv: {},
      }),
      runMode: "in-process",
      runWorkspaceInProcess,
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
      request,
      runtime: {
        platformEnv: {},
      },
    }, {
      runtimeCallbackBaseUrl: "https://worker.example.test",
    })).rejects.toMatchObject({
      status: 503,
      statusCode: 503,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards workspace jobs and abort options into isolated runner mode", async () => {
    const request = createWorkspaceRequest("member_isolated_node");
    const result = createWorkspaceResult();
    const controller = new AbortController();
    const runIsolated = vi.fn(async () => result);
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime: (runtime) => runtime,
      runIsolated,
      runMode: "isolated",
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
      request,
      runtime: {
        forwardedEnv: {
          OPENAI_API_KEY: "job-openai-key",
        },
      },
    }, {
      signal: controller.signal,
    })).resolves.toEqual(result);

    expect(runIsolated).toHaveBeenCalledWith(
      expect.objectContaining({
        job: {
          kind: "workspace-invocation",
          request,
          runtime: {
            forwardedEnv: {
              OPENAI_API_KEY: "job-openai-key",
            },
          },
        },
      }),
      {
        signal: controller.signal,
      },
    );
  });
});

describe("buildHostedExecutionJobRuntime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses caller-provided runtime env instead of ambient process env", () => {
    for (const [key, value] of Object.entries(createHostedExecutionTestEnv())) {
      if (typeof value === "string") {
        vi.stubEnv(key, value);
      }
    }
    vi.stubEnv("HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS", "CUSTOM_API_KEY");

    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
        HOSTED_ASSISTANT_MODEL: "gpt-test",
        OPENAI_API_KEY: "job-openai-key",
      },
      userEnv: {
        CUSTOM_API_KEY: "secret-value",
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-test",
      OPENAI_API_KEY: "job-openai-key",
    });
    expect(runtime.userEnv).toEqual({
      CUSTOM_API_KEY: "secret-value",
    });
  });

  it("uses runner image parser defaults instead of stale forwarded parser paths", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        FFMPEG_COMMAND: "/stale/ffmpeg",
        HOSTED_ASSISTANT_MODEL: "gpt-test",
        WHISPER_COMMAND: "/stale/whisper-cli",
        WHISPER_MODEL_PATH: "/stale/model.bin",
      },
    });

    expect(runtime.parserToolchain).toEqual(createHostedRunnerNativeParserToolchain());
  });

  it("rebases stale requested parser toolchain onto runner image defaults", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
      parserToolchain: {
        tools: {
          whisper: {
            command: "/stale/whisper-cli",
            modelPath: "/stale/model.bin",
          },
        },
      },
    });

    expect(runtime.parserToolchain).toEqual(createHostedRunnerNativeParserToolchain());
  });

  it("preserves the worker-serialized local e2e parser toolchain", () => {
    const parserToolchain = {
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
        },
      },
    };

    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
      parserToolchain,
    });

    expect(runtime.parserToolchain).toEqual(parserToolchain);
  });

  it("rebases malformed local e2e parser toolchain paths onto runner image defaults", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
      parserToolchain: {
        tools: {
          ffmpeg: {
            command: "/app/test-parser-toolchain/../other-bin/ffmpeg",
          },
          pdfinfo: {
            command: "/stale/pdfinfo",
          },
          pdftotext: {
            command: "/usr/bin/pdftotext",
          },
          whisper: {
            command: "/app/test-parser-toolchain/whisper-cli",
            modelPath: "/app/test-parser-toolchain/ggml-test.bin",
          },
        },
      },
    });

    expect(runtime.parserToolchain).toEqual(createHostedRunnerNativeParserToolchain());
  });

  it("rejects parserToolchain:null instead of falling back to ambient discovery", () => {
    expect(() =>
      buildHostedExecutionJobRuntime(JSON.parse(
        '{"forwardedEnv":{},"parserToolchain":null}',
      ))
    ).toThrow(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  });
});

function createWorkspaceRequest(
  userId: string,
): HostedExecutionWorkspaceInvocationJobInput["request"] {
  return {
    attemptId: `attempt_${userId}`,
    budget: {
      maxMailboxItems: 10,
    },
    leaseGeneration: "3",
    reason: "nudge",
    userId,
    workspaceVersion: "2",
  };
}

function createWorkspaceResult(): HostedAssistantWorkspaceRuntimeJobResult {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle",
  };
}

function createSystemMailboxImportItem(userId: string) {
  const item = {
    createdAt: "2026-05-01T00:00:00.000Z",
    dedupeKey: "event:node-runner-decode",
    expiresAt: null,
    id: "mailbox_item_node_runner_decode",
    kind: "member.channels.updated" as const,
    lane: "system" as const,
    laneSeq: "1",
    occurredAt: "2026-05-01T00:00:00.000Z",
    payloadBytes: 64,
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_node_runner_decode",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: "2026-05-01T00:00:00.000Z",
    userId,
  };

  return {
    item,
    payload: {
      payloadCiphertext: "opaque-mailbox-ciphertext",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_node_runner_decode",
      source: "sidecar" as const,
      status: "resolved" as const,
    },
    route: {
      action: "apply-member-channels-update" as const,
      advanceProgress: true as const,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route" as const,
    },
  };
}

function createSystemMailboxWake(item: ReturnType<typeof createSystemMailboxImportItem>["item"]) {
  return {
    eventId: item.dedupeKey,
    kind: item.kind,
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: item.occurredAt,
    userId: item.userId,
  };
}
