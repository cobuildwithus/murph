import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { addMeal, findEventByExternalRef, initializeVault, readPreferencesDocument } from "@murphai/core";
import { workoutSessionSchema, type MemberActionOutcomeV1 } from "@murphai/contracts";
import { readMealNutritionTotals } from "@murphai/query";
import { addLiveWorkoutExercise, showWorkoutRecord, startLiveWorkout } from "@murphai/vault-usecases/workouts";
import { deriveWorkoutActionBinding } from "@murphai/operator-config/workout-action-binding";
import { buildHostedExecutionMemberActionCompletedWake, buildHostedExecutionMemberActionRequestedWake, buildHostedExecutionMemberPreferencesUpdatedWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { buildHostedExecutionClinicalRecordsSyncRequestedWake, type HostedClinicalRecordsRunDescriptor } from "@murphai/hosted-execution/clinical-records";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { readNextClinicalEnrichment } from "@murphai/vault-usecases/clinical-enrichment";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { importHostedMailboxPrefixAndCheckpoint } from "../src/hosted-runtime/mailbox-checkpoint.ts";
import { createHostedWorkspaceBridgeMailboxImporter } from "../src/hosted-runtime/snapshot-bridge-mailbox.ts";
import { createHostedRuntimeResolvedConfig } from "./hosted-runtime-test-helpers.ts";
import { createHostedMailboxRoutingPlan } from "../src/hosted-runtime/mailbox-routing.ts";
import { enqueueHostedSystemMailboxItem, prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  TEST_NOW, TEST_USER_ID, createMailboxItem, createMailboxPort, createPlatform,
  createBrowserVaultReplicaRef, createResolvedRuntimeControlSystemMailboxItem, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, ensureHostedBootstrapMetadataForSystemMailboxTest,
  mocks, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test.each([false, true])("AI-denied actions and clinical import checkpoint and replay without model calls or spend (receipt retry=%s)", async (retryReceipt) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-model-free-actions-"));
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  const outcomes = new Map<string, MemberActionOutcomeV1>();
  const recordUsage = vi.fn(async () => { throw new Error("AI-denied work must not spend"); });
  const runAssistantPhase = vi.fn(async () => { throw new Error("AI-denied work must not call a model"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  try {
    await initializeVault({ createdAt: TEST_NOW, timezone: "UTC", vaultRoot });
    await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
    const meal = await addMeal({ vaultRoot, occurredAt: TEST_NOW, note: "Synthetic meal", nutrition: { totals: { calories: 500 } } });
    const started = await startLiveWorkout({ vault: vaultRoot, name: "Strength", startedAt: TEST_NOW });
    await addLiveWorkoutExercise({ vault: vaultRoot, workoutId: started.eventId, mode: "bodyweight", name: "Push-up", order: 1 });
    const initial = workoutSessionSchema.parse((await showWorkoutRecord(vaultRoot, started.eventId)).entity.data.workout);
    const wakes = [
      buildHostedExecutionMemberActionRequestedWake({ eventId: "member.action.requested:meal", memberId: TEST_USER_ID, occurredAt: TEST_NOW,
        request: { actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243", schemaVersion: 1, requestedAt: TEST_NOW,
          action: { kind: "meal.delete", version: 1, mealId: meal.mealId } } }),
      buildHostedExecutionMemberActionRequestedWake({ eventId: "member.action.requested:workout", memberId: TEST_USER_ID, occurredAt: TEST_NOW,
        request: { actionId: "8676b264-9b91-4b50-8c73-184d7a63b901", schemaVersion: 1, requestedAt: TEST_NOW,
          action: { kind: "workout.live.apply", version: 1,
            expectedWorkout: { actionBinding: deriveWorkoutActionBinding(started.eventId, initial), exercises: [{ name: "Push-up", sets: [{ logged: false }] }] },
            mutations: [{ kind: "set.put", exerciseName: "Push-up", exercisePosition: 1, setPosition: 1, expectedResult: null, result: { kind: "reps", reps: 8 } }] } } }),
      buildHostedExecutionMemberPreferencesUpdatedWake({ eventId: "member.preferences.updated:synthetic", memberId: TEST_USER_ID, occurredAt: TEST_NOW, preferences: { tone: "formal" } }),
      buildHostedExecutionClinicalRecordsSyncRequestedWake({ eventId: "clinical-records.sync-requested:synthetic", userId: TEST_USER_ID, occurredAt: TEST_NOW, runId: "clinical_run_1", generation: 1 }),
    ];
    for (const [index, wake] of wakes.entries()) {
      const item = createMailboxItem({ id: `model_free_${index}`, kind: wake.kind, lane: "system", laneSeq: String(index + 1), dedupeKey: wake.eventId });
      const resolved = createResolvedRuntimeControlSystemMailboxItem(item);
      const route = createHostedMailboxRoutingPlan(item);
      if (route.state !== "route") throw new Error("Invalid synthetic route");
      await enqueueHostedSystemMailboxItem({ item: { ...resolved, route }, vaultRoot, wake });
    }
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "4";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const artifactBytesByHash = new Map([[snapshot.hash, snapshot.bytes]]);
    let workspace = createWorkspaceState({ snapshotRef: snapshot.snapshotRef, version: "0" });
    const baseWorkspacePort = createWorkspacePort({ checkpointRequests, events, workspace });
    const run: HostedClinicalRecordsRunDescriptor = {
      retrievalProtocol: "query-slices-v2", connectionId: "connection_1", runId: "clinical_run_1", retrievalJobId: "clinical_run_1",
      fetchedAt: TEST_NOW, generation: 1, sourceSystem: "epic-fhir", fhirBaseUrlHash: hash("https://ehr.example.test/fhir"), patientIdHash: hash("patient-1"),
      requestedScopes: ["patient/Observation.read"], grantedScopes: ["patient/Observation.read"],
      retrievalSlices: [{ queryScopeId: "observation", sliceId: "whole", coverage: "whole-family", queryFingerprint: hash("query"), resourceType: "Observation" }],
    };
    const resource = { resourceType: "Observation", id: "narrative", status: "final", subject: { reference: "Patient/patient-1" },
      meta: { lastUpdated: TEST_NOW }, effectiveDateTime: TEST_NOW, code: { text: "Narrative vital" }, valueString: "Resting heart rate 73 bpm." };
    const fetchPage = vi.fn(async () => ({ status: "page" as const, body: JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource }] }), nextCursor: null }));
    const recordClinicalOutcome = vi.fn(async () => { expect(checkpointRequests.length).toBeGreaterThan(0); });
    let receiptFailed = false;
    const recordMemberActionOutcome = vi.fn(async (outcome: MemberActionOutcomeV1) => {
      expect(checkpointRequests.length).toBeGreaterThan(0);
      const prior = outcomes.get(outcome.actionId);
      if (prior) expect(outcome).toEqual(prior);
      outcomes.set(outcome.actionId, outcome);
      if (retryReceipt && !receiptFailed) {
        receiptFailed = true;
        throw new Error("Synthetic response loss after receipt acceptance");
      }
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      vi.setSystemTime(new Date(Date.parse(TEST_NOW) + attempt * 5 * 60_000));
      await removeTempRoot(vaultRoot);
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: {
        processingMode: "system_mailbox", assistantExecutionBlocked: true, workspaceVersion: workspace.version, runnerIdleTtlMs: 1,
      } }), {
        vaultRoot, runAssistantPhase,
        async createCheckpointSnapshot() {
          const next = await createVaultSnapshotBundle({ vaultRoot });
          artifactBytesByHash.set(next.hash, next.bytes);
          return { snapshotRef: next.snapshotRef };
        },
        async importItem() { throw new Error("Already imported work must not be imported twice"); },
        platform: {
          ...createPlatform({ artifactBytesByHash,
            mailboxPort: { ...createMailboxPort({ events, items: [] }), recordMemberActionOutcome },
            workspacePort: { ...baseWorkspacePort,
              async read() { return { fetchedAt: TEST_NOW, workspace }; },
              async checkpoint(request) { const result = await baseWorkspacePort.checkpoint(request); workspace = result.workspace; return result; },
            },
          }),
          usageRecordPort: { recordUsage },
          clinicalRecordsPort: { fetchPage, readRun: async () => ({ status: "ready", run }), recordOutcome: recordClinicalOutcome },
        },
      });
    }
    expect(await readMealNutritionTotals(vaultRoot)).toMatchObject({ mealCount: 0 });
    expect(workoutSessionSchema.parse((await showWorkoutRecord(vaultRoot, started.eventId)).entity.data.workout).exercises[0]?.sets[0]?.reps).toBe(8);
    expect(await readPreferencesDocument(vaultRoot)).toMatchObject({ assistant: { tone: "formal" } });
    expect(await findEventByExternalRef({ vaultRoot, system: `epic-fhir-${run.fhirBaseUrlHash}-${run.patientIdHash}`, resourceType: "observation", resourceId: "narrative" })).not.toBeNull();
    expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([expect.objectContaining({ routeAction: "apply-clinical-enrichment", status: "pending" })]);
    expect(await readNextClinicalEnrichment({ vaultRoot })).toMatchObject({ status: "extract" });
    // A local enrichment item has no Web sequence and conservatively pins the frontier.
    expect(workspace.redactedStatus).toMatchObject({
      hostedMailboxSystemHandledThroughSeq: "0",
      hostedMailboxSystemImportedSeq: "4",
      hostedMailboxSystemModelFreeWakeAt: null,
      hostedMailboxSystemModelFreeWakeVersion: workspace.version,
    });
    expect([...outcomes.values()].map(({ status }) => status)).toEqual(["applied", "applied"]);
    // Each action publishes once before share projection and repeats the same
    // deterministic receipt at cleanup. A lost early response can land at cleanup.
    expect(recordMemberActionOutcome).toHaveBeenCalledTimes(4);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(recordClinicalOutcome).toHaveBeenCalledTimes(1);
    expect(runAssistantPhase).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(mocks.prepareHostedCodexAssistantProcess).not.toHaveBeenCalled();
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.executeReadOnlyAssistantAsk).not.toHaveBeenCalled();
    expect(mocks.executeConsentedReadOnlyAssistantAsk).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

