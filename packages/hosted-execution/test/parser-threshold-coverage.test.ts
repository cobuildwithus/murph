import { describe, expect, it } from "vitest";

import { HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA } from "../src/contracts.ts";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionCursorState,
  parseHostedRunAcquireRequest,
  parseHostedRunAcquireResponse,
  parseHostedRunCommitRequest,
  parseHostedRunCommitResponse,
  parseHostedRunFinalizeRequest,
  parseHostedRunFinalizeResponse,
  parseHostedRunLogRequest,
  parseHostedRunLogResponse,
  parseHostedRunRecord,
  parseHostedRunReleaseFinalizeRequest,
  parseHostedRunReleaseFinalizeResponse,
  parseHostedRunStatusRequest,
  parseHostedRunStatusResponse,
} from "../src/parsers.ts";

const TEST_SNAPSHOT_REF = {
  hash: "hash-1",
  key: "bundles/vault/hash-1.bundle.json",
  size: 128,
  updatedAt: "2026-04-17T00:00:01.000Z",
} as const;

const TEST_BROWSER_VAULT_REPLICA_REF = {
  byteLength: 256,
  dataVersion: "2026-04-17",
  generatedAt: "2026-04-17T00:00:02.000Z",
  keyId: "key-1",
  objectKey: "browser-vault/member-1/replica.json",
  replicaSchema: "murph.browser-vault-replica.v1",
  schema: HOSTED_BROWSER_VAULT_REPLICA_REF_SCHEMA,
  sourceBundleHash: "bundle-hash-1",
} as const;

const TEST_CURSOR_WITH_SNAPSHOT_REF = {
  committedSeq: "24",
  createdAt: "2026-04-17T00:00:00.000Z",
  nextSeq: "25",
  snapshotRef: TEST_SNAPSHOT_REF,
  updatedAt: "2026-04-17T00:00:01.000Z",
  userId: "member-1",
  version: "4",
} as const;

const TEST_CURSOR_WITHOUT_SNAPSHOT_REF = {
  committedSeq: "24",
  createdAt: "2026-04-17T00:00:00.000Z",
  nextSeq: "25",
  updatedAt: "2026-04-17T00:00:01.000Z",
  userId: "member-1",
  version: "4",
} as const;

const TEST_RUN_RECORD = {
  acquiredAt: "2026-04-17T00:00:00.000Z",
  attestationRef: null,
  attempt: 1,
  createdAt: "2026-04-17T00:00:00.000Z",
  eventCount: 0,
  eventKinds: [],
  eventSeqs: [],
  executorCodeDigest: null,
  executorKind: "cloudflare-container",
  id: "run-legacy",
  inputCommittedSeq: "24",
  inputCursorVersion: "4",
  signedResultRef: null,
  status: "committed_needs_finalize",
  triggerKind: "runtime_timer",
  updatedAt: "2026-04-17T00:00:01.000Z",
  userId: "member-1",
  ingressEventIds: ["ingress-legacy"],
} as const;

