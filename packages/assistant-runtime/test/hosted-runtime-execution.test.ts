import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
  collectHostedExecutionSideEffects: vi.fn(),
  createHostedArtifactUploadSink: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  drainHostedCommittedSideEffectsAfterCommit: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  encodeHostedBundleBase64: vi.fn(),
  executeHostedDispatchEvent: vi.fn(),
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  exportHostedPendingAssistantUsage: vi.fn(),
  listHostedBundleArtifacts: vi.fn(),
  reconcileHostedVerifiedEmailSelfTarget: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
  runHostedMaintenanceLoop: vi.fn(),
  snapshotHostedExecutionContext: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  return {
    ...actual,
    decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
    encodeHostedBundleBase64: mocks.encodeHostedBundleBase64,
    listHostedBundleArtifacts: mocks.listHostedBundleArtifacts,
    snapshotHostedExecutionContext: mocks.snapshotHostedExecutionContext,
  };
});

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
  assistantGatewayLocalProjectionSourceReader:
    mocks.assistantGatewayLocalProjectionSourceReader,
}));

vi.mock("@murphai/gateway-local", () => ({
  exportGatewayProjectionSnapshotLocal: mocks.exportGatewayProjectionSnapshotLocal,
}));

vi.mock("../src/hosted-email-route.ts", () => ({
  reconcileHostedVerifiedEmailSelfTarget:
    mocks.reconcileHostedVerifiedEmailSelfTarget,
}));

