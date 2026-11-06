import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { initializeVault, addMeal, upsertEvent, readEvent } from "@murphai/core";
import { buildHostedExecutionMemberActionRequestedWake } from "@murphai/hosted-execution";
import { enqueueHostedSystemMailboxItem, prepareHostedSystemMailboxItemForCheckpoint, recordHostedSystemMailboxItemAfterCheckpoint, type HostedSystemMailboxRuntime } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState, recoverHostedSystemMailboxClaims, updateHostedSystemMailboxState, resolveHostedSystemMailboxProgress } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createHostedRuntimeResolvedConfig, createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

it.each(["pending", "sending", "recording"] as const)("drains a restored %s legacy repair without changing meals or billing usage", async status => {
  const workspace = await createHostedRuntimeWorkspace("meal-repair-mailbox-");
  const now = new Date().toISOString();
  const memberId = "synthetic-member";
  const actionId = "2c77048c-61ba-56c4-8d47-e1f0ca065139";
  const wake = buildHostedExecutionMemberActionRequestedWake({ eventId: `member.action.requested:${actionId}`, memberId, occurredAt: now,
    request: { actionId, requestedAt: now, schemaVersion: 1, action: { kind: "meal.names.repair", version: 1, batch: 0 } } });
  const recordMemberActionOutcome = vi.fn(async () => {});
  const recordUsage = vi.fn();
  const runtime: HostedSystemMailboxRuntime = {
    commitTimeoutMs: null, forwardedEnv: {}, platformEnv: {}, userEnv: {}, resolvedConfig: createHostedRuntimeResolvedConfig(),
    platform: { usageRecordPort: { recordUsage }, artifactStore: { async get() { return null; }, async put() {} },
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
    // Old repair progress can contain a pending write. It must stay unread.
    const progressRelativePath = ".runtime/operations/meal-name-repair/v1.json";
    await mkdir(path.dirname(path.join(workspace.vaultRoot, progressRelativePath)), { recursive: true });
    const progressBytes = "retired progress is opaque to the current runtime";
    await writeFile(path.join(workspace.vaultRoot, progressRelativePath), progressBytes);
    const legacyOutcome = {
      actionId, completedAt: now, schemaVersion: 1 as const, status: "applied" as const, reason: null,
      result: { kind: "meal.names.repair" as const, version: 1 as const, batch: 0,
        done: true, scanned: 2, renamed: 0, skipped: 2, invalid: 2, changed: 0 },
    };
    await updateHostedSystemMailboxState(workspace.vaultRoot, state => ({
      pending: state.pending.map(item => ({ ...item, status,
        postCheckpointRecord: status === "recording"
          ? { kind: "member-action.outcome-recorded" as const, outcome: legacyOutcome } : null,
      })),
    }));
    const state = await readHostedSystemMailboxState(workspace.vaultRoot);
    expect(state.pending).toHaveLength(1);
    expect(resolveHostedSystemMailboxProgress({ importedSeq: "1", state }).handledThroughSeq).toBe("0");
    const restored = path.join(workspace.workspaceRoot, "restored");
    await cp(workspace.vaultRoot, restored, { recursive: true });
    await recoverHostedSystemMailboxClaims(restored);
    const finished = await prepareHostedSystemMailboxItemForCheckpoint({ runtime, runtimeEnv: {}, vaultRoot: restored,
      now: () => now });
    expect(finished?.status).toBe(status === "recording" ? "recording" : "processed");
    if (finished?.status !== "processed" && finished?.status !== "recording") throw new Error("Expected drained legacy request");
    if (finished.status === "processed") {
      expect(finished.metrics.postCheckpointRecord).toMatchObject({ kind: "member-action.outcome-recorded", outcome: { status: "unchanged", reason: null } });
    } else {
      expect(finished.item.postCheckpointRecord).toEqual({ kind: "member-action.outcome-recorded", outcome: legacyOutcome });
    }
    expect(await recordHostedSystemMailboxItemAfterCheckpoint({ runtime, vaultRoot: restored, item: finished.item })).toMatchObject({ recorded: 1, failed: 0 });
    expect(recordMemberActionOutcome).toHaveBeenCalledTimes(1);
    expect(recordUsage).not.toHaveBeenCalled();
    expect(await readFile(path.join(restored, progressRelativePath), "utf8")).toBe(progressBytes);
    for (const eventId of eventIds) expect((await readEvent({ vaultRoot: restored, eventId })).event.title).toBe("Estimated bean plate");
    const drained = await readHostedSystemMailboxState(restored);
    expect(drained.pending).toHaveLength(0);
    expect(resolveHostedSystemMailboxProgress({ importedSeq: "1", state: drained }).handledThroughSeq).toBe("1");
  } finally { vi.resetAllMocks(); await workspace.cleanup(); }
});
