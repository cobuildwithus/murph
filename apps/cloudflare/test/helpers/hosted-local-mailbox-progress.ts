export function hasImportedHostedSystemWakeStorm(input: {
  expectedImportedSeq: string;
  redactedStatus: Record<string, unknown> | null | undefined;
  systemLane: { importedSeq: unknown } | undefined;
}): boolean {
  return hostedOrderingSeqAtLeast(input.systemLane?.importedSeq, input.expectedImportedSeq)
    && hostedOrderingSeqAtLeast(input.redactedStatus?.hostedMailboxSystemImportedSeq, input.expectedImportedSeq)
    && input.redactedStatus?.hostedMailboxRetryableBlockedCount === 0;
}

export function hostedOrderingSeqAtLeast(
  value: unknown,
  floor: string,
): boolean {
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || !/^(?:0|[1-9][0-9]*)$/u.test(floor)
  ) {
    return false;
  }
  return BigInt(value) >= BigInt(floor);
}

export interface HostedSystemContinuationLog {
  at: string;
  attemptId: string | null;
  eventCode: string;
  redactedJson: Record<string, unknown> | null;
}

// The caller queries these logs for the same user as the seeded mailbox.
export function hasSuccessfulHostedSystemContinuation(input: {
  expectedWakeKinds: readonly string[];
  logs: readonly HostedSystemContinuationLog[];
  providerStartedAt: Date;
}): boolean {
  return input.logs.some((entry) => {
    const wakeKind = entry.redactedJson?.wakeKind;
    return entry.eventCode === "mailbox.system_processed"
      && typeof entry.attemptId === "string"
      && entry.attemptId.length > 0
      && Date.parse(entry.at) >= input.providerStartedAt.getTime()
      && typeof wakeKind === "string"
      && input.expectedWakeKinds.includes(wakeKind)
      && (entry.redactedJson?.status === "processed" || entry.redactedJson?.status === "recorded")
      && (entry.redactedJson?.recordFailed ?? 0) === 0;
  });
}