test.each([false, true])("validated completion receipt advances checkpointed import without execution (prior action=%s)", async (priorAction) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-member-completion-import-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
  const outcome: MemberActionOutcomeV1 = {
    actionId, completedAt: TEST_NOW, schemaVersion: 1, status: "applied", reason: null,
  };
  const wake = buildHostedExecutionMemberActionCompletedWake({
    eventId: `member.action.completed:${actionId}`, memberId: TEST_USER_ID,
    occurredAt: TEST_NOW, outcome,
  });
  const item = createMailboxItem({ id: "member_completion_import", kind: wake.kind,
    lane: "system", laneSeq: priorAction ? "2" : "1", dedupeKey: wake.eventId });
  const decoded = vi.fn(async () => ({ status: "decoded" as const,
    wake: parseHostedExecutionWake(JSON.parse(JSON.stringify(wake))) }));
  const callback = vi.fn(async () => { throw new Error("Completion import must not publish an outcome"); });
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    if (priorAction) {
      const requested = buildHostedExecutionMemberActionRequestedWake({
        eventId: `member.action.requested:${actionId}`, memberId: TEST_USER_ID,
        occurredAt: TEST_NOW, request: { actionId, requestedAt: TEST_NOW,
          schemaVersion: 1, action: { kind: "display-name.set", version: 1, displayName: "Avery" } },
      });
      const pending = createMailboxItem({ id: "prior_member_action", kind: requested.kind,
        lane: "system", laneSeq: "1", dedupeKey: requested.eventId });
      const priorRoute = createHostedMailboxRoutingPlan(pending);
      if (priorRoute.state !== "route") throw new Error("Invalid prior route");
      await enqueueHostedSystemMailboxItem({
        item: { ...createResolvedRuntimeControlSystemMailboxItem(pending), route: priorRoute },
        vaultRoot, wake: requested,
      });
      await writeMailboxImportStateFile(vaultRoot, {
        ...createEmptyHostedMailboxImportState(),
        watermarks: { conversation: "0", system: "1" },
      });
    }
    const importer = createHostedWorkspaceBridgeMailboxImporter({
      decodeMailboxPayload: { decode: decoded }, vaultRoot,
      runtime: {
        commitTimeoutMs: null, forwardedEnv: {}, parserToolchain: { tools: {} },
        platformEnv: {}, resolvedConfig: createHostedRuntimeResolvedConfig(), userEnv: {},
        platform: createPlatform({
          mailboxPort: { ...createMailboxPort({ events, items: [] }),
            recordMemberActionOutcome: callback },
          workspacePort: createWorkspacePort({ checkpointRequests, events,
            workspace: createWorkspaceState({ version: "0" }) }),
        }),
      },
    });
    const preferencesBeforeImport = await readPreferencesDocument(vaultRoot);
    const result = await importHostedMailboxPrefixAndCheckpoint({
      expectedUserId: TEST_USER_ID, importItem: importer, lanes: ["system"],
      limitPerLane: 10, mailboxPort: createMailboxPort({ events, items: [item] }),
      now: () => TEST_NOW, requestId: "synthetic_completion_import", vaultRoot,
      createCheckpointRequest: () => ({
        attemptId: "synthetic_completion_import", expectedWorkspaceVersion: "0",
        leaseGeneration: "1", reason: "import", snapshotRef: null,
        nextWakeAt: null, nextWakeReason: null,
      }),
      workspacePort: createWorkspacePort({
        checkpointRequests, events, workspace: createWorkspaceState({ version: "0" }),
      }),
    });
    expect(result.checkpoint?.checkpointed).toBe(true);
    expect(result.state.watermarks.system).toBe(priorAction ? "2" : "1");
    expect(result.importResult.importedCount).toBe(1);
    expect(checkpointRequests[0]?.redactedStatus?.hostedMailboxSystemHandledThroughSeq)
      .toBe(priorAction ? "0" : "1");
    expect((await readHostedSystemMailboxState(vaultRoot)).pending.map((entry) => entry.itemId))
      .toEqual(priorAction ? ["prior_member_action"] : []);
    expect(decoded).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
    expect(await readPreferencesDocument(vaultRoot)).toEqual(preferencesBeforeImport);
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
  } finally {
    await removeTempRoot(vaultRoot);
  }
});

