import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectHostedExecutionSideEffects: vi.fn(),
  commitHostedExecutionResult: vi.fn(),
  createHostedArtifactResolver: vi.fn(),
  createHostedArtifactUploadSink: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  drainHostedCommittedSideEffectsAfterCommit: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  encodeHostedBundleBase64: vi.fn(),
  executeHostedDispatchEvent: vi.fn(),
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  exportHostedPendingAssistantUsage: vi.fn(),
  listHostedBundleArtifacts: vi.fn(),
  materializeHostedExecutionArtifacts: vi.fn(),
  normalizeHostedAssistantRuntimeConfig: vi.fn(),
  reconcileHostedVerifiedEmailSelfTarget: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
  restoreHostedExecutionContext: vi.fn(),
  resumeHostedCommittedExecution: vi.fn(),
  runHostedMaintenanceLoop: vi.fn(),
  snapshotHostedExecutionContext: vi.fn(),
  withHostedProcessEnvironment: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", () => ({
  decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
  encodeHostedBundleBase64: mocks.encodeHostedBundleBase64,
  listHostedBundleArtifacts: mocks.listHostedBundleArtifacts,
  materializeHostedExecutionArtifacts: mocks.materializeHostedExecutionArtifacts,
  restoreHostedExecutionContext: mocks.restoreHostedExecutionContext,
  snapshotHostedExecutionContext: mocks.snapshotHostedExecutionContext,
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

vi.mock("@murphai/assistant-engine", () => ({
  refreshAssistantStatusSnapshot: mocks.refreshAssistantStatusSnapshot,
}));

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
}));

vi.mock("@murphai/gateway-local", () => ({
  exportGatewayProjectionSnapshotLocal: mocks.exportGatewayProjectionSnapshotLocal,
}));

vi.mock("../src/hosted-email-route.ts", () => ({
  reconcileHostedVerifiedEmailSelfTarget:
    mocks.reconcileHostedVerifiedEmailSelfTarget,
}));

vi.mock("../src/hosted-runtime/artifacts.ts", () => ({
  createHostedArtifactResolver: mocks.createHostedArtifactResolver,
  createHostedArtifactUploadSink: mocks.createHostedArtifactUploadSink,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedExecutionSideEffects: mocks.collectHostedExecutionSideEffects,
  commitHostedExecutionResult: mocks.commitHostedExecutionResult,
  drainHostedCommittedSideEffectsAfterCommit:
    mocks.drainHostedCommittedSideEffectsAfterCommit,
  resumeHostedCommittedExecution: mocks.resumeHostedCommittedExecution,
}));

vi.mock("../src/hosted-runtime/environment.ts", () => ({
  normalizeHostedAssistantRuntimeConfig:
    mocks.normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment: mocks.withHostedProcessEnvironment,
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedDispatchEvent: mocks.executeHostedDispatchEvent,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedMaintenanceLoop: mocks.runHostedMaintenanceLoop,
}));

vi.mock("../src/hosted-runtime/usage.ts", () => ({
  exportHostedPendingAssistantUsage: mocks.exportHostedPendingAssistantUsage,
}));

import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";

import {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "../src/hosted-runtime.ts";
import {
  createHostedRuntimeChildError,
} from "../src/hosted-runtime/child-result.ts";
import {
  completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit,
} from "../src/hosted-runtime/execution.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decodeHostedBundleBase64.mockImplementation((bundle: string | null) => {
    if (bundle === "bundle-that-breaks-listing") {
      return Uint8Array.from([7, 7, 7]);
    }
    return null;
  });
  mocks.encodeHostedBundleBase64.mockImplementation((bytes: Uint8Array) =>
    Buffer.from(bytes).toString("base64"),
  );
  mocks.createHostedArtifactUploadSink.mockReturnValue(Symbol("artifact-sink"));
  mocks.executeHostedDispatchEvent.mockResolvedValue({
    bootstrapResult: null,
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.runHostedMaintenanceLoop.mockResolvedValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:30:00.000Z",
    parserProcessed: 0,
  });
  mocks.snapshotHostedExecutionContext.mockResolvedValue({
    bundle: Uint8Array.from([9, 9, 9]),
  });
  mocks.collectHostedExecutionSideEffects.mockResolvedValue([]);
  mocks.exportGatewayProjectionSnapshotLocal.mockResolvedValue({
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:10:00.000Z",
    conversations: [],
    messages: [],
    permissions: [],
  });
  mocks.drainHostedCommittedSideEffectsAfterCommit.mockResolvedValue(undefined);
  mocks.exportHostedPendingAssistantUsage.mockResolvedValue({
    exported: 0,
    failed: 0,
    pending: 0,
  });
  mocks.reconcileHostedVerifiedEmailSelfTarget.mockResolvedValue({
    emailAddress: "member@example.com",
    identityId: "assistant@example.com",
    selfTargetUpdated: true,
    status: "saved",
  });
  mocks.refreshAssistantStatusSnapshot.mockResolvedValue(undefined);
});

