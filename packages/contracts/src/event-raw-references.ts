export interface EventRawReferenceRecord {
  attachments?: unknown;
  evidence?: unknown;
  media?: unknown;
  rawRefs?: unknown;
  workout?: unknown;
}

export function collectEventRawReferencePaths(record: EventRawReferenceRecord): string[] {
  const references = new Set<string>();

  collectStringReferences(record.rawRefs, references);
  collectEvidenceRawReferences(record.evidence, references);
  collectRelativePathReferences(record.media, references);
  collectRelativePathReferences(record.attachments, references);
  if (isRecord(record.workout)) {
    collectRelativePathReferences(record.workout.media, references);
  }

  return [...references].sort((left, right) => left.localeCompare(right));
}

function collectStringReferences(value: unknown, references: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item === "string") {
      references.add(item);
    }
  }
}

function collectEvidenceRawReferences(value: unknown, references: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (isRecord(item) && typeof item.rawRef === "string") {
      references.add(item.rawRef);
    }
  }
}

function collectRelativePathReferences(value: unknown, references: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (isRecord(item) && typeof item.relativePath === "string") {
      references.add(item.relativePath);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
