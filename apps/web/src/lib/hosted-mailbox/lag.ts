import type {
  HostedMailboxLane,
  HostedMailboxLaneHighWater,
  HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";

export function computeHostedMailboxLaneLag(input: {
  highWater: HostedMailboxLaneHighWater;
  redactedStatusJson: unknown;
}): HostedMailboxLaneLag {
  const redactedStatus = readHostedMailboxRedactedStatusRecord(input.redactedStatusJson);
  const importedSeq = readHostedMailboxImportedSeqForLane(
    redactedStatus,
    input.highWater.lane,
  );
  const maxSeq = readNonNegativeBigInt(input.highWater.maxSeq) ?? 0n;

  return {
    importedSeq: importedSeq.toString(),
    lag: (maxSeq > importedSeq ? maxSeq - importedSeq : 0n).toString(),
    lane: input.highWater.lane,
    maxSeq: maxSeq.toString(),
    ...(input.highWater.maxUpdatedAt === undefined
      ? {}
      : { maxUpdatedAt: input.highWater.maxUpdatedAt }),
  };
}

export function readHostedMailboxImportedSeqForLane(
  redactedStatus: Record<string, unknown> | null,
  lane: HostedMailboxLane,
): bigint {
  if (!redactedStatus) {
    return 0n;
  }

  const capitalizedLane = `${lane.slice(0, 1).toUpperCase()}${lane.slice(1)}`;
  const candidates = [
    `hostedMailbox${capitalizedLane}ImportedSeq`,
    `${lane}ImportedSeq`,
    `imported${capitalizedLane}Seq`,
    `mailbox${capitalizedLane}ImportedSeq`,
  ];

  for (const key of candidates) {
    const parsed = readNonNegativeBigInt(redactedStatus[key]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return 0n;
}

export function readHostedMailboxRedactedStatusRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return Object.fromEntries(Object.entries(value));
}

function readNonNegativeBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    return BigInt(value);
  }

  return null;
}
