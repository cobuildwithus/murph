import {
  isHostedPlainDeviceSyncWakeHint,
  isHostedPlainDeviceSyncWakeHintReason,
  systemMailboxItemIsDue,
  type HostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "./system-mailbox-state.ts";

const DIAGNOSTIC_KEYS = [
  "headDue", "headDeviceSync", "headAttempted", "headRecording",
  "headPlainHint", "headHasEpoch", "headManualHint", "headWebhookHint",
  "ownerPresent", "ownerDue", "ownerEpochMatches", "headCadenceMissing",
  "ownerCadenceMissing", "headCadenceCovered", "headCadenceEqual", "headCadenceFuture",
  "headHasJobs", "headScopesPresent", "headRevokeWarningPresent",
  "headHintReasonSupported", "headRecordPresent",
] as const;
const DIAGNOSTIC_VALUES = new Set(DIAGNOSTIC_KEYS.flatMap((key) =>
  [`${key}=true`, `${key}=false`]
));

// Keep the existing wire format: at most 16 fixed scalar strings, never payloads.
export function readHostedSystemMailboxFirstPendingDiagnostics(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const diagnostics = value.filter((entry): entry is string =>
    typeof entry === "string" && DIAGNOSTIC_VALUES.has(entry)
  );
  return diagnostics.length > 0 ? diagnostics : null;
}

function formatDiagnostics(diagnostics: Record<string, boolean>): string[] {
  return DIAGNOSTIC_KEYS.flatMap((key) => Object.hasOwn(diagnostics, key)
    ? [`${key}=${diagnostics[key]}`] : []);
}

export function resolveHostedSystemMailboxFirstPendingDiagnostics(input: {
  continuationSeqs: readonly string[];
  firstPendingSeq: string | null;
  now: string;
  state: HostedSystemMailboxState;
}): string[] | null {
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
  if (wake.kind !== "device-sync.wake") return formatDiagnostics(diagnostics);
  const owner = input.state.pending.find((item) =>
    item.mailboxLaneSeq !== null && input.continuationSeqs.includes(item.mailboxLaneSeq)
    && item.wake.kind === "device-sync.wake" && Boolean(wake.connectionId)
    && item.wake.connectionId === wake.connectionId
  );
  const ownerWake = owner?.wake.kind === "device-sync.wake" ? owner.wake : null;
  const headCadence = Date.parse(wake.hint?.nextReconcileAt ?? "");
  const ownerCadence = Date.parse(ownerWake?.hint?.nextReconcileAt ?? "");
  return formatDiagnostics({
    ...diagnostics,
    ...describeDeviceHint(head),
    ownerPresent: owner !== undefined,
    ownerDue: owner !== undefined && systemMailboxItemIsDue(owner, input.now),
    ownerEpochMatches: Boolean(wake.expectedConnectedAt)
      && ownerWake?.expectedConnectedAt === wake.expectedConnectedAt,
    ...(wake.reason === "reconcile_due" ? {
      headCadenceMissing: !Number.isFinite(headCadence),
      ownerCadenceMissing: !Number.isFinite(ownerCadence),
      headCadenceCovered: headCadence < ownerCadence,
      headCadenceEqual: headCadence === ownerCadence,
      headCadenceFuture: headCadence > Date.parse(input.now),
    } : describeNonScheduledHint(head)),
  });
}

function describeNonScheduledHint(head: HostedSystemMailboxPendingItem): Record<string, boolean> {
  const wake = head.wake;
  if (wake.kind !== "device-sync.wake") return {};
  return {
    headHasJobs: (wake.hint?.jobs?.length ?? 0) > 0,
    headScopesPresent: wake.hint?.scopes !== undefined,
    headRevokeWarningPresent: wake.hint?.revokeWarning != null,
    headHintReasonSupported: isHostedPlainDeviceSyncWakeHintReason(wake.hint?.reason),
    headRecordPresent: head.postCheckpointRecord !== null,
  };
}

function describeDeviceHint(head: HostedSystemMailboxPendingItem): Record<string, boolean> {
  const wake = head.wake;
  if (wake.kind !== "device-sync.wake") return {};
  return {
    headPlainHint: isHostedPlainDeviceSyncWakeHint(head),
    headHasEpoch: Boolean(wake.expectedConnectedAt),
    headManualHint: wake.hint?.reason === "manual_reconcile",
    headWebhookHint: wake.reason === "webhook_hint",
  };
}