test.each(["malformed", "wrong member"] as const)("completion import rejects %s receipt after decode", async (scenario) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-member-completion-invalid-"));
  const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
  const wake = buildHostedExecutionMemberActionCompletedWake({
    eventId: `member.action.completed:${actionId}`,
    memberId: scenario === "wrong member" ? "member_other_synthetic" : TEST_USER_ID,
    occurredAt: TEST_NOW,
    outcome: { actionId, completedAt: TEST_NOW, schemaVersion: 1, status: "applied", reason: null },
  });
  const item = createMailboxItem({ id: "member_completion_invalid", kind: wake.kind,
    lane: "system", laneSeq: "1", dedupeKey: wake.eventId });
  const route = createHostedMailboxRoutingPlan(item);
  if (route.state !== "route") throw new Error("Invalid completion route");
  const importer = createHostedWorkspaceBridgeMailboxImporter({
    decodeMailboxPayload: { async decode() {
      if (scenario === "malformed") {
        expect(() => parseHostedExecutionWake({ ...wake, outcome: { ...wake.outcome, status: "invalid" } }))
          .toThrow();
        return { status: "blocked", reasonCode: "payload.invalid_schema", retryable: false };
      }
      return { status: "decoded", wake: parseHostedExecutionWake(wake) };
    } },
    vaultRoot,
    runtime: { commitTimeoutMs: null, forwardedEnv: {}, parserToolchain: { tools: {} },
      platformEnv: {}, resolvedConfig: createHostedRuntimeResolvedConfig(), userEnv: {},
      platform: createPlatform({ mailboxPort: null, workspacePort: null }) },
  });
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    expect((await importer({ ...createResolvedRuntimeControlSystemMailboxItem(item), route }))
      .status).toBe("blocked");
    expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
  } finally {
    await removeTempRoot(vaultRoot);
  }
});