describe("hosted runtime child helpers", () => {
  it("classifies required hosted assistant configuration errors", () => {
    const error = createHostedRuntimeChildError(
      {
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        message: "Hosted assistant config is required.",
        name: "HostedAssistantConfigurationError",
        stack: "child-stack",
      },
      17,
    );

    assert.ok(error instanceof HostedAssistantConfigurationError);
    assert.equal(error.name, "HostedAssistantConfigurationError");
    assert.equal(error.message, "Hosted assistant config is required.");
    assert.equal(error.stack, "child-stack");
    assert.equal(error.code, "HOSTED_ASSISTANT_CONFIG_REQUIRED");
  });

  it("defaults unknown hosted assistant configuration errors to invalid", () => {
    const error = createHostedRuntimeChildError(
      {
        code: "UNKNOWN_CODE",
        message: "Hosted assistant config is invalid.",
        name: "HostedAssistantConfigurationError",
      },
      3,
    );

    assert.ok(error instanceof HostedAssistantConfigurationError);
    assert.equal(error.code, "HOSTED_ASSISTANT_CONFIG_INVALID");
  });

  it("preserves generic child error metadata and fallback exit messages", () => {
    const namedError = createHostedRuntimeChildError(
      {
        message: "child aborted",
        name: "AbortError",
        stack: "abort-stack",
      },
      9,
    );

    assert.equal(namedError.name, "AbortError");
    assert.equal(namedError.message, "child aborted");
    assert.equal(namedError.stack, "abort-stack");

    const fallbackError = createHostedRuntimeChildError(undefined, null);
    assert.equal(
      fallbackError.message,
      "Hosted assistant runtime child exited with code unknown.",
    );
  });

  it("parses the final emitted payload line after trimming stdout noise", () => {
    const payload = {
      ok: true,
      result: {
        finalGatewayProjectionSnapshot: null,
        result: {
          bundle: "encoded-bundle",
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed summary",
          },
        },
      },
    };

    const output = [
      "child stdout",
      "",
      `  ${formatHostedRuntimeChildResult({ ok: false, error: { message: "stale" } })}`,
      ` ${formatHostedRuntimeChildResult(payload)} `,
      "",
    ].join("\n");

    assert.deepEqual(parseHostedRuntimeChildResult(output), payload);
  });

  it("fails closed when the child never emits a payload line", () => {
    assert.throws(
      () => parseHostedRuntimeChildResult("child stdout only"),
      /did not emit a result payload/u,
    );
  });
});

describe("executeHostedDispatchForCommit", () => {
  it("falls back to empty artifact metadata when the incoming bundle is absent", async () => {
    const result = await executeHostedDispatchForCommit({
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: null,
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
      },
      restored: {
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async commit() {},
            async deletePreparedSideEffect() {},
            async readRawEmailMessage() {
              return null;
            },
            async readSideEffect() {
              return null;
            },
            async sendEmail() {},
            async writeSideEffect(record) {
              return record;
            },
          },
          usageExportPort: null,
        },
        userEnv: {},
      },
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
    });

    expect(mocks.runHostedMaintenanceLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        skipAssistantAutomation: false,
      }),
    );
    expect(mocks.createHostedArtifactUploadSink).toHaveBeenCalledWith({
      artifactStore: expect.any(Object),
      knownArtifactHashes: new Set(),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [],
      vaultRoot: "/tmp/vault-root",
    });
    assert.equal(result.committedResult.result.eventsHandled, 1);
    assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
  });
});

describe("completeHostedExecutionAfterCommit", () => {
  it("continues finalization when committed bundle artifact listing fails", async () => {
    mocks.listHostedBundleArtifacts.mockImplementation(() => {
      throw new Error("invalid bundle");
    });

    const result = await completeHostedExecutionAfterCommit({
      commit: null,
      committedExecution: {
        committedGatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-08T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
        committedResult: {
          bundle: "bundle-that-breaks-listing",
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed summary",
          },
        },
        committedSideEffects: [],
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      restored: {
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async commit() {},
            async deletePreparedSideEffect() {},
            async readRawEmailMessage() {
              return null;
            },
            async readSideEffect() {
              return null;
            },
            async sendEmail() {},
            async writeSideEffect(record) {
              return record;
            },
          },
          usageExportPort: null,
        },
        userEnv: {
          HOSTED_USER_VERIFIED_EMAIL: "member@example.com",
        },
      },
    });

    expect(mocks.drainHostedCommittedSideEffectsAfterCommit).toHaveBeenCalledWith({
      commit: null,
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: expect.any(Object),
      sideEffects: [],
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.exportHostedPendingAssistantUsage).toHaveBeenCalledWith({
      usageExportPort: null,
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.reconcileHostedVerifiedEmailSelfTarget).toHaveBeenCalledWith({
      operatorHomeRoot: "/tmp/operator-home",
      source: {
        HOSTED_USER_VERIFIED_EMAIL: "member@example.com",
      },
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.refreshAssistantStatusSnapshot).toHaveBeenCalledWith("/tmp/vault-root");
    expect(mocks.createHostedArtifactUploadSink).toHaveBeenCalledWith({
      artifactStore: expect.any(Object),
      knownArtifactHashes: new Set(),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [],
      vaultRoot: "/tmp/vault-root",
    });
    assert.deepEqual(result, {
      finalGatewayProjectionSnapshot: {
        schema: "murph.gateway-projection-snapshot.v1",
        generatedAt: "2026-04-08T00:10:00.000Z",
        conversations: [],
        messages: [],
        permissions: [],
      },
      result: {
        bundle: Buffer.from(Uint8Array.from([9, 9, 9])).toString("base64"),
        result: {
          eventsHandled: 1,
          nextWakeAt: null,
          summary: "completed summary",
        },
      },
    });
  });
});
