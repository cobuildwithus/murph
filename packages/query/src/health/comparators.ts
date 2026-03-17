interface RecordedOrImportedTimestampedRecord {
  id: string;
  recordedAt: string | null;
  importedAt: string | null;
}

interface OccurredAtTimestampedRecord {
  id: string;
  occurredAt: string;
}

export function compareByRecordedOrImportedAtDescThenId(
  left: RecordedOrImportedTimestampedRecord,
  right: RecordedOrImportedTimestampedRecord,
): number {
  const leftTimestamp = left.recordedAt ?? left.importedAt ?? "";
  const rightTimestamp = right.recordedAt ?? right.importedAt ?? "";

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp.localeCompare(leftTimestamp);
  }

  return left.id.localeCompare(right.id);
}

export function compareByOccurredAtDescThenId(
  left: OccurredAtTimestampedRecord,
  right: OccurredAtTimestampedRecord,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt.localeCompare(left.occurredAt);
  }

  return left.id.localeCompare(right.id);
}