test("historical queued completion item drains through its no-op consumer", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-member-completion-historical-"));
  const events: string[] = [];
  const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
  const wake = buildHostedExecutionMemberActionCompletedWake({
    eventId: `member.action.completed:${actionId}`, memberId: TEST_USER_ID,
    occurredAt: TEST_NOW,
    outcome: { actionId, completedAt: TEST_NOW, schemaVersion: 1,
      status: "applied", reason: null },
  });
  const item = createMailboxItem({ id: "historical_completion", kind: wake.kind,
    lane: "system", laneSeq: "1", dedupeKey: wake.eventId });
  const route = createHostedMailboxRoutingPlan(item);
  if (route.state !== "route") throw new Error("Invalid historical route");
  const callback = vi.fn(async () => { throw new Error("Historical no-op must not record again"); });
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await enqueueHostedSystemMailboxItem({
      item: { ...createResolvedRuntimeControlSystemMailboxItem(item), route }, vaultRoot, wake,
    });
    const runtime = {
      commitTimeoutMs: null, forwardedEnv: {}, platformEnv: {}, userEnv: {},
      resolvedConfig: createHostedRuntimeResolvedConfig(),
      platform: createPlatform({
        mailboxPort: { ...createMailboxPort({ events, items: [] }),
          recordMemberActionOutcome: callback }, workspacePort: null,
      }),
    };
    const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: ["apply-member-action"], runtime, runtimeEnv: {},
      retainProcessedItemUntilRecorded: true, vaultRoot,
    });
    expect(prepared?.status).toBe("processed");
    if (!prepared || prepared.status !== "processed") throw new Error("Expected historical no-op");
    expect(prepared.item.postCheckpointRecord).toBeNull();
    expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]?.status).toBe("recording");
    await recordHostedSystemMailboxItemAfterCheckpoint({ item: prepared.item, runtime, vaultRoot });
    expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
  } finally {
    await removeTempRoot(vaultRoot);
  }
});

