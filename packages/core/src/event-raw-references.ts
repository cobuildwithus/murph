export type EventRawReferenceLocation =
  | "rawRefs"
  | "evidence.rawRef"
  | "attachments.relativePath"
  | "media.relativePath"
  | "workout.media.relativePath";

export interface EventRawReference {
  location: EventRawReferenceLocation;
  relativePath: string;
}

export function collectEventRawReferences(record: unknown): EventRawReference[] {
  if (!isRecord(record)) {
    return [];
  }

  const references: EventRawReference[] = [];
  collectStringArrayReferences(references, record.rawRefs, "rawRefs");
  collectObjectArrayPathReferences(references, record.evidence, "rawRef", "evidence.rawRef");
  collectObjectArrayPathReferences(references, record.attachments, "relativePath", "attachments.relativePath");
  collectObjectArrayPathReferences(references, record.media, "relativePath", "media.relativePath");

  if (isRecord(record.workout)) {
    collectObjectArrayPathReferences(
      references,
      record.workout.media,
      "relativePath",
      "workout.media.relativePath",
    );
  }

  return references;
}

function collectStringArrayReferences(
  references: EventRawReference[],
  value: unknown,
  location: EventRawReferenceLocation,
): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (typeof entry === "string") {
      references.push({ location, relativePath: entry });
    }
  }
}

function collectObjectArrayPathReferences(
  references: EventRawReference[],
  value: unknown,
  key: "rawRef" | "relativePath",
  location: EventRawReferenceLocation,
): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (isRecord(entry) && typeof entry[key] === "string") {
      references.push({ location, relativePath: entry[key] });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
