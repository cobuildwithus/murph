import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";

import {
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type HostedRuntimeWorkspacePort,
} from "@murphai/assistant-runtime";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedRuntimeLogRequest,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  readHostedBundleTextFile,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
} from "@murphai/runtime-state/node";
import { afterEach, describe, expect, it } from "vitest";

import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/runtime-bridge-workspace.ts";

const TEST_NOW = "2026-05-04T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_checkpoint_baseline";
const BASELINE_ARTIFACT_COUNT = 100;
const BASELINE_ASSISTANT_MESSAGE_COUNT = 300;
const BASELINE_TRANSCRIPT_RELATIVE_PATH =
  ".runtime/operations/assistant/transcripts/session_checkpoint_baseline.jsonl";
const BASELINE_RUNTIME = {
  forwardedEnv: {
    HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
    HOSTED_ASSISTANT_PROVIDER: "openai",
    HOSTED_LOG_FINGERPRINT_SECRET: "synthetic-log-secret",
    OPENAI_API_KEY: "test-openai-key",
  },
};

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("hosted runtime checkpoint baseline", () => {
  it("measures hot mailbox checkpoint side effects for 100 artifacts and 300 assistant messages", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-checkpoint-baseline-"));
    cleanupPaths.push(vaultRoot, `${vaultRoot}-operator-home`);
    await writeSyntheticVaultMetadata(vaultRoot);
    await seedHostedCheckpointBaselineWorkspace({
      artifactCount: BASELINE_ARTIFACT_COUNT,
      assistantMessageCount: BASELINE_ASSISTANT_MESSAGE_COUNT,
      vaultRoot,
    });

    const artifactPutCalls: BaselineArtifactPutCall[] = [];
    const artifactPutBytesByHash = new Map<string, Uint8Array>();
    const baseBundle = await snapshotHostedBundleRoots({
      kind: "vault",
      roots: [
        {
          root: vaultRoot,
          rootKey: "vault",
        },
      ],
    });
    if (!baseBundle) {
      throw new Error("Synthetic checkpoint baseline base bundle could not be created.");
    }
    const baseBundleHash = sha256HostedBundleHex(baseBundle);
    artifactPutBytesByHash.set(baseBundleHash, baseBundle);
    const existingBaseSnapshotRef = createSnapshotBundleRef({
      hash: baseBundleHash,
      size: baseBundle.byteLength,
    });
    const existingBrowserVaultReplicaRef = createBrowserVaultReplicaRef(baseBundleHash);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeLogRequests: HostedRuntimeLogRequest[] = [];
    let bridgeLeaseReadCalls = 0;
    let checkpointElapsedMs = 0;
    let importedMailboxItems = 0;
    const request = createWorkspaceInvocationRequest();
    const platform = createBaselinePlatform({
      artifactPutCalls,
      artifactPutBytesByHash,
      mailboxPort: createBaselineMailboxPort({
        fetchRequests,
        items: [
          createMailboxItem({
            id: "mailbox_item_checkpoint_baseline_001",
            laneSeq: "1",
          }),
        ],
      }),
      runtimeLogRequests,
      workspacePort: createBaselineWorkspacePort({
        checkpointRequests,
        workspace: createWorkspaceState({
          browserVaultReplicaRef: existingBrowserVaultReplicaRef,
          snapshotRef: existingBaseSnapshotRef,
          version: request.workspaceVersion,
        }),
      }),
    });
    const bridgeOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      readCurrentLease: () => {
        bridgeLeaseReadCalls += 1;
        return {
          attemptId: request.attemptId,
          leaseGeneration: request.leaseGeneration,
          userId: request.userId,
          workspaceVersion: request.workspaceVersion,
        };
      },
      request,
      runtime: BASELINE_RUNTIME,
      vaultRoot,
    });

    const result = await runHostedWorkspaceRuntimeJobInProcess({
      request,
      runtime: BASELINE_RUNTIME,
    }, {
      ...bridgeOptions,
      async createCheckpointSnapshot(input) {
        const startedAt = performance.now();
        try {
          return await bridgeOptions.createCheckpointSnapshot(input);
        } finally {
          checkpointElapsedMs = performance.now() - startedAt;
        }
      },
      async importItem() {
        importedMailboxItems += 1;
        return { status: "imported" };
      },
      platform,
      vaultRoot,
    });

    const snapshotRef = checkpointRequests[0]?.snapshotRef ?? null;
    const restoredBaseSnapshotRef = readHostedExecutionSnapshotBaseRef(snapshotRef);
    const hotSnapshotRef = readHostedExecutionSnapshotHotRef(snapshotRef);
    const snapshotHash = hotSnapshotRef?.hash ?? null;
    const snapshotBundleBytes = snapshotHash ? artifactPutBytesByHash.get(snapshotHash) ?? null : null;
    const bundledTranscriptText = readHostedBundleTextFile({
      bytes: snapshotBundleBytes,
      expectedKind: "vault",
      path: BASELINE_TRANSCRIPT_RELATIVE_PATH,
      root: "vault",
    });
    const bundledTranscriptMessageCount = bundledTranscriptText
      ?.split("\n")
      .filter((line) => line.trim().length > 0)
      .length ?? 0;
    const bundlePutCalls = artifactPutCalls.filter((call) => call.sha256 === snapshotHash);
    const externalArtifactPutCalls = artifactPutCalls.filter((call) => call.sha256 !== snapshotHash);
    const metrics = {
      artifactPutBytes: artifactPutCalls.reduce((total, call) => total + call.byteLength, 0),
      artifactPutCalls: artifactPutCalls.length,
      assistantMessageCount: BASELINE_ASSISTANT_MESSAGE_COUNT,
      assistantMessagesInSnapshotBundle: bundledTranscriptMessageCount,
      bridgeLeaseReadCalls,
      bundlePutCalls: bundlePutCalls.length,
      checkpointDiagnosticLogWrites: countRuntimeLogEntries(
        runtimeLogRequests,
        "workspace.codex_home_snapshot",
      ),
      checkpointMetricLogWrites: countRuntimeLogEntries(
        runtimeLogRequests,
        "checkpoint.snapshot_finished",
      ),
      checkpointElapsedMs: roundBaselineMs(checkpointElapsedMs),
      externalArtifactPutCalls: externalArtifactPutCalls.length,
      importedMailboxItems,
      mailboxFetchCalls: fetchRequests.length,
      rawArtifactCount: BASELINE_ARTIFACT_COUNT,
      runtimeLogWrites: runtimeLogRequests.length,
      workspaceCheckpointCalls: checkpointRequests.length,
    };

    expect(result.status).toBe("idle");
    expect(metrics).toMatchObject({
      artifactPutCalls: 1,
      assistantMessageCount: BASELINE_ASSISTANT_MESSAGE_COUNT,
      assistantMessagesInSnapshotBundle: BASELINE_ASSISTANT_MESSAGE_COUNT,
      bridgeLeaseReadCalls: 2,
      bundlePutCalls: 1,
      checkpointDiagnosticLogWrites: 0,
      checkpointMetricLogWrites: 1,
      externalArtifactPutCalls: 0,
      importedMailboxItems: 1,
      mailboxFetchCalls: 1,
      rawArtifactCount: BASELINE_ARTIFACT_COUNT,
      workspaceCheckpointCalls: 1,
    });
    expect(metrics.runtimeLogWrites).toBeGreaterThanOrEqual(1);
    expect(metrics.artifactPutBytes).toBeGreaterThan(0);
    expect(Number.isFinite(metrics.checkpointElapsedMs)).toBe(true);
    expect(bundledTranscriptText).toContain("Synthetic checkpoint baseline assistant message 300");
    expect(checkpointRequests[0]?.reason).toBe("import");
    expect(restoredBaseSnapshotRef).toEqual(existingBaseSnapshotRef);
    expect(hotSnapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-hot-state\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(checkpointRequests[0]?.browserVaultReplicaRef).toEqual(existingBrowserVaultReplicaRef);

    if (process.env.HOSTED_CHECKPOINT_BASELINE_LOG === "1") {
      process.stdout.write(`hosted-checkpoint-baseline ${JSON.stringify(metrics)}\n`);
    }
  });
});