test.each([
  "checkpoint before receipt",
  "accepted receipt with lost response",
  "early receipt before projection",
  "projection before cleanup checkpoint",
  "transient Browser Vault failure with no new input",
  "Browser Vault timeout",
  "source changed during Browser Vault refresh",
  "bounded transient refresh retries",
  "permanent oversized replica",
  "newer-owner publish conflict",
] as const)("member action retains checkpointed recovery through %s", async (boundary) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-member-action-boundary-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
  const wake = buildHostedExecutionMemberActionRequestedWake({
    eventId: `member.action.requested:${actionId}`, memberId: TEST_USER_ID, occurredAt: TEST_NOW,
    request: { actionId, requestedAt: TEST_NOW, schemaVersion: 1,
      action: { kind: "display-name.set", version: 1, displayName: "Avery" } },
  });
  const item = createMailboxItem({ id: "member_action_boundary", kind: wake.kind,
    lane: "system", laneSeq: "1", dedupeKey: wake.eventId });
  const route = createHostedMailboxRoutingPlan(item);
  if (route.state !== "route") throw new Error("Invalid synthetic route");
  const outcomes: MemberActionOutcomeV1[] = [];
  const accepted: MemberActionOutcomeV1[] = [];
  let projectionCalls = 0;
  let browserWrites = 0;
  let browserPublishes = 0;
  let firstAttempt = true;
  let workspace = createWorkspaceState({ version: "0" });
  const artifactBytesByHash = new Map<string, Uint8Array>();
  const baseWorkspacePort = createWorkspacePort({ checkpointRequests, events, workspace });
  const originalRefresh = mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(TEST_NOW));
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
    await enqueueHostedSystemMailboxItem({
      item: { ...createResolvedRuntimeControlSystemMailboxItem(item), route }, vaultRoot, wake,
    });
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "1";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
    workspace = createWorkspaceState({ version: "0", snapshotRef: snapshot.snapshotRef });
    if (boundary === "checkpoint before receipt") {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementationOnce(async () => {
        throw new Error("Synthetic crash after canonical checkpoint");
      });
    } else if (boundary === "transient Browser Vault failure with no new input"
      || boundary === "source changed during Browser Vault refresh") {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementationOnce(async () =>
        boundary === "source changed during Browser Vault refresh"
          ? { status: "deferred_source_changed" as const,
              source: { fileCount: 1, totalBytes: 2 } }
          : { status: "refresh_failed" as const });
    } else if (boundary === "Browser Vault timeout") {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementationOnce(async () => ({
        attempt: "initial", configuredTimeoutMs: 30_000,
        currentStepElapsedMs: 8_000, refreshElapsedMs: 30_000,
        refreshStage: "replica_serialization", refreshStep: "replica_serialization",
        source: { fileCount: 1, totalBytes: 2 }, status: "deferred_timeout",
      }));
    } else if (boundary === "permanent oversized replica") {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementationOnce(async () => ({
        status: "refresh_failed_too_large", maxBytes: 1, byteLength: 2,
        content: { entities: 0, hasPrivateContent: false, labResultRows: 0,
          metricGoalProgressRows: 0, metricRows: 0, metricSelectionRows: 0,
          searchRows: 0, sourceHealthRows: 0, timelineRows: 0, weeklySampleSummaries: 0 },
        source: { fileCount: 1, totalBytes: 2 },
      }));
    } else if (boundary === "newer-owner publish conflict") {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementationOnce(async () => ({
        status: "publish_conflict",
      }));
    } else if (boundary === "bounded transient refresh retries") {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async () => ({
        status: "refresh_failed",
      }));
    }
    const run = async () => {
      const shutdown = new AbortController();
      await removeTempRoot(vaultRoot);
      return await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: { processingMode: "system_mailbox", assistantExecutionBlocked: true,
          workspaceVersion: workspace.version, runnerIdleTtlMs: 1 },
      }), {
        vaultRoot,
        shutdownSignal: shutdown.signal,
        async createCheckpointSnapshot() {
          const next = await createVaultSnapshotBundle({ vaultRoot });
          artifactBytesByHash.set(next.hash, next.bytes);
          return { snapshotRef: next.snapshotRef };
        },
        async importItem() { throw new Error("Already imported action must not import again"); },
        platform: createPlatform({
          artifactBytesByHash,
          browserVaultReplicaPort: {
            async write({ replica }) {
              browserWrites += 1;
              events.push("browser.write");
              return createBrowserVaultReplicaRef(replica);
            },
            async publishRef({ replicaRef }) {
              browserPublishes += 1;
              events.push("browser.publish");
              return { published: true, workspace: { ...workspace, browserVaultReplicaRef: replicaRef } };
            },
          },
          mailboxPort: {
            ...createMailboxPort({ events, items: [] }),
            async recordMemberActionOutcome(outcome) {
              expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]).toMatchObject({
                status: "recording", postCheckpointRecord: { kind: "member-action.outcome-recorded" },
              });
              outcomes.push(outcome);
              if (accepted[0]) expect(outcome).toEqual(accepted[0]);
              accepted.push(outcome);
              events.push("receipt.accepted");
              if (firstAttempt && boundary === "accepted receipt with lost response"
                && outcomes.length === 1) throw new Error("Synthetic lost receipt response");
              if (firstAttempt && boundary === "early receipt before projection"
                && outcomes.length === 1) shutdown.abort();
            },
          },
          vaultSharePort: {
            async listActiveProjectionScopes() {
              projectionCalls += 1;
              events.push("share.projection");
              expect(accepted.length).toBeGreaterThan(0);
              expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]?.status).toBe("recording");
              if (firstAttempt && boundary === "accepted receipt with lost response") {
                throw new Error("Synthetic crash before share projection");
              }
              return { projectionKinds: [], projectionScopes: [] };
            },
            async deliver() { throw new Error("No share delivery expected"); },
          },
          workspacePort: {
            ...baseWorkspacePort,
            async read() { return { fetchedAt: TEST_NOW, workspace }; },
            async checkpoint(request) {
              if (firstAttempt && boundary === "projection before cleanup checkpoint"
                && projectionCalls > 0 && outcomes.length >= 2) {
                throw new Error("Synthetic cleanup checkpoint loss");
              }
              const response = await baseWorkspacePort.checkpoint(request);
              workspace = response.workspace;
              return response;
            },
          },
        }),
        async runAssistantPhase() { throw new Error("Model-free action must not call a model"); },
      });
    };
    const firstFailure = await run().then(() => null, (error: unknown) => error);
    if (boundary === "permanent oversized replica"
      || boundary === "newer-owner publish conflict") {
      expect(firstFailure).toBeNull();
      expect(accepted).toHaveLength(2);
      expect(accepted[0]?.status).toBe("applied");
      expect(accepted[1]).toEqual(accepted[0]);
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
      expect(projectionCalls).toBeGreaterThan(0);
      return;
    }
    if (boundary === "checkpoint before receipt"
      || boundary === "projection before cleanup checkpoint") {
      expect(firstFailure).toBeInstanceOf(Error);
      if (!(firstFailure instanceof Error)) throw new Error("Expected injected boundary failure");
      expect(firstFailure.message).toContain(
        boundary === "checkpoint before receipt"
          ? "Synthetic crash after canonical checkpoint"
          : "Synthetic cleanup checkpoint loss",
      );
    } else {
      expect(firstFailure).toBeNull();
      expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]).toMatchObject({
        status: "recording", postCheckpointRecord: { kind: "member-action.outcome-recorded" },
      });
    }
    // Cleanup can remove the local item before its checkpoint fails. The prior
    // canonical snapshot still carries it, and the early receipt is identical.
    const checkpointedRecord = (await readHostedSystemMailboxState(vaultRoot)).pending[0]
      ?.postCheckpointRecord;
    const checkpointedOutcome = checkpointedRecord?.kind === "member-action.outcome-recorded"
      ? checkpointedRecord.outcome : accepted[0];
    expect(checkpointedOutcome).toMatchObject({ status: "applied" });
    expect(checkpointRequests.length, String(firstFailure)).toBeGreaterThan(0);
    if (boundary === "checkpoint before receipt"
      || boundary === "transient Browser Vault failure with no new input"
      || boundary === "Browser Vault timeout"
      || boundary === "source changed during Browser Vault refresh"
      || boundary === "bounded transient refresh retries") {
      expect(accepted).toHaveLength(0);
    }
    else expect(accepted.length).toBeGreaterThan(0);
    if (boundary === "early receipt before projection") {
      expect(projectionCalls).toBe(0);
    }
    if (boundary === "transient Browser Vault failure with no new input"
      || boundary === "Browser Vault timeout"
      || boundary === "source changed during Browser Vault refresh") {
      const retryAt = (await readHostedSystemMailboxState(vaultRoot)).pending[0]?.nextAttemptAt;
      expect(retryAt).toBeTruthy();
      expect(workspace.redactedStatus?.hostedMailboxSystemModelFreeWakeAt).toBe(retryAt);
    }
    firstAttempt = false;
    vi.setSystemTime(new Date(Date.parse(TEST_NOW) + 5 * 60_000));
    await run();
    if (boundary === "bounded transient refresh retries") {
      expect(accepted).toHaveLength(0);
      expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]?.status).toBe("recording");
      vi.setSystemTime(new Date(Date.parse(TEST_NOW) + 10 * 60_000));
      await run();
      expect(accepted).toHaveLength(2);
      expect(accepted[0]).toEqual(checkpointedOutcome);
      expect(accepted[1]).toEqual(accepted[0]);
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
      return;
    }
    expect(accepted.length).toBeGreaterThanOrEqual(2);
    for (const outcome of accepted) {
      expect(outcome).toEqual(checkpointedOutcome);
    }
    expect(browserWrites).toBeGreaterThan(0);
    expect(browserPublishes).toBeGreaterThan(0);
    expect(projectionCalls).toBeGreaterThan(0);
    expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
    expect(events.indexOf("browser.publish")).toBeLessThan(events.indexOf("receipt.accepted"));
    expect(events.indexOf("receipt.accepted")).toBeLessThan(events.indexOf("share.projection"));
  } finally {
    if (originalRefresh) mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(originalRefresh);
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});


