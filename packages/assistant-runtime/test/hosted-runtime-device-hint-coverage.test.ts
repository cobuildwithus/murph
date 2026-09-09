import { buildHostedExecutionDeviceSyncWake } from "@murphai/hosted-execution";
import { describe, expect, it } from "vitest";

import {
  projectHostedDeviceHintCoverage,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";

const NOW = "2026-04-27T12:00:00.000Z";
const LATER = "2026-04-28T12:00:00.000Z";

function hint(id: string, seq: string, connectionId = "synthetic_connection") {
  const wake = buildHostedExecutionDeviceSyncWake({
    connectionId, eventId: `device-sync.wake:${id}`, expectedConnectedAt: NOW,
    occurredAt: NOW, provider: "junction", reason: "webhook_hint",
    userId: "synthetic_member", hint: { reason: "companion_health_metadata" },
  });
  return {
    attemptCount: 0, itemId: id, lastAttemptAt: null, lastErrorCode: null,
    lastErrorMessage: null, mailboxDedupeKey: wake.eventId, mailboxLaneSeq: seq,
    nextAttemptAt: null, occurredAt: NOW, postCheckpointRecord: null,
    requestId: null, routeAction: "run-device-sync-wake", status: "pending", wake,
  } satisfies HostedSystemMailboxPendingItem;
}

function owner(id = "owner", seq = "1", connectionId?: string): HostedSystemMailboxPendingItem {
  const item = hint(id, seq, connectionId);
  return { ...item, deviceSyncContinuationOwner: true, attemptCount: 2,
    nextAttemptAt: LATER, wake: { ...item.wake, reason: "reconcile_due",
      hint: { nextReconcileAt: LATER, jobs: [{
        kind: "resource", dedupeKey: "synthetic_retained_job", availableAt: LATER,
      }] } } };
}

function schedule(id: string, seq: string, connectionId?: string) {
  const item = hint(id, seq, connectionId);
  return { ...item, wake: { ...item.wake, reason: "reconcile_due" as const,
    hint: { nextReconcileAt: NOW } } };
}

function covered(pending: readonly HostedSystemMailboxPendingItem[]) {
  return [...projectHostedDeviceHintCoverage({ now: NOW, pending })].map(([id, value]) => ({
    id, hints: [...value.coveredHintIds], schedules: [...value.coveredScheduleIds],
  }));
}

describe("retained device hint coverage", () => {
  it.each([undefined, "webhook_dirty_transition", "companion_health_metadata", "companion_hrv_rmssd"])(
    "covers the canonical dirty reason %s through the existing owner", (reason) => {
      const dirty = hint("dirty", "2");
      dirty.wake.hint = reason === undefined ? {} : { reason };
      expect(covered([owner(), dirty]))
        .toEqual([{ id: "owner", hints: ["dirty"], schedules: [] }]);
    },
  );

  it("keeps independent connections and execution versus idle coverage distinct", () => {
    expect(covered([
      hint("before-owner", "1"), owner("a", "2", "connection_a"),
      owner("b", "3", "connection_b"), schedule("a-schedule", "4", "connection_a"),
      hint("a-dirty", "5", "connection_a"), schedule("b-schedule", "6", "connection_b"),
      schedule("a-after-dirty", "7", "connection_a"), hint("b-dirty", "8", "connection_b"),
    ])).toEqual([
      { id: "a", hints: ["a-schedule", "a-dirty", "a-after-dirty"], schedules: ["a-schedule"] },
      { id: "b", hints: ["b-schedule", "b-dirty"], schedules: ["b-schedule"] },
    ]);
  });

  it.each([
    "epoch", "member", "provider", "equal-cadence", "newer-cadence", "missing-cadence",
    "lower-sequence", "equal-sequence", "missing-sequence", "attempted", "recording",
    "future", "jobs", "scopes", "unknown-reason", "connected",
  ])("keeps a %s barrier and its following suffix", (boundary) => {
    const candidate: HostedSystemMailboxPendingItem = schedule("barrier", "3");
    if (candidate.wake.kind !== "device-sync.wake") throw new Error("Invalid synthetic wake");
    if (boundary === "epoch") candidate.wake.expectedConnectedAt = LATER;
    if (boundary === "member") candidate.wake.userId = "another_synthetic_member";
    if (boundary === "provider") candidate.wake.provider = "oura";
    if (boundary === "equal-cadence") candidate.wake.hint = { nextReconcileAt: LATER };
    if (boundary === "newer-cadence") candidate.wake.hint = { nextReconcileAt: "2026-04-29T12:00:00.000Z" };
    if (boundary === "missing-cadence") candidate.wake.hint = {};
    if (boundary === "lower-sequence") candidate.mailboxLaneSeq = "0";
    if (boundary === "equal-sequence") candidate.mailboxLaneSeq = "1";
    if (boundary === "missing-sequence") candidate.mailboxLaneSeq = null;
    if (boundary === "attempted") candidate.attemptCount = 1;
    if (boundary === "recording") candidate.status = "recording";
    if (boundary === "future") candidate.wake.occurredAt = LATER;
    if (boundary === "jobs") candidate.wake.hint = { jobs: [{ kind: "resource", dedupeKey: "synthetic_new_job" }] };
    if (boundary === "scopes") candidate.wake.hint = { scopes: [] };
    if (boundary === "unknown-reason") candidate.wake.hint = { reason: "synthetic_unknown" };
    if (boundary === "connected") candidate.wake.reason = "connected";
    expect(covered([owner(), schedule("before", "2"), candidate, hint("after", "4")]))
      .toEqual([{ id: "owner", hints: ["before"], schedules: ["before"] }]);
  });

  it.each(["unmarked", "recording", "unbound", "missing-sequence", "dedupe"])(
    "does not derive coverage from an %s owner", (boundary) => {
      const retained = owner();
      if (boundary === "unmarked") delete retained.deviceSyncContinuationOwner;
      if (boundary === "recording") retained.status = "recording";
      if (boundary === "unbound" && retained.wake.kind === "device-sync.wake") delete retained.wake.expectedConnectedAt;
      if (boundary === "missing-sequence") retained.mailboxLaneSeq = null;
      if (boundary === "dedupe") retained.mailboxDedupeKey = "synthetic_mismatch";
      expect(covered([retained, hint("after", "2")])).toEqual([]);
    },
  );

  it("ends the prior owner's coverage at another owner on the same connection", () => {
    expect(covered([owner(), schedule("first", "2"), owner("second", "3"), schedule("last", "4")]))
      .toEqual([
        { id: "owner", hints: ["first"], schedules: ["first"] },
        { id: "second", hints: ["last"], schedules: ["last"] },
      ]);
  });

  it("preserves exact owner jobs and retry times while covering deferred dirty hints", () => {
    const deferred: HostedSystemMailboxPendingItem = { ...hint("dirty", "2"), nextAttemptAt: LATER };
    const retained = owner();
    const retainedWake = retained.wake;
    const pending = [retained, deferred];
    const before = structuredClone(pending);
    const first = covered(pending);
    expect(first).toEqual([{ id: "owner", hints: ["dirty"], schedules: [] }]);
    expect(covered(pending)).toEqual(first);
    expect(pending).toEqual(before);
    expect(pending[0]?.wake).toBe(retainedWake);
  });
});
