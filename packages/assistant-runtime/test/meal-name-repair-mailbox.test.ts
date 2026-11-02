import { cp } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { initializeVault, addMeal, upsertEvent, readEvent } from "@murphai/core";
import { buildHostedExecutionMemberActionRequestedWake } from "@murphai/hosted-execution";
import { proposeLegacyMealName } from "@murphai/assistant-engine/assistant-ask";
import { enqueueHostedSystemMailboxItem, prepareHostedSystemMailboxItemForCheckpoint, recordHostedSystemMailboxItemAfterCheckpoint, type HostedSystemMailboxRuntime } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState, resolveHostedSystemMailboxProgress } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createHostedRuntimeResolvedConfig, createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";
vi.mock("@murphai/assistant-engine/assistant-ask", async original => ({
  ...await original<typeof import("@murphai/assistant-engine/assistant-ask")>(), proposeLegacyMealName: vi.fn(),
}));

it("retains foreground-interrupted repair across checkpoint restart and records one completion", async () => {
  const workspace = await createHostedRuntimeWorkspace("meal-repair-mailbox-");
  const now = new Date().toISOString();
  const memberId = "synthetic-member";
  const actionId = "2c77048c-61ba-56c4-8d47-e1f0ca065139";
  const wake = buildHostedExecutionMemberActionRequestedWake({ eventId: `member.action.requested:${actionId}`, memberId, occurredAt: now,
    request: { actionId, requestedAt: now, schemaVersion: 1, action: { kind: "meal.names.repair", version: 1, batch: 0 } } });
  const recordMemberActionOutcome = vi.fn(async () => {});
  const runtime: HostedSystemMailboxRuntime = {
    commitTimeoutMs: null, forwardedEnv: {}, platformEnv: {}, userEnv: {}, resolvedConfig: createHostedRuntimeResolvedConfig(),
    platform: { artifactStore: { async get() { return null; }, async put() {} },
      effectsPort: { async readRawEmailMessage() { return null; }, async sendEmail() { throw new Error("No messages"); } },
      mailboxPort: { recordMemberActionOutcome, async fetch() { throw new Error("No mailbox fetch needed"); }, async fetchPayload() { throw new Error("No payload fetch needed"); } } },
  };
  try {
    await initializeVault({ vaultRoot: workspace.vaultRoot, timezone: "UTC" });
    const eventIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const meal = await addMeal({ vaultRoot: workspace.vaultRoot, name: "Bean plate", note: "One plate" });
      await upsertEvent({ vaultRoot: workspace.vaultRoot, allowSpecializedKindRewrite: true, payload: { ...meal.event, title: "Estimated bean plate" } });
      eventIds.push(meal.event.id);
    }
    await enqueueHostedSystemMailboxItem({ vaultRoot: workspace.vaultRoot, wake, item: {
      item: { createdAt: now, updatedAt: now, dedupeKey: wake.eventId, expiresAt: null, id: "synthetic-mailbox-item", kind: wake.kind,
        lane: "system", laneSeq: "1", occurredAt: now, payloadBytes: 64, payloadInlineCiphertext: "synthetic", payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1", userId: memberId },
      payload: { payloadCiphertext: "synthetic", payloadSchema: "murph.hosted-mailbox-payload.v1", requestId: actionId, source: "inline", status: "resolved" },
      route: { action: "apply-member-action", advanceProgress: true, itemRef: { id: "synthetic-mailbox-item", kind: wake.kind, lane: "system", laneSeq: "1" }, state: "route" },
    } });
    let foreground = false;
    vi.mocked(proposeLegacyMealName).mockResolvedValueOnce("Bean plate").mockImplementationOnce(input => {
      foreground = true;
      return new Promise((_resolve, reject) => input.abortSignal!.addEventListener("abort", () => reject(input.abortSignal!.reason), { once: true }));
    });
    const failed = await prepareHostedSystemMailboxItemForCheckpoint({ runtime, runtimeEnv: {}, vaultRoot: workspace.vaultRoot,
      now: () => now, shouldYieldBackgroundMaintenance: () => foreground });
    expect(failed?.status).toBe("retryable_failed");
    const state = await readHostedSystemMailboxState(workspace.vaultRoot);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({ status: "pending", attemptCount: 1 });
    expect(state.pending[0]!.nextAttemptAt).not.toBeNull();
    expect(resolveHostedSystemMailboxProgress({ importedSeq: "1", state }).handledThroughSeq).toBe("0");
    expect(recordMemberActionOutcome).not.toHaveBeenCalled();
    const restored = path.join(workspace.workspaceRoot, "restored");
    await cp(workspace.vaultRoot, restored, { recursive: true });
    foreground = false;
    vi.mocked(proposeLegacyMealName).mockResolvedValue("Bean plate");
    const finished = await prepareHostedSystemMailboxItemForCheckpoint({ runtime, runtimeEnv: {}, vaultRoot: restored,
      now: () => state.pending[0]!.nextAttemptAt!, shouldYieldBackgroundMaintenance: () => foreground });
    expect(finished?.status).toBe("processed");
    if (finished?.status !== "processed") throw new Error("Expected completed repair");
    expect(finished.metrics.postCheckpointRecord).toMatchObject({ kind: "member-action.outcome-recorded", outcome: { result: { scanned: 2, renamed: 2, skipped: 0, done: true } } });
    expect(await recordHostedSystemMailboxItemAfterCheckpoint({ runtime, vaultRoot: restored, item: finished.item })).toMatchObject({ recorded: 1, failed: 0 });
    expect(recordMemberActionOutcome).toHaveBeenCalledTimes(1);
    expect(vi.mocked(proposeLegacyMealName)).toHaveBeenCalledTimes(3);
    for (const eventId of eventIds) expect((await readEvent({ vaultRoot: restored, eventId })).event.title).toBe("Bean plate");
    expect((await readHostedSystemMailboxState(restored)).pending).toHaveLength(0);
  } finally { vi.resetAllMocks(); await workspace.cleanup(); }
});