test("AI-allowed meal deletion checks the unimported conversation before mutating", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-action-order-"));
  const events: string[] = [];
  const mealsAtConversationPrefetch: number[] = [];
  try {
    await initializeVault({ createdAt: TEST_NOW, timezone: "UTC", vaultRoot });
    await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
    const meal = await addMeal({ vaultRoot, occurredAt: TEST_NOW, note: "Synthetic meal", nutrition: { totals: { calories: 500 } } });
    const wake = buildHostedExecutionMemberActionRequestedWake({
      eventId: "member.action.requested:meal", memberId: TEST_USER_ID, occurredAt: TEST_NOW,
      request: { actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243", schemaVersion: 1, requestedAt: TEST_NOW,
        action: { kind: "meal.delete", version: 1, mealId: meal.mealId } },
    });
    const item = createMailboxItem({ id: "pending_delete", kind: wake.kind, lane: "system", laneSeq: "1", dedupeKey: wake.eventId });
    const route = createHostedMailboxRoutingPlan(item);
    if (route.state !== "route") throw new Error("Invalid synthetic route");
    await enqueueHostedSystemMailboxItem({ item: { ...createResolvedRuntimeControlSystemMailboxItem(item), route }, vaultRoot, wake });
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "1";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const mailboxPort = createMailboxPort({ events, items: [createMailboxItem({ id: "unimported_conversation", lane: "conversation", laneSeq: "1" })] });
    // Stop at the prefetch boundary: the pending conversation is available, but
    // no foreground model or subsequent action processing is needed for this proof.
    const prefetchBoundary = new Error("Synthetic conversation prefetch boundary");
    await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: {
      processingMode: "system_mailbox", runnerIdleTtlMs: 1,
    } }), {
      vaultRoot,
      async importItem() { throw new Error("No import before the prefetch boundary"); },
      async createCheckpointSnapshot() { return { snapshotRef: (await createVaultSnapshotBundle({ vaultRoot })).snapshotRef }; },
      platform: createPlatform({
        artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]),
        workspacePort: createWorkspacePort({ events, checkpointRequests: [], workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef }) }),
        mailboxPort: { ...mailboxPort,
          async fetch(request) {
            const response = await mailboxPort.fetch(request);
            if (request.lanes.some(({ lane }) => lane === "conversation")) {
              expect(response.items.some(({ id }) => id === "unimported_conversation")).toBe(true);
              mealsAtConversationPrefetch.push((await readMealNutritionTotals(vaultRoot)).mealCount);
              throw prefetchBoundary;
            }
            return response;
          },
          recordMemberActionOutcome: async () => {},
        },
      }),
    }).catch((error: unknown) => { if (error !== prefetchBoundary) throw error; });
    expect(mealsAtConversationPrefetch).toEqual([1]);
    expect(await readMealNutritionTotals(vaultRoot)).toMatchObject({ mealCount: 1 });
  } finally {
    await removeTempRoot(vaultRoot);
  }
});