interface BaselineArtifactPutCall {
  byteLength: number;
  sha256: string;
}

async function seedHostedCheckpointBaselineWorkspace(input: {
  artifactCount: number;
  assistantMessageCount: number;
  vaultRoot: string;
}): Promise<void> {
  const rawArtifactRoot = path.join(input.vaultRoot, "raw", "inbox", "checkpoint-baseline");
  await mkdir(rawArtifactRoot, { recursive: true });
  await Promise.all(Array.from({ length: input.artifactCount }, async (_, index) => {
    await writeFile(
      path.join(rawArtifactRoot, `artifact-${String(index + 1).padStart(3, "0")}.pdf`),
      createSyntheticPdfBytes(index),
    );
  }));

  const transcriptsDirectory = resolveAssistantStatePaths(input.vaultRoot).transcriptsDirectory;
  await mkdir(transcriptsDirectory, { recursive: true });
  const transcriptText = Array.from({ length: input.assistantMessageCount }, (_, index) =>
    `${JSON.stringify({
      createdAt: TEST_NOW,
      kind: "assistant",
      schema: "murph.assistant-transcript-entry.v1",
      text: `Synthetic checkpoint baseline assistant message ${index + 1}`,
    })}\n`
  ).join("");
  await writeFile(
    path.join(transcriptsDirectory, "session_checkpoint_baseline.jsonl"),
    transcriptText,
    "utf8",
  );
}

