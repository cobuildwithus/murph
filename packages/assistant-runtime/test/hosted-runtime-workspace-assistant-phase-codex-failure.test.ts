import {
  createMemberActionSystemMailboxItem,
  createPhaseInput,
  loadHostedSystemMailboxRealImplementation,
  mocks,
  runHostedWorkspaceAssistantPhase,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import { initializeVault } from "@murphai/core";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { describe, expect, it, vi } from "vitest";
import { executeHostedMailboxEvent } from "../src/hosted-runtime/events.ts";
import {
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxProgress,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedMailboxEvent: vi.fn(),
}));

const NOW = "2026-04-27T00:00:00.000Z";
const RETRY_AT = "2026-04-27T00:01:00.000Z";
const CONNECTION_LOST = "ASSISTANT_CODEX_CONNECTION_LOST";
const SAFE_MESSAGE = "Synthetic mailbox failure.";
const PRIVATE = "PRIVATE_CODEX_DETAIL_DO_NOT_EMIT_8d3c";

function failure(context?: unknown, code: string = CONNECTION_LOST): VaultCliError {
  const error = new VaultCliError(code, SAFE_MESSAGE);
  Object.defineProperty(error, "context", { value: context });
  return error;
}

async function expectFailureWarning(
  error: unknown,
  expectedDiagnostics: Readonly<Record<string, string | number>>,
  expectedError = { code: CONNECTION_LOST, message: SAFE_MESSAGE },
): Promise<void> {
  const workspace = await createHostedRuntimeWorkspace("mailbox-codex-failure-");
  const logRequests: HostedRuntimeLogRequest[] = [];
  const recordMemberActionOutcome = vi.fn(async () => {});
  const phaseInput = createPhaseInput({
    logRequests,
    now: () => NOW,
    operatorHomeRoot: workspace.operatorHomeRoot,
    vaultRoot: workspace.vaultRoot,
  });
  phaseInput.runtime.platform.mailboxPort = {
    recordMemberActionOutcome,
    async fetch() { throw new Error("Unexpected mailbox fetch."); },
    async fetchPayload() { throw new Error("Unexpected payload fetch."); },
  };
  const systemMailbox = await loadHostedSystemMailboxRealImplementation();
  const item = {
    ...createMemberActionSystemMailboxItem(),
    attemptCount: 0,
    mailboxLaneSeq: "1",
    postCheckpointRecord: null,
  };

  try {
    await initializeVault({ createdAt: NOW, vaultRoot: workspace.vaultRoot });
    await systemMailbox.restoreHostedSystemMailboxCheckpointRollbackState({
      state: { pending: [item] },
      vaultRoot: workspace.vaultRoot,
    });
    const initial = await readHostedSystemMailboxState(workspace.vaultRoot);
    vi.mocked(executeHostedMailboxEvent).mockRejectedValueOnce(error);
    const preparation = await systemMailbox.prepareHostedSystemMailboxItemForCheckpoint({
      now: () => NOW,
      runtime: phaseInput.runtime,
      runtimeEnv: phaseInput.runtimeEnv,
      vaultRoot: workspace.vaultRoot,
    });
    if (preparation?.status !== "retryable_failed") {
      throw new Error("Expected the real preparation catch to retain failed work.");
    }
    expect(preparation).toMatchObject({
      attemptCount: 1,
      errorCode: expectedError.code,
      errorMessage: expectedError.message,
      nextWakeAt: RETRY_AT,
    });
    const retained = await readHostedSystemMailboxState(workspace.vaultRoot);
    expect(retained.pending).toEqual([{
      ...initial.pending[0],
      attemptCount: 1,
      lastAttemptAt: NOW,
      lastErrorCode: expectedError.code,
      lastErrorMessage: expectedError.message,
      nextAttemptAt: RETRY_AT,
      postCheckpointRecord: null,
      status: "pending",
    }]);
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "1",
      state: retained,
    }).handledThroughSeq).toBe("0");

    // Compose the actual catch result with the real phase and existing parser.
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce(preparation);
    const result = await runHostedWorkspaceAssistantPhase(phaseInput);
    expect(await result.afterCheckpoint?.()).toBeUndefined();
    expect(result.nextWakeAt).toBe(RETRY_AT);
    expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual(retained);
    expect(executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
    expect(recordMemberActionOutcome).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();

    const entries = logRequests.flatMap((request) =>
      parseHostedRuntimeLogRequest(request).entries
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      component: "mailbox",
      errorCode: expectedError.code,
      eventCode: "mailbox.system_processed",
      level: "warn",
      phase: "checkpoint",
    });
    expect(entries[0]?.redactedJson).toEqual({
      attemptCount: 1,
      assistantAskCompletionFirstAttemptDelayed: false,
      errorCode: expectedError.code,
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAtPresent: true,
      recordFailed: null,
      recorded: null,
      routeAction: "apply-member-action",
      safeErrorMessage: expectedError.message,
      status: "retryable_failed",
      wakeKind: "member.action.requested",
      ...expectedDiagnostics,
    });
    expect(JSON.stringify(logRequests)).not.toContain(PRIVATE);
    expect(JSON.stringify(preparation)).not.toContain(PRIVATE);
    expect(JSON.stringify(retained)).not.toContain(PRIVATE);
    expect(retained.pending[0]).not.toHaveProperty("codexConnectionFailure");
  } finally {
    await workspace.cleanup();
  }
}

