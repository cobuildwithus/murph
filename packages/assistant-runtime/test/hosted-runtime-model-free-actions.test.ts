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
import { buildHostedExecutionMemberActionRequestedWake, buildHostedExecutionMemberPreferencesUpdatedWake } from "@murphai/hosted-execution";
import { buildHostedExecutionClinicalRecordsSyncRequestedWake, type HostedClinicalRecordsRunDescriptor } from "@murphai/hosted-execution/clinical-records";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { readNextClinicalEnrichment } from "@murphai/vault-usecases/clinical-enrichment";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { createHostedMailboxRoutingPlan } from "../src/hosted-runtime/mailbox-routing.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  TEST_NOW, TEST_USER_ID, createMailboxItem, createMailboxPort, createPlatform,
  createResolvedRuntimeControlSystemMailboxItem, createVaultSnapshotBundle, createWorkspacePort,
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
    expect(recordMemberActionOutcome).toHaveBeenCalledTimes(retryReceipt ? 3 : 2);
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