vi.mock("../src/hosted-runtime/artifacts.ts", () => ({
  createHostedArtifactUploadSink: mocks.createHostedArtifactUploadSink,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedExecutionSideEffects: mocks.collectHostedExecutionSideEffects,
  drainHostedCommittedSideEffectsAfterCommit:
    mocks.drainHostedCommittedSideEffectsAfterCommit,
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
  completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit,
} from "../src/hosted-runtime/execution.ts";
import { createHostedRuntimeResolvedConfig } from "./hosted-runtime-test-helpers.ts";

const incomingBundle = Uint8Array.from([1, 2, 3]);
const committedBundle = Uint8Array.from([4, 5, 6]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decodeHostedBundleBase64.mockImplementation((bundle: string | null) => {
    if (bundle === "incoming-bundle") {
      return incomingBundle;
    }
    if (bundle === "committed-bundle") {
      return committedBundle;
    }
    return null;
  });
  mocks.encodeHostedBundleBase64.mockImplementation((bytes: Uint8Array) =>
    Buffer.from(bytes).toString("base64"),
  );
  mocks.createHostedArtifactUploadSink.mockReturnValue(Symbol("artifact-sink"));
  mocks.snapshotHostedExecutionContext.mockResolvedValue({
    bundle: Uint8Array.from([9, 9, 9]),
  });
  mocks.collectHostedExecutionSideEffects.mockResolvedValue([
    {
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
    },
  ]);
  mocks.exportGatewayProjectionSnapshotLocal.mockResolvedValue({
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:10:00.000Z",
    conversations: [],
    messages: [],
    permissions: [],
  });
  mocks.executeHostedDispatchEvent.mockResolvedValue({
    bootstrapResult: {
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
      assistantSeeded: false,
      emailAutoReplyEnabled: false,
      telegramAutoReplyEnabled: false,
      vaultCreated: true,
    },
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.runHostedMaintenanceLoop.mockResolvedValue({
    deviceSyncProcessed: 2,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:30:00.000Z",
    parserProcessed: 3,
  });
  mocks.drainHostedCommittedSideEffectsAfterCommit.mockResolvedValue(undefined);
  mocks.exportHostedPendingAssistantUsage.mockResolvedValue({
    exported: 1,
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

describe("executeHostedDispatchForCommit", () => {
  it("runs the dispatch and maintenance loops, snapshots the workspace, and summarizes the commit", async () => {
    mocks.listHostedBundleArtifacts.mockReturnValue([
      {
        path: "vault/raw/already-materialized.bin",
        ref: {
          sha256: "sha_existing",
        },
      },
    ]);

    const result = await executeHostedDispatchForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      materializedArtifactPaths: new Set(["vault/raw/already-materialized.bin"]),
      request: {
        bundle: "incoming-bundle",
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
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
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {
          HOSTED_USER_VERIFIED_EMAIL: "member@example.com",
        },
      },
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
    });

    expect(mocks.executeHostedDispatchEvent).toHaveBeenCalledWith({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      runtime: expect.objectContaining({
        commitTimeoutMs: 45_000,
      }),
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
      sharePack: null,
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.runHostedMaintenanceLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        skipAssistantAutomation: true,
        timeoutMs: 45_000,
      }),
    );
    expect(mocks.createHostedArtifactUploadSink).toHaveBeenCalledWith({
      artifactStore: expect.any(Object),
      knownArtifactHashes: new Set(["sha_existing"]),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [],
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.collectHostedExecutionSideEffects).toHaveBeenCalledWith("/tmp/vault-root");
    assert.deepEqual(result.committedSideEffects, [
      {
        effectId: "intent_123",
        fingerprint: "dedupe_123",
        kind: "assistant.delivery",
      },
    ]);
    assert.equal(result.committedResult.result.eventsHandled, 1);
    assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
    assert.match(result.committedResult.result.summary, /Processed member activation/u);
  });
});

describe("completeHostedExecutionAfterCommit", () => {
  it("drains committed side effects, exports usage, reconciles email state, and preserves only untouched artifacts", async () => {
    mocks.listHostedBundleArtifacts.mockReturnValue([
      {
        path: "vault/raw/already-materialized.bin",
        ref: {
          sha256: "sha_materialized",
        },
      },
      {
        path: "vault/raw/preserved.bin",
        ref: {
          sha256: "sha_preserved",
        },
      },
    ]);

    const result = await completeHostedExecutionAfterCommit({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
      },
      committedExecution: {
        committedGatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-08T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
        committedResult: {
          bundle: "committed-bundle",
          result: {
            eventsHandled: 1,
            nextWakeAt: "2026-04-08T00:30:00.000Z",
            summary: "completed summary",
          },
        },
        committedAssistantDeliveryEffects: [
          {
            effectId: "intent_123",
            fingerprint: "dedupe_123",
            kind: "assistant.delivery",
          },
        ],
        committedSideEffects: [
          {
            effectId: "intent_123",
            fingerprint: "dedupe_123",
            kind: "assistant.delivery",
          },
        ],
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
      materializedArtifactPaths: new Set(["vault/raw/already-materialized.bin"]),
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      run: {
        attempt: 1,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:00.000Z",
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
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record) {
              return record;
            },
          },
          usageExportPort: {
            async recordUsage() {
              return { recorded: 1, usageIds: ["usage_123"] };
            },
          },
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {
          HOSTED_USER_VERIFIED_EMAIL: "member@example.com",
        },
      },
    });

    expect(mocks.drainHostedCommittedSideEffectsAfterCommit).toHaveBeenCalledWith({
      commit: {
        bundleRef: {
          hash: "hash_123",
          key: "bundles/member/vault.json",
          size: 42,
          updatedAt: "2026-04-08T00:00:00.000Z",
        },
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
      effectsPort: expect.any(Object),
      sideEffects: [
        {
          effectId: "intent_123",
          fingerprint: "dedupe_123",
          kind: "assistant.delivery",
        },
      ],
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.exportHostedPendingAssistantUsage).toHaveBeenCalledWith({
      usageExportPort: expect.any(Object),
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
      knownArtifactHashes: new Set(["sha_materialized", "sha_preserved"]),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [
        {
          path: "vault/raw/preserved.bin",
          ref: {
            sha256: "sha_preserved",
          },
        },
      ],
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
          nextWakeAt: "2026-04-08T00:30:00.000Z",
          summary: "completed summary",
        },
      },
    });
  });
});