describe("parser threshold coverage", () => {
  it("parses browser vault replica refs directly and on cursor state", () => {
    expect(parseHostedBrowserVaultReplicaRef(null)).toBeNull();

    expect(parseHostedBrowserVaultReplicaRef(TEST_BROWSER_VAULT_REPLICA_REF)).toEqual(
      TEST_BROWSER_VAULT_REPLICA_REF,
    );

    expect(parseHostedExecutionCursorState({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      committedSeq: "12",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextSeq: "13",
      snapshotRef: TEST_SNAPSHOT_REF,
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "4",
    })).toEqual({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      committedSeq: "12",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextSeq: "13",
      snapshotRef: TEST_SNAPSHOT_REF,
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "4",
    });

    expect(parseHostedExecutionCursorState(TEST_CURSOR_WITHOUT_SNAPSHOT_REF)).toEqual({
      ...TEST_CURSOR_WITHOUT_SNAPSHOT_REF,
      snapshotRef: null,
    });
  });

  it("rejects invalid browser vault replica ref schemas", () => {
    expect(() => parseHostedBrowserVaultReplicaRef({
      ...TEST_BROWSER_VAULT_REPLICA_REF,
      schema: "murph.browser-vault-replica-ref.v0",
    })).toThrow(/schema must be murph\.hosted-browser-vault-replica-ref\.v1/i);

    expect(() => parseHostedBrowserVaultReplicaRef({
      ...TEST_BROWSER_VAULT_REPLICA_REF,
      replicaSchema: "murph.browser-vault-replica.v0",
    })).toThrow(/replicaSchema must be murph\.browser-vault-replica\.v1/i);
  });

  it("covers canonical run-control shapes and optional fields", () => {
    expect(parseHostedRunAcquireRequest({})).toEqual({});

    expect(parseHostedRunAcquireResponse({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 2,
      resumeFinalize: false,
      run: null,
    })).toEqual({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 2,
      resumeFinalize: false,
      run: null,
    });

    expect(parseHostedRunAcquireResponse({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: TEST_RUN_RECORD,
    })).toEqual({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: {
        acquiredAt: "2026-04-17T00:00:00.000Z",
        attestationRef: null,
        attempt: 1,
        createdAt: "2026-04-17T00:00:00.000Z",
        eventCount: 0,
        eventKinds: [],
        eventSeqs: [],
        executorCodeDigest: null,
        executorKind: "cloudflare-container",
        id: "run-legacy",
        ingressEventIds: ["ingress-legacy"],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        signedResultRef: null,
        status: "committed_needs_finalize",
        triggerKind: "runtime_timer",
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
      },
    });

    expect(parseHostedRunAcquireResponse({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: {
        ...TEST_RUN_RECORD,
        redactedSummary: null,
      },
    })).toEqual({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 0,
      resumeFinalize: false,
      run: {
        acquiredAt: "2026-04-17T00:00:00.000Z",
        attestationRef: null,
        attempt: 1,
        createdAt: "2026-04-17T00:00:00.000Z",
        eventCount: 0,
        eventKinds: [],
        eventSeqs: [],
        executorCodeDigest: null,
        executorKind: "cloudflare-container",
        id: "run-legacy",
        ingressEventIds: ["ingress-legacy"],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        redactedSummary: null,
        signedResultRef: null,
        status: "committed_needs_finalize",
        triggerKind: "runtime_timer",
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
      },
    });

    expect(parseHostedRunStatusResponse({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      pendingIngressEventCount: 1,
      run: null,
    })).toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      pendingIngressEventCount: 1,
      run: null,
    });

    expect(parseHostedRunCommitRequest({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      expectedCursorVersion: "4",
      finalizeRequired: false,
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      expectedCursorVersion: "4",
      finalizeRequired: false,
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunCommitRequest({
      eventResults: [
        {
          ingressEventId: "wake-1",
          state: "completed",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: false,
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      eventResults: [
        {
          ingressEventId: "wake-1",
          state: "completed",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: false,
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunCommitResponse({
      committed: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      needsFinalize: false,
      run: null,
    })).toEqual({
      committed: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      needsFinalize: false,
      run: null,
    });

    expect(parseHostedRunRecord(TEST_RUN_RECORD)).toEqual(TEST_RUN_RECORD);

    expect(parseHostedRunFinalizeRequest({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      finalSnapshotRef: TEST_SNAPSHOT_REF,
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      finalSnapshotRef: TEST_SNAPSHOT_REF,
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunFinalizeRequest({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      finalSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: null,
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
      finalSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: null,
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunFinalizeResponse({
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      finalized: true,
      run: null,
    })).toEqual({
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      finalized: true,
      run: null,
    });

    expect(parseHostedRunLogRequest({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunLogRequest({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      redacted: null,
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      at: "2026-04-17T00:00:00.000Z",
      component: "runtime",
      level: "info",
      message: "prepared snapshot",
      phase: "prepare",
      redacted: null,
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunLogResponse({
      logged: true,
      log: {
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "prepared snapshot",
        phase: "prepare",
        runId: "run-1",
        userId: "member-1",
      },
    })).toEqual({
      logged: true,
      log: {
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "prepared snapshot",
        phase: "prepare",
        runId: "run-1",
        userId: "member-1",
      },
    });

    expect(parseHostedRunLogResponse({
      logged: true,
      log: {
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "prepared snapshot",
        phase: "prepare",
        redacted: null,
        runId: "run-1",
        userId: "member-1",
      },
    })).toEqual({
      logged: true,
      log: {
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "prepared snapshot",
        phase: "prepare",
        redacted: null,
        runId: "run-1",
        userId: "member-1",
      },
    });

    expect(parseHostedRunReleaseFinalizeRequest({
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      runId: "run-1",
      runToken: "run_token_123",
    });

    expect(parseHostedRunReleaseFinalizeResponse({
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      released: true,
      run: null,
    })).toEqual({
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      released: true,
      run: null,
    });

    expect(parseHostedRunStatusRequest({})).toEqual({});
  });

  it("rejects removed legacy run-control keys", () => {
    expect(() => parseHostedRunAcquireResponse({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingWakeCount: 2,
      resumeFinalize: false,
      run: null,
    })).toThrow(/pendingIngressEventCount/u);
    expect(() => parseHostedRunAcquireResponse({
      acquired: true,
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      events: [],
      pendingIngressEventCount: 2,
      pendingWakeCount: 2,
      resumeFinalize: false,
      run: null,
    })).toThrow(/pendingWakeCount/u);

    const { ingressEventIds: _ingressEventIds, ...runWithoutIngressEventIds } = TEST_RUN_RECORD;

    expect(() => parseHostedRunRecord({
      ...runWithoutIngressEventIds,
      wakeIds: ["wake-legacy"],
    })).toThrow(/ingressEventIds/u);
    expect(() => parseHostedRunRecord({
      ...TEST_RUN_RECORD,
      wakeIds: ["wake-legacy"],
    })).toThrow(/wakeIds/u);

    expect(() => parseHostedRunStatusResponse({
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      pendingWakeCount: 1,
      run: null,
    })).toThrow(/pendingIngressEventCount/u);
    expect(() => parseHostedRunStatusResponse({
      cursor: TEST_CURSOR_WITH_SNAPSHOT_REF,
      pendingIngressEventCount: 1,
      pendingWakeCount: 1,
      run: null,
    })).toThrow(/pendingWakeCount/u);

    expect(() => parseHostedRunCommitRequest({
      eventResults: [
        {
          state: "completed",
          wakeId: "wake-1",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: false,
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    })).toThrow(/ingressEventId/u);
    expect(() => parseHostedRunCommitRequest({
      eventResults: [
        {
          ingressEventId: "ingress-1",
          state: "completed",
          wakeId: "wake-1",
        },
      ],
      expectedCursorVersion: "4",
      finalizeRequired: false,
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    })).toThrow(/wakeId/u);
  });
});
