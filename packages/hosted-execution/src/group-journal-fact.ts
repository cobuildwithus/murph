import {
  HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_NOTE_LENGTH,
  HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_TITLE_LENGTH,
  HOSTED_EXECUTION_GROUP_JOURNAL_FACT_NOTE_TYPES,
  type HostedExecutionGroupJournalFactPayload,
} from "./contracts.ts";

const STRICT_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function parseHostedExecutionGroupJournalFactPayload(
  value: unknown,
): HostedExecutionGroupJournalFactPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Hosted execution group Journal fact payload must be an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ["date", "factIndex", "note", "noteType", "title"];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError("Hosted execution group Journal fact payload has invalid fields.");
  }
  const date = requireBoundedString(record.date, "date", 10);
  if (!STRICT_ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new TypeError("Hosted execution group Journal fact date is invalid.");
  }
  if (
    !Number.isInteger(record.factIndex)
    || typeof record.factIndex !== "number"
    || record.factIndex < 1
    || record.factIndex > 8
  ) {
    throw new TypeError("Hosted execution group Journal fact index is invalid.");
  }
  const noteType = requireBoundedString(record.noteType, "noteType", 40);
  if (!HOSTED_EXECUTION_GROUP_JOURNAL_FACT_NOTE_TYPES.includes(
    noteType as HostedExecutionGroupJournalFactPayload["noteType"],
  )) {
    throw new TypeError("Hosted execution group Journal fact note type is invalid.");
  }
  return {
    date,
    factIndex: record.factIndex,
    note: requireBoundedString(
      record.note,
      "note",
      HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_NOTE_LENGTH,
    ),
    noteType: noteType as HostedExecutionGroupJournalFactPayload["noteType"],
    title: requireBoundedString(
      record.title,
      "title",
      HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_TITLE_LENGTH,
    ),
  };
}

function requireBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`Hosted execution group Journal fact ${label} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || Array.from(normalized).length > maxLength) {
    throw new TypeError(`Hosted execution group Journal fact ${label} is out of bounds.`);
  }
  return normalized;
}
