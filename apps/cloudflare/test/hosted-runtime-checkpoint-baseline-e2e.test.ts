import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
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
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  readHostedBundleTextFile,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import { afterEach, describe, expect, it } from "vitest";

import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/runtime-bridge-workspace.ts";

const TEST_NOW = "2026-05-04T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_checkpoint_baseline";
const BASELINE_ARTIFACT_COUNT = 100;
const BASELINE_ASSISTANT_MESSAGE_COUNT = 300;
const BASELINE_ASSISTANT_MESSAGES_IN_HOT_SNAPSHOT = 100;
const BASELINE_TRANSCRIPT_RELATIVE_PATH =
  ".runtime/operations/assistant/transcripts/session_checkpoint_baseline.jsonl";
const OVER_BUDGET_CODEX_HOME_BYTES = 17 * 1024 * 1024;
const CODEX_ROLLOUT_E2E_USER_ID = "member_synthetic_codex_rollout_e2e";
const CODEX_ROLLOUT_E2E_THREAD_ID_PATTERN =
  /^00000000-0000-4000-8000-[0-9]{12}$/u;
const CODEX_ROLLOUT_E2E_PATH_PATTERN =
  /^sessions\/2026\/05\/06\/rollout-2026-05-06T01-02-03-00000000-0000-4000-8000-[0-9]{12}\.jsonl$/u;
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
  it("publishes a browser-vault replica for canonical device-sync checkpoint commits", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-device-base-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-device-working-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot);
    await writeSyntheticVaultMetadata(baseVaultRoot);
    await writeSyntheticVaultMetadata(vaultRoot);
    await mkdir(path.join(vaultRoot, "bank", "device-sync"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "bank", "device-sync", "whoop-spo2.jsonl"),
      JSON.stringify({
        at: "2026-05-07T12:30:45.000Z",
        biomarkerKey: "biomarker:blood-oxygen-spo2",
        provider: "whoop",
        unit: "percent",
        value: 98,
      }) + "\n",
      "utf8",
    );

    const artifactPutCalls: BaselineArtifactPutCall[] = [];
    const artifactPutBytesByHash = new Map<string, Uint8Array>();
    const baseSnapshotRef = await createBaselineFullSnapshotRef({
      artifactPutBytesByHash,
      vaultRoot: baseVaultRoot,
    });
    const existingBrowserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeLogRequests: HostedRuntimeLogRequest[] = [];
    const publishedReplicaSourceHashes: string[] = [];
    const request = createWorkspaceInvocationRequest({
      attemptId: "attempt_synthetic_device_sync_replica_regression",
      workspaceVersion: "8",
    });
    const platform = {
      ...createBaselinePlatform({
        artifactPutCalls,
        artifactPutBytesByHash,
        mailboxPort: createBaselineMailboxPort({
          fetchRequests: [],
          items: [],
        }),
        runtimeLogRequests,
        workspacePort: createBaselineWorkspacePort({
          checkpointRequests,
          workspace: createWorkspaceState({
            browserVaultReplicaRef: existingBrowserVaultReplicaRef,
            snapshotRef: baseSnapshotRef,
            version: request.workspaceVersion,
          }),
        }),
      }),
      browserVaultReplicaPort: {
        async write(input: { replica: unknown }) {
          const sourceBundleHash = readBrowserVaultReplicaSourceBundleHash(input.replica);
          publishedReplicaSourceHashes.push(sourceBundleHash);
          return createBrowserVaultReplicaRef(sourceBundleHash);
        },
      },
    } satisfies HostedRuntimePlatform;
    const bridgeOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      readCurrentLease: () => ({
        attemptId: request.attemptId,
        leaseGeneration: request.leaseGeneration,
        userId: request.userId,
        workspaceVersion: request.workspaceVersion,
      }),
      request,
      runtime: BASELINE_RUNTIME,
      vaultRoot,
    });

    const result = await bridgeOptions.createCheckpointSnapshot(
      createBaselineCheckpointInput("canonical_runtime_commit"),
    );

    expect(checkpointRequests).toHaveLength(0);
    expect(publishedReplicaSourceHashes).toHaveLength(1);
    expect(result.browserVaultReplicaRef).toEqual(expect.objectContaining({
      sourceBundleHash: publishedReplicaSourceHashes[0],
    }));
  });

  it("measures working mailbox checkpoint side effects for 100 artifacts and 300 assistant messages", async () => {
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
    const existingBaseSnapshotRef = await createBaselineFullSnapshotRef({
      artifactPutBytesByHash,
      vaultRoot,
    });
    const existingBrowserVaultReplicaRef = createBrowserVaultReplicaRef(existingBaseSnapshotRef.hash);
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
    const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(snapshotRef);
    const snapshotHash = deltaSnapshotRef?.hash ?? null;
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
      assistantMessagesInSnapshotBundle: BASELINE_ASSISTANT_MESSAGES_IN_HOT_SNAPSHOT,
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
    expect(bundledTranscriptText).not.toContain("Synthetic checkpoint baseline assistant message 200");
    expect(checkpointRequests[0]?.reason).toBe("import");
    expect(restoredBaseSnapshotRef).toEqual(existingBaseSnapshotRef);
    expect(deltaSnapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-deltas\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(checkpointRequests[0]).not.toHaveProperty("browserVaultReplicaRef");

    if (process.env.HOSTED_CHECKPOINT_BASELINE_LOG === "1") {
      process.stdout.write(`hosted-checkpoint-baseline ${JSON.stringify(metrics)}\n`);
    }
  });

  it("keeps over-budget Codex home out of import working checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-checkpoint-codex-budget-"));
    const operatorHomeRoot = `${vaultRoot}-operator-home`;
    cleanupPaths.push(vaultRoot, operatorHomeRoot);
    await writeSyntheticVaultMetadata(vaultRoot);
    await seedHostedCheckpointBaselineWorkspace({
      artifactCount: BASELINE_ARTIFACT_COUNT,
      assistantMessageCount: BASELINE_ASSISTANT_MESSAGE_COUNT,
      vaultRoot,
    });
    await seedOverBudgetCodexHome({
      byteLength: OVER_BUDGET_CODEX_HOME_BYTES,
      operatorHomeRoot,
    });

    const artifactPutCalls: BaselineArtifactPutCall[] = [];
    const artifactPutBytesByHash = new Map<string, Uint8Array>();
    const existingBaseSnapshotRef = await createBaselineFullSnapshotRef({
      artifactPutBytesByHash,
      operatorHomeRoot,
      vaultRoot,
    });
    const existingBrowserVaultReplicaRef = createBrowserVaultReplicaRef(existingBaseSnapshotRef.hash);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeLogRequests: HostedRuntimeLogRequest[] = [];
    const request = createWorkspaceInvocationRequest({
      attemptId: "attempt_synthetic_checkpoint_codex_budget",
    });
    const platform = createBaselinePlatform({
      artifactPutCalls,
      artifactPutBytesByHash,
      mailboxPort: createBaselineMailboxPort({
        fetchRequests,
        items: [
          createMailboxItem({
            id: "mailbox_item_checkpoint_codex_budget_001",
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
      readCurrentLease: () => ({
        attemptId: request.attemptId,
        leaseGeneration: request.leaseGeneration,
        userId: request.userId,
        workspaceVersion: request.workspaceVersion,
      }),
      request,
      runtime: BASELINE_RUNTIME,
      vaultRoot,
    });

    const result = await runHostedWorkspaceRuntimeJobInProcess({
      request,
      runtime: BASELINE_RUNTIME,
    }, {
      ...bridgeOptions,
      async importItem() {
        return { status: "imported" };
      },
      platform,
      vaultRoot,
    });

    const snapshotRef = checkpointRequests[0]?.snapshotRef ?? null;
    const deltaSnapshotRef = readHostedExecutionSnapshotDeltaRef(snapshotRef);
    const deltaBundleBytes = deltaSnapshotRef
      ? artifactPutBytesByHash.get(deltaSnapshotRef.hash) ?? null
      : null;
    const fallbackLog = findFirstRuntimeLogEntry(
      runtimeLogRequests,
      "checkpoint.hot_state_fallback",
    );
    const snapshotLog = findFirstRuntimeLogEntry(
      runtimeLogRequests,
      "checkpoint.snapshot_finished",
    );
    const codexDiagnosticLog = findFirstRuntimeLogEntry(
      runtimeLogRequests,
      "workspace.codex_home_snapshot",
    );

    expect(result.status).toBe("idle");
    expect(checkpointRequests[0]?.reason).toBe("import");
    expect(deltaSnapshotRef).toEqual(expect.objectContaining({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      key: expect.stringMatching(/^cloudflare-workspace-deltas\/[a-f0-9]{64}\.bundle$/u),
      size: expect.any(Number),
    }));
    expect(fallbackLog).toBeNull();
    expect(snapshotLog?.redactedJson).toMatchObject({
      checkpointReason: "import",
      snapshotMode: "working",
    });
    expect(codexDiagnosticLog).toBeNull();
    expect(deltaSnapshotRef).not.toBeNull();
    expect(artifactPutCalls).toHaveLength(1);
    expect(readHostedBundleTextFile({
      bytes: deltaBundleBytes,
      expectedKind: "vault",
      path: ".codex-hosted/rollouts/over-budget-rollout.jsonl",
      root: "operator-home",
    })).toBeNull();
    expect(checkpointRequests[0]?.snapshotRef).toEqual(expect.objectContaining({
      base: existingBaseSnapshotRef,
      delta: expect.objectContaining({
        key: expect.stringMatching(/^cloudflare-workspace-deltas\/[a-f0-9]{64}\.bundle$/u),
      }),
      schema: "murph.hosted-execution-working-snapshot.v1",
    }));
    expect(checkpointRequests[0]).not.toHaveProperty("browserVaultReplicaRef");
    expect(snapshotLog?.redactedJson).not.toMatchObject({
      checkpointReason: "import",
      snapshotMode: "full",
    });

    if (process.env.HOSTED_CHECKPOINT_BASELINE_LOG === "1") {
      process.stdout.write(`hosted-checkpoint-codex-budget ${JSON.stringify({
        artifactPutBytes: artifactPutCalls.reduce((total, call) => total + call.byteLength, 0),
        artifactPutCalls: artifactPutCalls.length,
        mailboxFetchCalls: fetchRequests.length,
        workspaceCheckpointCalls: checkpointRequests.length,
      })}\n`);
    }
  });

  it("restores active Codex rollout continuity after local workspace teardown and resumes by thread id", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-codex-rollout-e2e-"));
    const initialVaultRoot = path.join(workspaceRoot, "vault-initial");
    const initialOperatorHomeRoot = `${initialVaultRoot}-operator-home`;
    const restoredVaultRoot = path.join(workspaceRoot, "vault-restored");
    const restoredOperatorHomeRoot = `${restoredVaultRoot}-operator-home`;
    cleanupPaths.push(workspaceRoot);
    await mkdir(initialVaultRoot, { recursive: true });
    await writeSyntheticVaultMetadata(initialVaultRoot);
    const responsesServer = await startCodexRolloutResponsesServer({
      responseTexts: [
        buildAssistantNotificationDecisionResponse("first rollout checkpoint reply"),
        buildAssistantNotificationDecisionResponse("second rollout checkpoint reply"),
      ],
    });
    const artifactPutCalls: BaselineArtifactPutCall[] = [];
    const artifactPutBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeLogRequests: HostedRuntimeLogRequest[] = [];
    const decodedWakes = new Map<string, ReturnType<typeof createCodexRolloutNotificationWake>>();
    let workspace = createWorkspaceState({
      checkpointedAt: null,
      createdAt: TEST_NOW,
      snapshotRef: null,
      userId: CODEX_ROLLOUT_E2E_USER_ID,
      version: "0",
    });
    const mailboxItems: HostedMailboxItem[] = [];
    const platform = createBaselinePlatform({
      artifactPutCalls,
      artifactPutBytesByHash,
      mailboxPort: createBaselineMailboxPort({
        fetchRequests,
        items: mailboxItems,
        userId: CODEX_ROLLOUT_E2E_USER_ID,
      }),
      runtimeLogRequests,
      workspacePort: {
        async read() {
          return {
            fetchedAt: TEST_NOW,
            workspace,
          };
        },
        async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
          checkpointRequests.push(request);
          workspace = createWorkspaceState({
            browserVaultReplicaRef: request.browserVaultReplicaRef ?? null,
            checkpointedAt: TEST_NOW,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            userId: CODEX_ROLLOUT_E2E_USER_ID,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          });
          return {
            checkpointed: true,
            workspace,
          };
        },
      },
    });
    const runtime = {
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_LOG_FINGERPRINT_SECRET: "synthetic-rollout-log-secret",
        [HOSTED_RUNTIME_CODEX_APP_SERVER_STUB_BASE_URL_ENV]: responsesServer.baseUrl,
        LINQ_API_BASE_URL: responsesServer.linqBaseUrl,
        LINQ_API_TOKEN: "linq-rollout-e2e-token",
        NODE_ENV: "test",
        OPENAI_API_KEY: "test-openai-key",
        PATH: process.env.PATH ?? "",
      },
    };

    try {
      const firstWake = createCodexRolloutNotificationWake({
        eventId: "assistant.notification.requested:codex-rollout:first",
        instructions: "Send the first checkpoint continuity note.",
        text: "first rollout checkpoint reply",
      });
      mailboxItems.push(createMailboxItem({
        dedupeKey: firstWake.eventId,
        id: "mailbox_item_codex_rollout_001",
        kind: "assistant.notification.requested",
        lane: "system",
        laneSeq: "1",
        payloadInlineCiphertext: "ciphertext_codex_rollout_001",
        userId: CODEX_ROLLOUT_E2E_USER_ID,
      }));
      decodedWakes.set("ciphertext_codex_rollout_001", firstWake);

      const firstResult = await runCodexRolloutWorkspaceInvocation({
        attemptId: "attempt_codex_rollout_001",
        decodedWakes,
        platform,
        runtime,
        vaultRoot: initialVaultRoot,
        workspaceVersion: "0",
      });

      expect(firstResult.status).toBe("scheduled");
      expect(firstResult.nextWakeAt).toEqual(expect.any(String));
      expect(firstResult.redactedStatus).toMatchObject({
        hostedMailboxImportedCount: 1,
        hostedOutboxDeliverySent: 1,
      });
      expect(responsesServer.requests).toHaveLength(1);
      const firstSession = await readOnlyCodexSession(initialVaultRoot);
      expect(firstSession.providerSessionId).toMatch(CODEX_ROLLOUT_E2E_THREAD_ID_PATTERN);
      expect(firstSession.codexRolloutRelativePath).toMatch(CODEX_ROLLOUT_E2E_PATH_PATTERN);
      expect(firstSession.codexRolloutRelativePath).toContain(firstSession.providerSessionId);
      expect(await readFile(
        path.join(initialOperatorHomeRoot, ".codex-hosted", firstSession.codexRolloutRelativePath),
        "utf8",
      )).toContain("first rollout checkpoint reply");
      const checkpointCountAfterFirstRun = checkpointRequests.length;
      expect(checkpointCountAfterFirstRun).toBeGreaterThan(0);

      await rm(initialVaultRoot, { force: true, recursive: true });
      await rm(initialOperatorHomeRoot, { force: true, recursive: true });

      const secondWake = createCodexRolloutNotificationWake({
        eventId: "assistant.notification.requested:codex-rollout:second",
        instructions: "Send the second checkpoint continuity note.",
        text: "second rollout checkpoint reply",
      });
      mailboxItems.push(createMailboxItem({
        dedupeKey: secondWake.eventId,
        id: "mailbox_item_codex_rollout_002",
        kind: "assistant.notification.requested",
        lane: "system",
        laneSeq: "2",
        payloadInlineCiphertext: "ciphertext_codex_rollout_002",
        userId: CODEX_ROLLOUT_E2E_USER_ID,
      }));
      decodedWakes.set("ciphertext_codex_rollout_002", secondWake);

      const secondResult = await runCodexRolloutWorkspaceInvocation({
        attemptId: "attempt_codex_rollout_002",
        decodedWakes,
        platform,
        runtime,
        vaultRoot: restoredVaultRoot,
        workspaceVersion: workspace.version,
      });

      expect(secondResult.status).toBe("scheduled");
      expect(secondResult.nextWakeAt).toEqual(expect.any(String));
      expect(secondResult.redactedStatus).toMatchObject({
        hostedMailboxImportedCount: 1,
        hostedOutboxDeliverySent: 1,
      });
      expect(responsesServer.requests).toHaveLength(2);
      const secondSession = await readOnlyCodexSession(restoredVaultRoot);
      expect(secondSession.providerSessionId).toBe(firstSession.providerSessionId);
      expect(secondSession.codexRolloutRelativePath).toBe(firstSession.codexRolloutRelativePath);
      expect(readCodexRolloutResponsesInput(responsesServer.requests[1]!))
        .toContain("Conversation so far:\nAssistant:\n{\"kind\":\"send_message\"");
      expect(readCodexRolloutResponsesInput(responsesServer.requests[1]!))
        .toContain("\"text\":\"first rollout checkpoint reply\"");
      expect(readCodexRolloutResponsesInput(responsesServer.requests[1]!))
        .toContain("Send the second checkpoint continuity note.");
      await expect(readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "state_1.sqlite"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "history.jsonl"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      const secondRunCheckpoints = checkpointRequests.slice(checkpointCountAfterFirstRun);
      expect(secondRunCheckpoints.length).toBeGreaterThan(0);
      const snapshotBundleRefs = secondRunCheckpoints
        .slice()
        .reverse()
        .flatMap((request) => [
          readHostedExecutionSnapshotDeltaRef(request.snapshotRef),
          readHostedExecutionSnapshotHotRef(request.snapshotRef),
          readHostedExecutionSnapshotBaseRef(request.snapshotRef),
        ].filter((snapshotRef) => snapshotRef !== null));
      const snapshotBundleRef = snapshotBundleRefs.find((snapshotRef) => {
        const bytes = artifactPutBytesByHash.get(snapshotRef.hash) ?? null;
        return readHostedBundleTextFile({
          bytes,
          expectedKind: "vault",
          path: `.codex-hosted/${secondSession.codexRolloutRelativePath}`,
          root: "operator-home",
        })?.includes("second rollout checkpoint reply") === true;
      }) ?? null;
      expect(snapshotBundleRef).toEqual(expect.objectContaining({
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }));
      const secondHotBundle = snapshotBundleRef
        ? artifactPutBytesByHash.get(snapshotBundleRef.hash) ?? null
        : null;
      expect(readHostedBundleTextFile({
        bytes: secondHotBundle,
        expectedKind: "vault",
        path: `.codex-hosted/${secondSession.codexRolloutRelativePath}`,
        root: "operator-home",
      })).toEqual(expect.stringContaining("second rollout checkpoint reply"));
      expect(readHostedBundleTextFile({
        bytes: secondHotBundle,
        expectedKind: "vault",
        path: `.codex-hosted/${secondSession.codexRolloutRelativePath}`,
        root: "operator-home",
      })).toEqual(expect.stringContaining("\"event\":\"thread.resumed\""));
      expect(readHostedBundleTextFile({
        bytes: secondHotBundle,
        expectedKind: "vault",
        path: ".codex-hosted/rollouts/hosted-e2e-codex-shim.jsonl",
        root: "operator-home",
      })).toBeNull();
      expect(readHostedBundleTextFile({
        bytes: secondHotBundle,
        expectedKind: "vault",
        path: ".codex-hosted/state_1.sqlite",
        root: "operator-home",
      })).toBeNull();
      const codexSnapshotLogs = findRuntimeLogEntries(
        runtimeLogRequests,
        "workspace.codex_home_snapshot",
      );
      const latestCodexSnapshotLogJson = codexSnapshotLogs.at(-1)?.redactedJson;
      expect(latestCodexSnapshotLogJson).toMatchObject({
        codexResumeMissingRolloutCount: 0,
        codexResumeRolloutBytes: expect.any(Number),
        codexResumeThreadCount: 1,
      });
      const codexResumeRolloutBytes = latestCodexSnapshotLogJson?.codexResumeRolloutBytes;
      if (typeof codexResumeRolloutBytes !== "number") {
        throw new Error("Expected Codex snapshot log to include numeric rollout byte count.");
      }
      expect(codexResumeRolloutBytes).toBeGreaterThan(0);
      expect(latestCodexSnapshotLogJson).not.toHaveProperty(
        "codexResumeRolloutRelativePaths",
      );
    } finally {
      await responsesServer.close();
    }
  }, 180_000);
});