describe("system mailbox Codex failure warnings", () => {
  it.each([
    ["httpConnectionFailed", 503],
    ["responseStreamConnectionFailed", 502],
    ["responseStreamDisconnected", undefined],
    ["responseTooManyFailedAttempts", 429],
  ] as const)("preserves %s through preparation and the parsed warning", async (kind, status) => {
    await expectFailureWarning(failure({
      codexErrorInfo: kind,
      codexErrorHttpStatusCode: status,
      codexFailureDetail: PRIVATE,
      url: `https://example.test/${PRIVATE}`,
      identifier: PRIVATE,
      payload: { private: PRIVATE },
    }), {
      codexErrorInfo: kind,
      ...(status === undefined ? {} : { codexErrorHttpStatusCode: status }),
    });
  });

  it.each([
    ["missing context", undefined],
    ["null context", null],
    ["raw context", PRIVATE],
    ["empty context", {}],
    ["private subtype", { codexErrorInfo: PRIVATE }],
    ["other Codex subtype", { codexErrorInfo: "usageLimitExceeded" }],
  ])("uses unknown for %s", async (_name, context) => {
    await expectFailureWarning(failure(context), { codexErrorInfo: "unknown" });
  });

  it.each([
    ["lower bound", 100, 100],
    ["request timeout", 408, 408],
    ["rate limit", 429, 429],
    ["server error", 503, 503],
    ["upper bound", 599, 599],
    ["below range", 99, null],
    ["above range", 600, null],
    ["fraction", 503.5, null],
    ["NaN", Number.NaN, null],
    ["positive infinity", Number.POSITIVE_INFINITY, null],
    ["negative infinity", Number.NEGATIVE_INFINITY, null],
    ["numeric string", "503", null],
    ["boolean", true, null],
    ["null", null, null],
    ["missing", undefined, null],
  ] as const)("bounds HTTP status: %s", async (_name, status, expected) => {
    await expectFailureWarning(failure({
      codexErrorInfo: "httpConnectionFailed",
      codexErrorHttpStatusCode: status,
    }), {
      codexErrorInfo: "httpConnectionFailed",
      ...(expected === null ? {} : { codexErrorHttpStatusCode: expected }),
    });
  });

  const hostileCases: Array<{
    name: string;
    makeError: (accessed: () => never) => VaultCliError;
    expected: Readonly<Record<string, string | number>>;
  }> = [
    {
      name: "context accessor",
      makeError: (accessed) => Object.defineProperty(failure(), "context", { get: accessed }),
      expected: { codexErrorInfo: "unknown" },
    },
    {
      name: "subtype accessor",
      makeError: (accessed) => failure(Object.defineProperty({
        codexErrorHttpStatusCode: 503,
      }, "codexErrorInfo", { get: accessed })),
      expected: { codexErrorInfo: "unknown", codexErrorHttpStatusCode: 503 },
    },
    {
      name: "HTTP accessor",
      makeError: (accessed) => failure(Object.defineProperty({
        codexErrorInfo: "responseStreamDisconnected",
      }, "codexErrorHttpStatusCode", { get: accessed })),
      expected: { codexErrorInfo: "responseStreamDisconnected" },
    },
    {
      name: "inherited context fields",
      makeError: (accessed) => {
        const context = {};
        Object.setPrototypeOf(context, {
          codexErrorInfo: "httpConnectionFailed",
          codexErrorHttpStatusCode: 503,
          get private() { return accessed(); },
        });
        return failure(context);
      },
      expected: { codexErrorInfo: "unknown" },
    },
    {
      name: "inherited error context",
      makeError: () => {
        const error = failure();
        Reflect.deleteProperty(error, "context");
        const prototype = { context: { codexErrorInfo: "httpConnectionFailed" } };
        Object.setPrototypeOf(prototype, VaultCliError.prototype);
        Object.setPrototypeOf(error, prototype);
        return error;
      },
      expected: { codexErrorInfo: "unknown" },
    },
    {
      name: "inherited error code",
      makeError: () => {
        const error = failure({ codexErrorInfo: "httpConnectionFailed" });
        Reflect.deleteProperty(error, "code");
        const prototype = { code: CONNECTION_LOST };
        Object.setPrototypeOf(prototype, VaultCliError.prototype);
        Object.setPrototypeOf(error, prototype);
        return error;
      },
      expected: {},
    },
    {
      name: "coercible private fields",
      makeError: (accessed) => {
        const value = { toString: accessed, valueOf: accessed, [Symbol.toPrimitive]: accessed };
        return failure({ codexErrorInfo: value, codexErrorHttpStatusCode: value });
      },
      expected: { codexErrorInfo: "unknown" },
    },
    {
      name: "unrelated getters and property traversal",
      makeError: (accessed) => {
        const context = Object.defineProperty({
          codexErrorInfo: "httpConnectionFailed",
          codexErrorHttpStatusCode: 503,
        }, "private", { get: accessed, enumerable: true });
        const error = failure(new Proxy(context, {
          get: accessed,
          getPrototypeOf: accessed,
          ownKeys: accessed,
        }));
        Object.defineProperty(error, "stack", { value: PRIVATE });
        return error;
      },
      expected: { codexErrorInfo: "httpConnectionFailed", codexErrorHttpStatusCode: 503 },
    },
    {
      name: "context reflection failure",
      makeError: () => failure(new Proxy({}, {
        getOwnPropertyDescriptor() { throw new Error(PRIVATE); },
      })),
      expected: { codexErrorInfo: "unknown" },
    },
    {
      name: "subtype reflection failure",
      makeError: () => failure(new Proxy({ codexErrorHttpStatusCode: 503 }, {
        getOwnPropertyDescriptor(target, key) {
          if (key === "codexErrorInfo") throw new Error(PRIVATE);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      })),
      expected: { codexErrorInfo: "unknown", codexErrorHttpStatusCode: 503 },
    },
    {
      name: "error code reflection failure",
      makeError: () => new Proxy(failure(), {
        getOwnPropertyDescriptor(target, key) {
          if (key === "code") throw new Error(PRIVATE);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }),
      expected: {},
    },
    {
      name: "error context reflection failure",
      makeError: () => new Proxy(failure(), {
        getOwnPropertyDescriptor(target, key) {
          if (key === "context") throw new Error(PRIVATE);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }),
      expected: { codexErrorInfo: "unknown" },
    },
  ];

  it.each(hostileCases)("safely handles $name", async ({ makeError, expected }) => {
    const accessed = vi.fn((): never => { throw new Error(PRIVATE); });
    await expectFailureWarning(makeError(accessed), expected);
    expect(accessed).not.toHaveBeenCalled();
  });

  it.each(["ASSISTANT_CODEX_FAILED", "ASSISTANT_CODEX_USAGE_LIMIT"])(
    "preserves the existing non-connection warning shape for %s",
    async (code) => {
      const accessed = vi.fn((): never => { throw new Error(PRIVATE); });
      await expectFailureWarning(failure(new Proxy({
        codexErrorInfo: "httpConnectionFailed",
        codexErrorHttpStatusCode: 503,
      }, { getOwnPropertyDescriptor: accessed }), code), {}, { code, message: SAFE_MESSAGE });
      expect(accessed).not.toHaveBeenCalled();
    },
  );

  it("keeps a plain thrown object under the existing ambiguous classification", async () => {
    await expectFailureWarning({
      code: CONNECTION_LOST,
      context: { codexErrorInfo: "httpConnectionFailed", codexErrorHttpStatusCode: 503 },
    }, {}, {
      code: "HOSTED_SYSTEM_MAILBOX_AMBIGUOUS",
      message: "Hosted system mailbox effect failed.",
    });
  });

  it("preserves the existing success summary without diagnostic fields", async () => {
    const workspace = await createHostedRuntimeWorkspace("mailbox-codex-success-");
    const logRequests: HostedRuntimeLogRequest[] = [];
    const systemMailbox = await loadHostedSystemMailboxRealImplementation();
    const phaseInput = createPhaseInput({
      logRequests,
      now: () => NOW,
      operatorHomeRoot: workspace.operatorHomeRoot,
      vaultRoot: workspace.vaultRoot,
    });
    const item = createMemberActionSystemMailboxItem();
    vi.mocked(executeHostedMailboxEvent).mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "member-action",
      nextWakeAt: null,
      postCheckpointRecord: item.postCheckpointRecord,
      redactedLogEntries: [],
    });

    try {
      await initializeVault({ createdAt: NOW, vaultRoot: workspace.vaultRoot });
      await systemMailbox.restoreHostedSystemMailboxCheckpointRollbackState({
        state: { pending: [{ ...item, attemptCount: 0, postCheckpointRecord: null }] },
        vaultRoot: workspace.vaultRoot,
      });
      const preparation = await systemMailbox.prepareHostedSystemMailboxItemForCheckpoint({
        now: () => NOW,
        runtime: phaseInput.runtime,
        runtimeEnv: phaseInput.runtimeEnv,
        vaultRoot: workspace.vaultRoot,
      });
      expect(preparation?.status).toBe("processed");
      expect(preparation).not.toHaveProperty("codexConnectionFailure");
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce(preparation);
      await runHostedWorkspaceAssistantPhase(phaseInput);
      const entries = logRequests.flatMap((request) =>
        parseHostedRuntimeLogRequest(request).entries
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        component: "mailbox",
        eventCode: "mailbox.system_processed",
        level: "info",
        phase: "checkpoint",
      });
      expect(entries[0]).not.toHaveProperty("errorCode");
      expect(entries[0]?.redactedJson).toEqual({
        attemptCount: 1,
        assistantAskCompletionFirstAttemptDelayed: false,
        errorCode: null,
        legacyUsageReferralAuthorityClassification: null,
        nextWakeAtPresent: false,
        recordFailed: null,
        recorded: null,
        routeAction: "apply-member-action",
        status: "processed",
        wakeKind: "member.action.requested",
      });
      expect(executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
      expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    } finally {
      await workspace.cleanup();
    }
  });
});
