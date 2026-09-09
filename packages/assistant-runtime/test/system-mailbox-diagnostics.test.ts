import { describe, expect, it } from "vitest";
import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceInvocationResult,
  parseHostedRuntimeLogRequest,
} from "@murphai/hosted-execution/parsers";
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
      const expected = {
        headDue: true, headDeviceSync: true, ownerDue: false,
        ownerPresent: condition !== "unvalidated-owner",
        headPlainHint: condition !== "manual",
        headHasEpoch: condition !== "missing-epoch",
        headManualHint: condition === "manual",
        headCadenceEqual: condition === "equal" || condition === "future",
        headCadenceCovered: condition === "covered" || condition === "missing-epoch",
        headCadenceFuture: condition === "future",
      };
      expect(result).toEqual(expect.arrayContaining(Object.entries(expected).map(
        ([key, value]) => `${key}=${value}`,
      )));
      expect(JSON.stringify(result)).not.toContain("synthetic_");
      expect(result?.length).toBeLessThanOrEqual(16);
      expect(readHostedSystemMailboxFirstPendingDiagnostics(result)).toEqual(result);
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it.each(["plain", "jobs", "scopes", "revoke", "reason", "record"])(
    "identifies non-scheduled hint shape without exposing values (%s)", (condition) => {
      const head = device("2");
      if (head.wake.kind !== "device-sync.wake") throw new Error("Invalid synthetic fixture");
      head.wake.reason = "webhook_hint";
      head.wake.hint = { reason: "webhook_dirty_transition" };
      if (condition === "jobs") head.wake.hint.jobs = [{ kind: "synthetic-private-job" }];
      if (condition === "scopes") head.wake.hint.scopes = [];
      if (condition === "revoke") head.wake.hint.revokeWarning = {
        code: "synthetic-private-code", message: "synthetic-private-message",
      };
      if (condition === "reason") head.wake.hint.reason = "synthetic-private-reason";
      if (condition === "record") head.postCheckpointRecord = {
        kind: "device-sync.dirty-processed", connectionId: "synthetic_connection", processedRevision: "1",
      };
      const state = { pending: [head] };
      const before = JSON.stringify(state);
      const result = resolveHostedSystemMailboxFirstPendingDiagnostics({
        continuationSeqs: [], firstPendingSeq: "2", now: NOW, state,
      });
      expect(result).toEqual(expect.arrayContaining([
        `headPlainHint=${condition === "plain"}`,
        `headHasJobs=${condition === "jobs"}`,
        `headScopesPresent=${condition === "scopes"}`,
        `headRevokeWarningPresent=${condition === "revoke"}`,
        `headHintReasonSupported=${condition !== "reason"}`,
        `headRecordPresent=${condition === "record"}`,
      ]));
      expect(result).toHaveLength(16);
      expect(result?.some((entry) => entry.startsWith("headCadence"))).toBe(false);
      expect(readHostedSystemMailboxFirstPendingDiagnostics(result)).toEqual(result);
      expect(JSON.stringify(result)).not.toContain("synthetic");
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it.each(["device", "webhook", "non-device", "empty"])("passes the production wire parsers (%s)", (kind) => {
    const head = device("2");
    if (kind === "webhook" && head.wake.kind === "device-sync.wake") {
      head.wake.reason = "webhook_hint";
      head.wake.hint = { scopes: [], reason: "synthetic-private-reason" };
    }
    if (kind === "non-device") {
      head.routeAction = "apply-runtime-control-request";
      head.wake = { kind: "runtime.maintenance-requested", eventId: "synthetic_maintenance",
        occurredAt: NOW, userId: "synthetic_member" };
    }
    const redactedStatus = {
      hostedMailboxSystemFirstPendingDiagnostics: resolveHostedSystemMailboxFirstPendingDiagnostics({
        continuationSeqs: [], firstPendingSeq: kind === "empty" ? null : "2",
        now: NOW, state: { pending: kind === "empty" ? [] : [head] },
      }),
    };
    expect(parseHostedWorkspaceCheckpointRequest({
      attemptId: "synthetic_diagnostics", expectedWorkspaceVersion: "1",
      leaseGeneration: "1", reason: "import", snapshotRef: null, redactedStatus,
    }).redactedStatus).toEqual(redactedStatus);
    expect(parseHostedWorkspaceInvocationResult({
      status: "scheduled", nextWakeAt: LATER, nextWakeReason: "device-sync.reconcile", redactedStatus,
    }).redactedStatus).toEqual(redactedStatus);
    expect(parseHostedRuntimeLogRequest({ entries: [{
      at: NOW, component: "runtime", eventCode: "runtime.invocation_finished",
      level: "info", phase: "invoke", redactedJson: redactedStatus,
    }] }).entries[0]?.redactedJson).toEqual(redactedStatus);
  });

  it("does not invent a blocker after the mailbox has drained", () => {
    expect(resolveHostedSystemMailboxFirstPendingDiagnostics({
      continuationSeqs: [], firstPendingSeq: null, now: NOW, state: { pending: [] },
    })).toBeNull();
  });

  it("drops unknown or malformed values before logging restored status", () => {
    expect(readHostedSystemMailboxFirstPendingDiagnostics([
      "headDue=false", "ownerPresent=true", "headManualHint=synthetic-private-text",
      { userId: "synthetic-private-member" }, "synthetic-private-payload",
    ])).toEqual(["headDue=false", "ownerPresent=true"]);
    expect(readHostedSystemMailboxFirstPendingDiagnostics(["synthetic-private-text"])).toBeNull();
    expect(readHostedSystemMailboxFirstPendingDiagnostics({ unknown: true })).toBeNull();
    expect(readHostedSystemMailboxFirstPendingDiagnostics(Array(17).fill("headDue=true"))).toBeNull();
  });
});