async function writeSyntheticVaultMetadata(vaultRoot: string): Promise<void> {
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: TEST_NOW,
      formatVersion: 1,
      timezone: "UTC",
      title: "Synthetic Checkpoint Baseline",
      vaultId: "vault_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    }, null, 2)}\n`,
    "utf8",
  );
}

function createSyntheticPdfBytes(index: number): Uint8Array {
  const body = [
    "%PDF-1.7",
    `% synthetic checkpoint baseline artifact ${index + 1}`,
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
  return new TextEncoder().encode(body.padEnd(768, "x"));
}

function createBaselinePlatform(input: {
  artifactPutCalls: BaselineArtifactPutCall[];
  artifactPutBytesByHash: Map<string, Uint8Array>;
  mailboxPort: HostedRuntimeMailboxPort;
  runtimeLogRequests: HostedRuntimeLogRequest[];
  workspacePort: HostedRuntimeWorkspacePort;
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get(sha256) {
        return input.artifactPutBytesByHash.get(sha256) ?? null;
      },
      async put(putInput) {
        input.artifactPutCalls.push({
          byteLength: putInput.bytes.byteLength,
          sha256: putInput.sha256,
        });
        input.artifactPutBytesByHash.set(putInput.sha256, putInput.bytes.slice());
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    logPort: {
      async write(request) {
        input.runtimeLogRequests.push(request);
        return {
          loggedCount: request.entries.length,
        };
      },
    },
    mailboxPort: input.mailboxPort,
    workspacePort: input.workspacePort,
  };
}

function createBaselineMailboxPort(input: {
  fetchRequests: HostedMailboxFetchRequest[];
  items: HostedMailboxItem[];
}): HostedRuntimeMailboxPort {
  return {
    async fetch(request): Promise<HostedMailboxFetchResponse> {
      input.fetchRequests.push(request);
      return {
        fetchedAt: TEST_NOW,
        items: input.items.filter((item) =>
          request.lanes.some((lane) =>
            lane.lane === item.lane && BigInt(item.laneSeq) > BigInt(lane.importedSeq)
          )
        ),
        maxSeqByLane: request.lanes.map((lane) => ({
          lane: lane.lane,
          maxSeq: input.items
            .filter((item) => item.lane === lane.lane)
            .reduce((maxSeq, item) =>
              BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
            lane.importedSeq),
        })),
        userId: TEST_USER_ID,
      };
    },
    async fetchPayload() {
      throw new Error("Baseline mailbox items must use inline payloads.");
    },
  };
}

function createBaselineWorkspacePort(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  workspace: HostedWorkspaceState | null;
}): HostedRuntimeWorkspacePort {
  return {
    async read(): Promise<HostedWorkspaceReadResponse> {
      return {
        fetchedAt: TEST_NOW,
        workspace: input.workspace,
      };
    },
    async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
      input.checkpointRequests.push(request);
      return {
        checkpointed: true,
        workspace: createWorkspaceState({
          redactedStatus: request.redactedStatus ?? null,
          snapshotRef: request.snapshotRef,
          version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
        }),
      };
    },
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${overrides.id ?? "mailbox_item_checkpoint_baseline"}`,
    expiresAt: null,
    id: "mailbox_item_checkpoint_baseline",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_synthetic_checkpoint_baseline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createWorkspaceInvocationRequest(
  overrides: Partial<HostedWorkspaceInvocationRequest> = {},
): HostedWorkspaceInvocationRequest {
  return {
    attemptId: "attempt_synthetic_checkpoint_baseline",
    leaseGeneration: "1",
    reason: "nudge",
    userId: TEST_USER_ID,
    workspaceVersion: "0",
    ...overrides,
  };
}

function createWorkspaceState(overrides: Partial<HostedWorkspaceState> = {}): HostedWorkspaceState {
  return {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}

function createSnapshotBundleRef(input: {
  hash: string;
  size: number;
}): NonNullable<HostedWorkspaceState["snapshotRef"]> {
  return {
    hash: input.hash,
    key: `cloudflare-workspace-snapshots/${input.hash}.bundle`,
    size: input.size,
    updatedAt: TEST_NOW,
  };
}

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): NonNullable<HostedWorkspaceState["browserVaultReplicaRef"]> {
  return {
    byteLength: 256,
    dataVersion: "synthetic-checkpoint-baseline-browser-vault",
    generatedAt: TEST_NOW,
    keyId: "browser-key-synthetic-checkpoint-baseline",
    objectKey: "browser-vault/synthetic-checkpoint-baseline/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:synthetic-checkpoint-baseline",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function roundBaselineMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function countRuntimeLogEntries(
  requests: readonly HostedRuntimeLogRequest[],
  eventCode: string,
): number {
  return requests.reduce((count, request) =>
    count + request.entries.filter((entry) => entry.eventCode === eventCode).length,
  0);
}