interface BaselineArtifactPutCall {
  byteLength: number;
  sha256: string;
}

async function createBaselineFullSnapshotRef(input: {
  artifactPutBytesByHash: Map<string, Uint8Array>;
  operatorHomeRoot?: string;
  vaultRoot: string;
}): Promise<HostedExecutionBundleRef> {
  const snapshot = await snapshotHostedExecutionContext({
    artifactSink: async (artifact) => {
      input.artifactPutBytesByHash.set(artifact.ref.sha256, artifact.bytes);
    },
    operatorHomeRoot: input.operatorHomeRoot,
    vaultRoot: input.vaultRoot,
  });
  const baseBundleHash = sha256HostedBundleHex(snapshot.bundle);
  input.artifactPutBytesByHash.set(baseBundleHash, snapshot.bundle);
  return createSnapshotBundleRef({
    hash: baseBundleHash,
    size: snapshot.bundle.byteLength,
  });
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

async function seedOverBudgetCodexHome(input: {
  byteLength: number;
  operatorHomeRoot: string;
}): Promise<void> {
  const rolloutsDirectory = path.join(input.operatorHomeRoot, ".codex-hosted", "rollouts");
  await mkdir(rolloutsDirectory, { recursive: true });
  await writeFile(
    path.join(rolloutsDirectory, "over-budget-rollout.jsonl"),
    Buffer.alloc(input.byteLength, "x"),
  );
}

function createCodexRolloutNotificationWake(input: {
  eventId: string;
  instructions: string;
  text: string;
}) {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId,
    memberId: CODEX_ROLLOUT_E2E_USER_ID,
    notification: {
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: input.eventId,
      instructions: input.instructions,
      responsePolicy: {
        kind: "require_send_exact_text",
        text: input.text,
      },
      route: {
        actorId: "hosted-rollout-e2e-actor",
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "linq_thread_codex_rollout_e2e",
        },
        identityId: "hbidx:phone:v1:codex-rollout-e2e",
        threadId: "linq_thread_codex_rollout_e2e",
        threadIsDirect: true,
      },
    },
    occurredAt: TEST_NOW,
  });
}

