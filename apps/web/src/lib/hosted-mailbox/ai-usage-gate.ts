export const HOSTED_MAILBOX_SYSTEM_AI_USAGE_GATED_KINDS = [
  "runtime.manual-requested",
] as const;

export interface HostedMailboxAiUsageGateLaneCursor {
  importedSeq: bigint | number | string;
  lane: string;
}

export interface HostedMailboxAiUsageGateConsumedSeq {
  consumedSeq: bigint | number | string;
  lane: string;
}

export interface HostedMailboxAiUsageGateItem {
  kind: string;
  lane: string;
  laneSeq: bigint | number | string;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
}

export function hostedMailboxSystemItemKindNeedsAiUsageGate(kind: string): boolean {
  return HOSTED_MAILBOX_SYSTEM_AI_USAGE_GATED_KINDS.some((gatedKind) =>
    gatedKind === kind
  );
}

export function hostedMailboxItemsRequireAiUsageAccess(input: {
  consumedSeqByLane: readonly HostedMailboxAiUsageGateConsumedSeq[];
  items: readonly HostedMailboxAiUsageGateItem[];
  lanes: readonly HostedMailboxAiUsageGateLaneCursor[];
}): boolean {
  const consumedSeqByLane = resolveHostedMailboxAiUsageGateSeqByLane({
    entries: input.consumedSeqByLane,
    seqKey: "consumedSeq",
  });
  const importedSeqByLane = resolveHostedMailboxAiUsageGateSeqByLane({
    entries: input.lanes,
    seqKey: "importedSeq",
  });

  return input.items.some((item) => {
    if (item.lane === "system") {
      return hostedMailboxSystemItemKindNeedsAiUsageGate(item.kind);
    }

    if (item.lane !== "conversation") {
      return false;
    }

    const itemSeq = parseHostedMailboxAiUsageGateSeqOrNull(item.laneSeq);
    if (itemSeq === null) {
      return true;
    }
    if (!hostedMailboxConversationItemHasPayloadHandle(item)) {
      return false;
    }

    const importedSeq = importedSeqByLane.get("conversation") ?? 0n;
    const consumedSeq = consumedSeqByLane.get("conversation") ?? 0n;
    const replayFloor = importedSeq > consumedSeq ? importedSeq : consumedSeq;

    return itemSeq > replayFloor;
  });
}

function hostedMailboxConversationItemHasPayloadHandle(
  item: HostedMailboxAiUsageGateItem,
): boolean {
  return hasNonEmptyString(item.payloadInlineCiphertext)
    || hasNonEmptyString(item.payloadRef);
}

function resolveHostedMailboxAiUsageGateSeqByLane<
  T extends { lane: string },
>(input: {
  entries: readonly T[];
  seqKey: keyof T;
}): Map<string, bigint> {
  const result = new Map<string, bigint>();

  for (const entry of input.entries) {
    const value = entry[input.seqKey];
    const seq = parseHostedMailboxAiUsageGateSeqOrNull(value);
    if (seq === null) {
      continue;
    }
    const current = result.get(entry.lane);
    if (current === undefined || seq > current) {
      result.set(entry.lane, seq);
    }
  }

  return result;
}

function parseHostedMailboxAiUsageGateSeqOrNull(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return BigInt(value);
  }

  return null;
}

function hasNonEmptyString(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
