import {
  isHostedPlainDeviceSyncWakeHint,
  systemMailboxItemIsDue,
  type HostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "./system-mailbox-state.ts";

const DIAGNOSTIC_KEYS = [
  "headDue", "headDeviceSync", "headAttempted", "headRecording",
  "headPlainHint", "headHasEpoch", "headHasJobs", "headHasScopes",
  "headManualHint", "headWebhookHint", "headReconcileDue", "headWakeMatchesDedupe",
  "ownerPresent", "ownerDue", "ownerHasEpoch", "ownerEpochMatches",
  "ownerProviderMatches", "ownerMemberMatches", "headCadenceMissing",
  "ownerCadenceMissing", "headCadenceCovered", "headCadenceEqual", "headCadenceFuture",
] as const;

// Only fixed keys and booleans may cross into progress status and logs.
export function readHostedSystemMailboxFirstPendingDiagnostics(
  value: unknown,
): Record<string, boolean>[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const entry: unknown = value[0];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const diagnostics: Record<string, boolean> = {};
  for (const key of DIAGNOSTIC_KEYS) {
    const field = record[key];
    if (typeof field === "boolean") diagnostics[key] = field;
  }
  return Object.keys(diagnostics).length > 0 ? [diagnostics] : null;
}

export function resolveHostedSystemMailboxFirstPendingDiagnostics(input: {
  continuationSeqs: readonly string[];
  firstPendingSeq: string | null;
  now: string;
  state: HostedSystemMailboxState;
}): Record<string, boolean>[] | null {
  if (input.firstPendingSeq === null) return null;
  const head = input.state.pending.find((item) => item.mailboxLaneSeq === input.firstPendingSeq);
  if (!head) return null;
  const diagnostics = {
    headDue: systemMailboxItemIsDue(head, input.now),
    headDeviceSync: head.wake.kind === "device-sync.wake",
    headAttempted: head.attemptCount > 0,
    headRecording: head.status === "recording",
  };
  const wake = head.wake;
  if (wake.kind !== "device-sync.wake") return [diagnostics];
  const owner = input.state.pending.find((item) =>
    item.mailboxLaneSeq !== null && input.continuationSeqs.includes(item.mailboxLaneSeq)
    && item.wake.kind === "device-sync.wake" && Boolean(wake.connectionId)
    && item.wake.connectionId === wake.connectionId
  );
  const ownerWake = owner?.wake.kind === "device-sync.wake" ? owner.wake : null;
  const headCadence = Date.parse(wake.hint?.nextReconcileAt ?? "");
  const ownerCadence = Date.parse(ownerWake?.hint?.nextReconcileAt ?? "");
  return [{
    ...diagnostics,
    ...describeDeviceHint(head),
    ownerPresent: owner !== undefined,
    ownerDue: owner !== undefined && systemMailboxItemIsDue(owner, input.now),
    ownerHasEpoch: Boolean(ownerWake?.expectedConnectedAt),
    ownerEpochMatches: Boolean(wake.expectedConnectedAt)
      && ownerWake?.expectedConnectedAt === wake.expectedConnectedAt,
    ownerProviderMatches: ownerWake?.provider === wake.provider,
    ownerMemberMatches: ownerWake?.userId === wake.userId,
    headCadenceMissing: !Number.isFinite(headCadence),
    ownerCadenceMissing: !Number.isFinite(ownerCadence),
    headCadenceCovered: headCadence < ownerCadence,
    headCadenceEqual: headCadence === ownerCadence,
    headCadenceFuture: headCadence > Date.parse(input.now),
  }];
}

function describeDeviceHint(head: HostedSystemMailboxPendingItem): Record<string, boolean> {
  const wake = head.wake;
  if (wake.kind !== "device-sync.wake") return {};
  return {
    headPlainHint: isHostedPlainDeviceSyncWakeHint(head),
    headHasEpoch: Boolean(wake.expectedConnectedAt),
    headHasJobs: (wake.hint?.jobs?.length ?? 0) > 0,
    headHasScopes: wake.hint?.scopes !== undefined,
    headManualHint: wake.hint?.reason === "manual_reconcile",
    headWebhookHint: wake.reason === "webhook_hint",
    headReconcileDue: wake.reason === "reconcile_due",
    headWakeMatchesDedupe: head.mailboxDedupeKey === wake.eventId,
  };
}
