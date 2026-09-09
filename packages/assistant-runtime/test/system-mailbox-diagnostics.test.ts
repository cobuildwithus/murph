import { describe, expect, it } from "vitest";
import {
  readHostedSystemMailboxFirstPendingDiagnostics,
  resolveHostedSystemMailboxFirstPendingDiagnostics,
} from "../src/hosted-runtime/system-mailbox-diagnostics.ts";
import type { HostedSystemMailboxPendingItem } from "../src/hosted-runtime/system-mailbox-state.ts";

const NOW = "2036-04-01T00:00:00.000Z";
const LATER = "2036-04-02T00:00:00.000Z";

function device(seq: string): HostedSystemMailboxPendingItem {
  const eventId = `device-sync.wake:synthetic-diagnostic-${seq}`;
  return {
    itemId: `synthetic_diagnostic_${seq}`, mailboxLaneSeq: seq,
    mailboxDedupeKey: eventId, routeAction: "run-device-sync-wake",
    status: "pending", attemptCount: 0, lastAttemptAt: null,
    lastErrorCode: null, lastErrorMessage: null, nextAttemptAt: null,
    occurredAt: NOW, postCheckpointRecord: null, requestId: null,
    preferenceCausalSeq: null,
    wake: { kind: "device-sync.wake", eventId, occurredAt: NOW,
      connectionId: "synthetic_connection", expectedConnectedAt: NOW,
      provider: "junction", userId: "synthetic_member", reason: "reconcile_due",
      hint: { nextReconcileAt: NOW } },
  };
}

describe("mailbox blocker diagnostics", () => {
  it.each(["covered", "equal", "future", "missing-epoch", "manual", "unvalidated-owner"])(
    "distinguishes the pending device condition without exposing its data (%s)", (condition) => {
      const owner = device("1");
      const head = device("2");
      if (owner.wake.kind !== "device-sync.wake" || head.wake.kind !== "device-sync.wake") {
        throw new Error("Synthetic device fixture has the wrong wake kind");
      }
      owner.deviceSyncContinuationOwner = true;
      owner.nextAttemptAt = LATER;
      owner.wake.hint = { nextReconcileAt: LATER };
      if (condition === "equal") owner.wake.hint.nextReconcileAt = NOW;
      if (condition === "future") head.wake.hint = { nextReconcileAt: LATER };
      if (condition === "missing-epoch") delete head.wake.expectedConnectedAt;
      if (condition === "manual") head.wake.hint = { reason: "manual_reconcile" };
      const state = { pending: [owner, head] };
      const before = JSON.stringify(state);
      const result = resolveHostedSystemMailboxFirstPendingDiagnostics({
        firstPendingSeq: "2", now: NOW, state,
        continuationSeqs: condition === "unvalidated-owner" ? [] : ["1"],
      });
      expect(result?.[0]).toMatchObject({
        headDue: true, headDeviceSync: true, ownerDue: false,
        ownerPresent: condition !== "unvalidated-owner",
        headPlainHint: condition !== "manual",
        headHasEpoch: condition !== "missing-epoch",
        headManualHint: condition === "manual",
        headCadenceEqual: condition === "equal" || condition === "future",
        headCadenceCovered: condition === "covered" || condition === "missing-epoch",
        headCadenceFuture: condition === "future",
      });
      expect(JSON.stringify(result)).not.toContain("synthetic_");
      expect(Object.values(result?.[0] ?? {}).every((value) => typeof value === "boolean")).toBe(true);
      expect(readHostedSystemMailboxFirstPendingDiagnostics(result)).toEqual(result);
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it("does not invent a blocker after the mailbox has drained", () => {
    expect(resolveHostedSystemMailboxFirstPendingDiagnostics({
      continuationSeqs: [], firstPendingSeq: null, now: NOW, state: { pending: [] },
    })).toBeNull();
  });

  it("drops unknown fields and non-boolean values before logging restored status", () => {
    expect(readHostedSystemMailboxFirstPendingDiagnostics([{
      headDue: false, ownerPresent: true, headManualHint: "synthetic-private-text",
      userId: "synthetic-private-member", payload: { value: "synthetic-private-payload" },
    }])).toEqual([{ headDue: false, ownerPresent: true }]);
    expect(readHostedSystemMailboxFirstPendingDiagnostics(["synthetic-private-text"])).toBeNull();
    expect(readHostedSystemMailboxFirstPendingDiagnostics({ unknown: true })).toBeNull();
  });
});