async function runCodexRolloutWorkspaceInvocation(input: {
  attemptId: string;
  decodedWakes: ReadonlyMap<string, ReturnType<typeof createCodexRolloutNotificationWake>>;
  platform: HostedRuntimePlatform;
  runtime: typeof BASELINE_RUNTIME;
  vaultRoot: string;
  workspaceVersion: string;
}) {
  const request = createWorkspaceInvocationRequest({
    attemptId: input.attemptId,
    userId: CODEX_ROLLOUT_E2E_USER_ID,
    workspaceVersion: input.workspaceVersion,
  });
  const bridgeOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
    decodeMailboxPayload: {
      async decode(decodeInput) {
        const wake = input.decodedWakes.get(decodeInput.payloadCiphertext);
        if (!wake) {
          return {
            reasonCode: "payload.decode_missing",
            retryable: false,
            status: "blocked",
          };
        }

        return {
          status: "decoded",
          wake,
        };
      },
    },
    platform: input.platform,
    readCurrentLease: () => ({
      attemptId: request.attemptId,
      leaseGeneration: request.leaseGeneration,
      userId: request.userId,
      workspaceVersion: request.workspaceVersion,
    }),
    request,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
  });

  return await runHostedWorkspaceRuntimeJobInProcess({
    request,
    runtime: input.runtime,
  }, {
    ...bridgeOptions,
    platform: input.platform,
    vaultRoot: input.vaultRoot,
  });
}

