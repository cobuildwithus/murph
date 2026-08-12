import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/env";
import type {
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";

const mocks = vi.hoisted(() => ({
  executeCodexManagedAccountOperation: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  sendAssistantNotification: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext: mocks.prepareHostedWakeContext,
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );

  return {
    ...actual,
    executeCodexManagedAccountOperation: mocks.executeCodexManagedAccountOperation,
    scheduleDeviceActivityTriggeredAutomations: mocks.scheduleDeviceActivityTriggeredAutomations,
    sendAssistantNotification: mocks.sendAssistantNotification,
  };
});

vi.mock("../src/hosted-runtime/device-sync-maintenance-import.ts", () => ({
  isHostedDeviceSyncMaintenanceModuleLoadError: vi.fn(() => false),
  loadHostedDeviceSyncMaintenanceModule: vi.fn(async () => ({
    runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  })),
}));

import { executeHostedMailboxEvent } from "../src/hosted-runtime/events.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const executionContext = {
  hosted: {
    memberId: "member_123",
    userEnvKeys: [],
  },
} as const;

function createRuntime(
  platformOverrides: Partial<HostedRuntimePlatform> = {},
) {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageRecordPort: null,
      ...platformOverrides,
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
    mocks.prepareHostedWakeContext.mockResolvedValue(null);
  mocks.executeCodexManagedAccountOperation.mockResolvedValue({
    kind: "disconnected",
  });
  mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValue({
    matched: 0,
    nextWakeAt: null,
    scheduled: 0,
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 1,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:20:00.000Z",
    parserProcessed: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted runtime event coverage", () => {
  it("treats activation wakes as a noop ingress lane", async () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_member_activated",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });

    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "member-activated",
      nextWakeAt: null,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
  });

  it("runs the device-sync runtime lane for device-sync wakes", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toEqual({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith({
      deviceSyncPort: null,
      platformEnv: {},
      runtimeLogPlatform: runtime.platform,
      resolvedConfig: runtime.resolvedConfig,
      timeoutMs: null,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
      wake: deviceSyncWake,
    });
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/assistant-runtime-events-coverage",
      }),
    );
  });

  it("passes foreground-yield and abort signals to device-sync wake handling", async () => {
    const runtime = createRuntime();
    const shouldYieldDeviceSync = vi.fn(() => true);
    const signal = new AbortController().signal;
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_yield",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await executeHostedMailboxEvent({
      wake: deviceSyncWake,
      executionContext,
      runtime,
      runtimeEnv: {},
      signal,
      shouldYieldDeviceSync,
      vaultRoot: "/tmp/assistant-runtime-events-coverage-yield",
    });

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
        shouldYieldDeviceSync,
      }),
    );
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).not.toHaveBeenCalled();
  });

  it("returns an assistant wake when device activity automation schedules notification work", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_activity",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      parserProcessed: 0,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 1,
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      scheduled: 1,
    });

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toMatchObject({
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      nextWakeReason: "assistant",
      postCheckpointRecord: null,
    });
  });

  it("returns an assistant wake when a device activity automation handoff is already due", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_activity_due",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      parserProcessed: 0,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 0,
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      scheduled: 0,
    });

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toMatchObject({
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      nextWakeReason: "assistant",
      postCheckpointRecord: null,
    });
  });

  it("does not fail the device-sync wake when device activity automation scheduling fails", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_activity_failure",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "conn_123",
        kind: "device-sync.dirty-processed",
        processedRevision: "rev_123",
      },
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockRejectedValueOnce(
      new Error("automation handoff unavailable"),
    );

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toMatchObject({
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      postCheckpointRecord: {
        connectionId: "conn_123",
        kind: "device-sync.dirty-processed",
        processedRevision: "rev_123",
      },
    });
  });

  it("marks Codex auth connect wakes failed when the account command does not connect", async () => {
    const update = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    const runtime = createRuntime({
      codexAuthPort: { update },
    });
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: "2026-04-08T00:15:00.000Z",
      userId: "member_123",
    });

    const result = await executeHostedMailboxEvent({
      executionContext,
      operatorHomeRoot: "/tmp/assistant-runtime-events-operator",
      runtime,
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
      wake,
    });

    expect(result).toMatchObject({
      mailboxLane: "runtime-control",
      nextWakeAt: null,
    });
    expect(result.postCheckpointRecord).toBeNull();
    expect(update).toHaveBeenCalledWith({
      attemptId: "hca_abcdefghijklmnop",
      phase: "failed",
    });
    expect(mocks.executeCodexManagedAccountOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "connect",
        codexHome: "/tmp/assistant-runtime-events-operator/.codex-hosted",
        workingDirectory: "/tmp/assistant-runtime-events-coverage",
      }),
    );
  });

  it("persists Codex auth connect failure diagnostics", async () => {
    const update = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.executeCodexManagedAccountOperation.mockRejectedValueOnce(
      new VaultCliError(
        "ASSISTANT_CODEX_AUTH_FAILED",
        "ChatGPT account authentication did not complete successfully.",
        {
          codexLoginError: "device auth failed with status 500",
          retryable: false,
        },
      ),
    );
    const runtime = createRuntime({
      codexAuthPort: { update },
      logPort: {
        async write(request) {
          logRequests.push(request);
          return { loggedCount: request.entries.length };
        },
      },
    });
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_diagnosticfailure",
      eventId: "runtime-control:codex-auth-diagnostic-failure",
      occurredAt: "2026-04-08T00:15:00.000Z",
      userId: "member_123",
    });

    await expect(
      executeHostedMailboxEvent({
        executionContext,
        operatorHomeRoot: "/tmp/assistant-runtime-events-operator",
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
        wake,
      }),
    ).resolves.toMatchObject({
      mailboxLane: "runtime-control",
      postCheckpointRecord: null,
    });

    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        attemptId: "hca_diagnosticfailure",
        component: "assistant",
        errorCode: "authorization_error",
        eventCode: "assistant.codex_auth_failed",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          action: "connect",
          errorCause: "device auth failed with status 500",
          errorCode: "authorization_error",
          safeErrorMessage: "Hosted execution authorization failed.",
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith({
      attemptId: "hca_diagnosticfailure",
      phase: "failed",
    });
  });

  it("runs Codex auth connect wakes and reports the device code", async () => {
    const update = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    mocks.executeCodexManagedAccountOperation.mockImplementationOnce(async (input) => {
      await input.onDeviceCode?.({
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/device",
      });
      return { kind: "connected" as const };
    });
    const runtime = createRuntime({
      codexAuthPort: { update },
    });
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: "2026-04-08T00:15:00.000Z",
      userId: "member_123",
    });

    const result = await executeHostedMailboxEvent({
      executionContext,
      operatorHomeRoot: "/tmp/assistant-runtime-events-operator",
      runtime,
      runtimeEnv: {
        NODE_ENV: "test",
        OPENAI_API_KEY: "test-provider-egress-credential",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "/tmp/codex-app-server",
      },
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
      wake,
    });

    expect(result).toMatchObject({
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
    });
    expect(update).toHaveBeenCalledWith({
      attemptId: "hca_abcdefghijklmnop",
      phase: "device_code",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });
    expect(mocks.executeCodexManagedAccountOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "connect",
        codexCommand: "/tmp/codex-app-server",
        codexHome: "/tmp/assistant-runtime-events-operator/.codex-hosted",
        env: {
          NODE_ENV: "test",
          [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: "/tmp/codex-app-server",
        },
        workingDirectory: "/tmp/assistant-runtime-events-coverage",
      }),
    );
  });

  it("removes local Codex auth when connect fails after writing credentials", async () => {
    const operatorHomeRoot = await mkdtemp(
      path.join(tmpdir(), "murph-codex-auth-connect-failure-"),
    );
    const authPath = path.join(operatorHomeRoot, ".codex-hosted", "auth.json");
    const update = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    mocks.executeCodexManagedAccountOperation.mockImplementationOnce(async () => {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      throw new Error("synthetic connect failure");
    });
    const runtime = createRuntime({
      codexAuthPort: { update },
    });
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_connectfailure",
      eventId: "runtime-control:codex-auth-failure",
      occurredAt: "2026-04-08T00:15:00.000Z",
      userId: "member_123",
    });

    try {
      await expect(
        executeHostedMailboxEvent({
          executionContext,
          operatorHomeRoot,
          runtime,
          runtimeEnv: {
            NODE_ENV: "test",
          },
          vaultRoot: "/tmp/assistant-runtime-events-coverage",
          wake,
        }),
      ).resolves.toMatchObject({
        mailboxLane: "runtime-control",
        postCheckpointRecord: null,
      });
      expect(update).toHaveBeenCalledWith({
        attemptId: "hca_connectfailure",
        phase: "failed",
      });
      await expect(access(authPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(operatorHomeRoot, { force: true, recursive: true });
    }
  });

  it("deletes local Codex auth when remote disconnect fails", async () => {
    const operatorHomeRoot = await mkdtemp(
      path.join(tmpdir(), "murph-codex-auth-disconnect-"),
    );
    const authPath = path.join(operatorHomeRoot, ".codex-hosted", "auth.json");
    const update = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    mocks.executeCodexManagedAccountOperation.mockRejectedValueOnce(
      new Error("synthetic disconnect failure"),
    );
    const runtime = createRuntime({
      codexAuthPort: { update },
    });
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "disconnect",
      attemptId: "hca_disconnectattempt",
      eventId: "runtime-control:codex-auth-disconnect",
      occurredAt: "2026-04-08T00:15:00.000Z",
      userId: "member_123",
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");

      await expect(
        executeHostedMailboxEvent({
          executionContext,
          operatorHomeRoot,
          runtime,
          runtimeEnv: {},
          vaultRoot: "/tmp/assistant-runtime-events-coverage",
          wake,
        }),
      ).resolves.toMatchObject({
        mailboxLane: "runtime-control",
        postCheckpointRecord: {
          attemptId: "hca_disconnectattempt",
          kind: "codex-auth.updated",
          phase: "disconnected",
        },
      });
      await expect(access(authPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(update).not.toHaveBeenCalled();
    } finally {
      await rm(operatorHomeRoot, { force: true, recursive: true });
    }
  });

  it("fails closed on unexpected wake kinds", async () => {
    await expect(
      executeHostedMailboxEvent({
        wake: {
          kind: "unexpected.event",
          eventId: "evt_unexpected",
          occurredAt: "2026-04-08T00:20:00.000Z",
          userId: "member_123",
        } as never,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).rejects.toThrow(/Unsupported hosted system wake kind\./u);
  });
});
