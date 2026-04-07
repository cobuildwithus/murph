export interface EventLifecycle {
  revision: number;
  state?: "deleted";
}

export type EventLifecycleParseResult =
  | {
      state: "missing";
    }
  | {
      state: "invalid";
    }
  | {
      state: "valid";
      lifecycle: EventLifecycle;
    };

export interface EventRevisionPriorityFields {
  lifecycle?: unknown;
  occurredAt?: string | null;
  recordedAt?: string | null;
  relativePath?: string | null;
}

export interface EventRevisionCollapseFields extends EventRevisionPriorityFields {
  eventId: string;
}

export function parseEventLifecycle(
  value: unknown,
): EventLifecycleParseResult {
  if (value === undefined) {
    return { state: "missing" };
  }

  if (!isPlainRecord(value)) {
    return { state: "invalid" };
  }

  const revision = value.revision;
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    return { state: "invalid" };
  }

  const state = normalizeOptionalString(value.state);
  if (state && state !== "deleted") {
    return { state: "invalid" };
  }

  return {
    state: "valid",
    lifecycle: {
      revision,
      state: state as "deleted" | undefined,
    },
  };
}

export function eventRevisionFromLifecycle(
  value: unknown,
): number {
  const parsed = parseEventLifecycle(value);
  return parsed.state === "valid" ? parsed.lifecycle.revision : 1;
}

export function isDeletedEventLifecycle(
  value: unknown,
): boolean {
  const parsed = parseEventLifecycle(value);
  return parsed.state === "valid" && parsed.lifecycle.state === "deleted";
}

export function hasInvalidEventLifecycle(
  value: unknown,
): boolean {
  return parseEventLifecycle(value).state === "invalid";
}

export function compareEventRevisionPriority(
  left: EventRevisionPriorityFields,
  right: EventRevisionPriorityFields,
): number {
  const revisionComparison =
    eventRevisionFromLifecycle(left.lifecycle)
    - eventRevisionFromLifecycle(right.lifecycle);
  if (revisionComparison !== 0) {
    return revisionComparison;
  }

  const leftRecordedAt = left.recordedAt ?? "";
  const rightRecordedAt = right.recordedAt ?? "";
  const recordedAtComparison = leftRecordedAt.localeCompare(rightRecordedAt);
  if (recordedAtComparison !== 0) {
    return recordedAtComparison;
  }

  const leftOccurredAt = left.occurredAt ?? "";
  const rightOccurredAt = right.occurredAt ?? "";
  const occurredAtComparison = leftOccurredAt.localeCompare(rightOccurredAt);
  if (occurredAtComparison !== 0) {
    return occurredAtComparison;
  }

  return (left.relativePath ?? "").localeCompare(right.relativePath ?? "");
}

export function collapseEventRevisions<T>(
  values: readonly T[],
  selectFields: (value: T) => EventRevisionCollapseFields,
): T[] {
  const latestByEventId = new Map<
    string,
    {
      value: T;
      fields: EventRevisionCollapseFields;
    }
  >();

  for (const value of values) {
    const fields = selectFields(value);
    const eventId = normalizeOptionalString(fields.eventId);
    if (!eventId || hasInvalidEventLifecycle(fields.lifecycle)) {
      continue;
    }

    const current = latestByEventId.get(eventId);
    if (!current || compareEventRevisionPriority(current.fields, fields) < 0) {
      latestByEventId.set(eventId, { value, fields });
    }
  }

  return [...latestByEventId.values()]
    .filter(({ fields }) => !isDeletedEventLifecycle(fields.lifecycle))
    .map(({ value }) => value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