async function readOnlyCodexSession(vaultRoot: string): Promise<{
  codexRolloutRelativePath: string;
  providerSessionId: string;
}> {
  const sessionsDirectory = resolveAssistantStatePaths(vaultRoot).sessionsDirectory;
  const fileNames = await readdir(sessionsDirectory);
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const parsed = JSON.parse(await readFile(path.join(sessionsDirectory, fileName), "utf8")) as {
      resumeState?: {
        codexRolloutRelativePath?: unknown;
        providerSessionId?: unknown;
      } | null;
    };
    const providerSessionId = parsed.resumeState?.providerSessionId;
    const codexRolloutRelativePath = parsed.resumeState?.codexRolloutRelativePath;
    if (
      typeof providerSessionId === "string"
      && typeof codexRolloutRelativePath === "string"
    ) {
      return {
        codexRolloutRelativePath,
        providerSessionId,
      };
    }
  }

  throw new Error("Expected hosted Codex session resume state after notification turn.");
}

function buildAssistantNotificationDecisionResponse(text: string): string {
  return JSON.stringify({
    kind: "send_message",
    privateSummary: "deliver rollout continuity proof",
    text,
  });
}

async function startCodexRolloutResponsesServer(input: {
  responseTexts: readonly string[];
}): Promise<{
  baseUrl: string;
  close(): Promise<void>;
  linqBaseUrl: string;
  linqRequests: string[];
  requests: string[];
}> {
  const requests: string[] = [];
  const linqRequests: string[] = [];
  const responseTexts = [...input.responseTexts];
  const server = createServer(async (request, response) => {
    const body = await readHttpRequestBody(request);
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname.startsWith("/chats/")) {
      linqRequests.push(body);
      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        chat_id: "linq_thread_codex_rollout_e2e",
        message: {
          id: `linq_msg_codex_rollout_${linqRequests.length}`,
        },
      }));
      return;
    }

    if (requestUrl.pathname !== "/v1/responses") {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "unexpected test endpoint" }));
      return;
    }

    requests.push(body);
    const nextText = responseTexts.shift() ?? buildAssistantNotificationDecisionResponse(
      "fallback rollout checkpoint reply",
    );
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({
      id: `resp_codex_rollout_${requests.length}`,
      object: "response",
      output: [
        {
          content: [
            {
              text: nextText,
              type: "output_text",
            },
          ],
          id: `msg_codex_rollout_${requests.length}`,
          role: "assistant",
          type: "message",
        },
      ],
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseUrl: `${readServerBaseUrl(server)}/v1`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    linqBaseUrl: readServerBaseUrl(server),
    linqRequests,
    requests,
  };
}

async function readHttpRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readServerBaseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Responses server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function readCodexRolloutResponsesInput(body: string): string {
  const parsed = JSON.parse(body) as { input?: unknown };
  if (typeof parsed.input !== "string") {
    throw new Error("Codex rollout responses request did not contain string input.");
  }
  return parsed.input;
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
  userId?: string;
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
        userId: input.userId ?? TEST_USER_ID,
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

function createBaselineCheckpointInput(reason: HostedWorkspaceCheckpointRequest["reason"]) {
  const state = {
    recentStatuses: [],
    watermarks: {
      conversation: "0",
      system: "0",
    },
  };

  return {
    importResult: {
      blocked: [],
      fetchedCount: 0,
      importedCount: 0,
      state,
    },
    previousState: state,
    reason,
    redactedStatus: {},
    state,
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
}): HostedExecutionBundleRef {
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

function readBrowserVaultReplicaSourceBundleHash(replica: unknown): string {
  if (!replica || typeof replica !== "object" || Array.isArray(replica)) {
    throw new TypeError("Browser vault replica must be an object.");
  }

  const source = (replica as Record<string, unknown>).source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Browser vault replica source must be an object.");
  }

  const sourceBundleHash = (source as Record<string, unknown>).sourceBundleHash;
  if (typeof sourceBundleHash !== "string") {
    throw new TypeError("Browser vault replica sourceBundleHash must be a string.");
  }

  return sourceBundleHash;
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

function findFirstRuntimeLogEntry(
  requests: readonly HostedRuntimeLogRequest[],
  eventCode: string,
): HostedRuntimeLogRequest["entries"][number] | null {
  for (const request of requests) {
    const entry = request.entries.find((candidate) => candidate.eventCode === eventCode);
    if (entry) {
      return entry;
    }
  }
  return null;
}

function findRuntimeLogEntries(
  requests: readonly HostedRuntimeLogRequest[],
  eventCode: string,
): HostedRuntimeLogRequest["entries"] {
  return requests.flatMap((request) =>
    request.entries.filter((entry) => entry.eventCode === eventCode)
  );
}
