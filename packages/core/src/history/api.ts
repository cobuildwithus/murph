import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.js";
import { emitAuditRecord } from "../audit.js";
import { VaultError } from "../errors.js";
import { appendJsonlRecord, readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.js";
import { generateRecordId } from "../ids.js";
import { toDateOnly } from "../time.js";
import { walkVaultFiles } from "../fs.js";
import { eventRecordSchema, safeParseContract } from "@healthybob/contracts";

import {
  compareIsoTimestamps,
  normalizeId,
  normalizeRelativePathList,
  normalizeStringList,
  normalizeTagList,
  normalizeTimestamp,
  optionalEnum,
  optionalString,
  requireString,
} from "./shared.js";
import {
  ADVERSE_EFFECT_SEVERITIES,
  HEALTH_HISTORY_KINDS,
  HEALTH_HISTORY_SOURCES,
  HISTORY_EVENT_ORDER,
  PROCEDURE_STATUSES,
  TEST_STATUSES,
} from "./types.js";

import type {
  AppendHistoryEventInput,
  AppendHistoryEventResult,
  HistoryEventKind,
  HistoryEventOrder,
  HistoryEventRecord,
  HistoryEventSource,
  ListHistoryEventsInput,
  ReadHistoryEventInput,
  ReadHistoryEventResult,
} from "./types.js";

const HISTORY_KIND_SET = new Set<HistoryEventKind>(HEALTH_HISTORY_KINDS);
type HistoryNormalizationMode = "build" | "parse";
type HistorySourceRecord = Record<string, unknown>;

interface HistoryFieldDefinition<TValue> {
  sources?: Partial<Record<HistoryNormalizationMode, readonly string[]>>;
  defaults?: Partial<Record<HistoryNormalizationMode, unknown>>;
  normalize: (value: unknown, fieldName: string) => TValue;
}

function normalizeBaseEvent(input: AppendHistoryEventInput) {
  const occurredAt = normalizeTimestamp(input.occurredAt, "occurredAt");
  const recordedAt = normalizeTimestamp(input.recordedAt ?? occurredAt, "recordedAt");
  const eventId = normalizeId(input.eventId, "eventId", ID_PREFIXES.event) ?? generateRecordId("event");

  return {
    schemaVersion: "hb.event.v1" as const,
    id: eventId,
    kind: input.kind,
    occurredAt,
    recordedAt,
    dayKey: toDateOnly(occurredAt, "occurredAt"),
    source: optionalEnum(input.source ?? "manual", HEALTH_HISTORY_SOURCES, "source") ?? "manual",
    title: requireString(input.title, "title", 160),
    note: optionalString(input.note, "note", 4000),
    tags: normalizeTagList(input.tags, "tags"),
    relatedIds: normalizeStringList(input.relatedIds, "relatedIds", "id", 32, 80),
    rawRefs: normalizeRelativePathList(input.rawRefs, "rawRefs"),
  };
}

function stripUndefined<TRecord>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as TRecord;
}

const HISTORY_KIND_DEFINITIONS: Record<
  HistoryEventKind,
  Record<string, HistoryFieldDefinition<unknown>>
> = {
  encounter: {
    encounterType: {
      normalize: (value, fieldName) => requireString(value, fieldName, 120),
    },
    location: {
      sources: {
        build: ["location", "facility"],
        parse: ["location", "facility"],
      },
      normalize: (value, fieldName) => optionalString(value, fieldName, 160),
    },
    providerId: {
      normalize: (value, fieldName) => optionalString(value, fieldName, 80),
    },
  },
  procedure: {
    procedure: {
      sources: {
        build: ["procedure", "procedureName"],
        parse: ["procedure", "procedureName"],
      },
      normalize: (value, fieldName) => requireString(value, fieldName, 160),
    },
    status: {
      defaults: {
        build: "completed",
        parse: "completed",
      },
      normalize: (value, fieldName) => optionalEnum(value, PROCEDURE_STATUSES, fieldName) ?? "completed",
    },
  },
  test: {
    testName: {
      normalize: (value, fieldName) => requireString(value, fieldName, 160),
    },
    resultStatus: {
      sources: {
        build: ["resultStatus"],
        parse: ["resultStatus", "status"],
      },
      defaults: {
        build: "unknown",
        parse: "unknown",
      },
      normalize: (value, fieldName) => optionalEnum(value, TEST_STATUSES, fieldName) ?? "unknown",
    },
    summary: {
      sources: {
        build: ["summary", "resultSummary"],
        parse: ["summary", "resultSummary"],
      },
      normalize: (value, fieldName) => optionalString(value, fieldName, 1000),
    },
  },
  adverse_effect: {
    substance: {
      normalize: (value, fieldName) => requireString(value, fieldName, 160),
    },
    effect: {
      normalize: (value, fieldName) => requireString(value, fieldName, 240),
    },
    severity: {
      defaults: {
        build: "moderate",
        parse: "moderate",
      },
      normalize: (value, fieldName) =>
        optionalEnum(value, ADVERSE_EFFECT_SEVERITIES, fieldName) ?? "moderate",
    },
  },
  exposure: {
    exposureType: {
      sources: {
        build: ["exposureType", "route"],
        parse: ["exposureType", "route"],
      },
      defaults: {
        build: "unspecified",
        parse: "unspecified",
      },
      normalize: (value, fieldName) => requireString(value, fieldName, 120),
    },
    substance: {
      sources: {
        build: ["substance", "agent"],
        parse: ["substance", "agent"],
      },
      normalize: (value, fieldName) => requireString(value, fieldName, 160),
    },
    duration: {
      sources: {
        build: ["duration", "durationText"],
        parse: ["duration", "durationText"],
      },
      normalize: (value, fieldName) => optionalString(value, fieldName, 120),
    },
  },
};

function readHistoryFieldValue(
  source: HistorySourceRecord,
  aliases: readonly string[],
  fallback: unknown,
): unknown {
  for (const alias of aliases) {
    const value = source[alias];

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return fallback;
}

function normalizeHistoryKindFields(
  kind: HistoryEventKind,
  source: HistorySourceRecord,
  mode: HistoryNormalizationMode,
): Record<string, unknown> {
  const definition = HISTORY_KIND_DEFINITIONS[kind];
  const normalized: Record<string, unknown> = {};

  for (const [recordKey, fieldDefinition] of Object.entries(definition)) {
    const aliases = fieldDefinition.sources?.[mode] ?? [recordKey];
    const fallback = fieldDefinition.defaults?.[mode];
    normalized[recordKey] = fieldDefinition.normalize(
      readHistoryFieldValue(source, aliases, fallback),
      recordKey,
    );
  }

  return stripUndefined(normalized);
}

function buildHistoryEventRecord(input: AppendHistoryEventInput): HistoryEventRecord {
  if (!HISTORY_KIND_SET.has(input.kind)) {
    throw new VaultError("VAULT_INVALID_INPUT", "Unsupported health history kind.");
  }

  const baseRecord = normalizeBaseEvent(input);
  const record = stripUndefined({
    ...baseRecord,
    kind: input.kind,
    ...normalizeHistoryKindFields(input.kind, input as unknown as HistorySourceRecord, "build"),
  });
  const result = safeParseContract(eventRecordSchema, record);

  if (!result.success) {
    throw new VaultError("HB_EVENT_INVALID", "History event failed contract validation before write.", {
      errors: result.errors,
    });
  }

  return result.data as HistoryEventRecord;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredHistoryEvent(value: unknown): HistoryEventRecord | null {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return null;
  }

  const kind = value.kind as HistoryEventKind;
  if (!HISTORY_KIND_SET.has(kind)) {
    return null;
  }

  const baseRecord = {
    schemaVersion: requireString(value.schemaVersion, "schemaVersion", 40) as "hb.event.v1",
    id: requireString(value.id, "id", 64),
    kind: value.kind as HistoryEventKind,
    occurredAt: normalizeTimestamp(value.occurredAt as string, "occurredAt"),
    recordedAt: normalizeTimestamp(value.recordedAt as string, "recordedAt"),
    dayKey: requireString(value.dayKey, "dayKey", 10),
    source: optionalEnum(value.source, HEALTH_HISTORY_SOURCES, "source") ?? "manual",
    title: requireString(value.title, "title", 160),
    note: optionalString(value.note, "note", 4000),
    tags: normalizeTagList(value.tags, "tags"),
    relatedIds: normalizeStringList(value.relatedIds, "relatedIds", "id", 32, 80),
    rawRefs: normalizeRelativePathList(value.rawRefs, "rawRefs"),
  };

  return stripUndefined({
    ...baseRecord,
    kind,
    ...normalizeHistoryKindFields(kind, value, "parse"),
  }) as HistoryEventRecord;
}

function normalizeOrder(order: HistoryEventOrder | undefined): HistoryEventOrder {
  return optionalEnum(order ?? "desc", HISTORY_EVENT_ORDER, "order") ?? "desc";
}

function normalizeSourceFilter(source: HistoryEventSource | undefined): HistoryEventSource | undefined {
  if (source === undefined) {
    return undefined;
  }

  return optionalEnum(source, HEALTH_HISTORY_SOURCES, "source");
}

function normalizeKindFilter(kinds: HistoryEventKind[] | undefined): Set<HistoryEventKind> | null {
  if (kinds === undefined) {
    return null;
  }

  if (!Array.isArray(kinds) || kinds.length === 0) {
    return null;
  }

  const normalized = kinds.map((kind, index) => {
    const candidate = String(kind ?? "").trim();

    if (!HISTORY_KIND_SET.has(candidate as HistoryEventKind)) {
      throw new VaultError("VAULT_INVALID_INPUT", `kinds[${index}] is unsupported.`);
    }

    return candidate as HistoryEventKind;
  });

  return new Set(normalized);
}

function normalizeLimit(limit: number | undefined): number | null {
  if (limit === undefined || limit === null) {
    return null;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new VaultError("VAULT_INVALID_INPUT", "limit must be an integer between 1 and 500.");
  }

  return limit;
}

export async function appendHistoryEvent(
  input: AppendHistoryEventInput,
): Promise<AppendHistoryEventResult> {
  const record = buildHistoryEventRecord(input);
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    record.occurredAt,
    "occurredAt",
  );

  await appendJsonlRecord({
    vaultRoot: input.vaultRoot,
    relativePath,
    record,
  });
  const audit = await emitAuditRecord({
    vaultRoot: input.vaultRoot,
    action: "history_add",
    commandName: "core.appendHistoryEvent",
    summary: `Appended ${record.kind} history event ${record.id}.`,
    occurredAt: record.recordedAt,
    targetIds: [record.id],
    changes: [
      {
        path: relativePath,
        op: "append",
      },
    ],
  });

  return {
    auditPath: audit.relativePath,
    relativePath,
    record,
  };
}

export async function listHistoryEvents({
  vaultRoot,
  kinds,
  source,
  from,
  to,
  order = "desc",
  limit,
}: ListHistoryEventsInput): Promise<HistoryEventRecord[]> {
  const kindFilter = normalizeKindFilter(kinds);
  const sourceFilter = normalizeSourceFilter(source);
  const normalizedOrder = normalizeOrder(order);
  const normalizedLimit = normalizeLimit(limit);
  const fromTimestamp = from ? normalizeTimestamp(from, "from") : null;
  const toTimestamp = to ? normalizeTimestamp(to, "to") : null;
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  const records: HistoryEventRecord[] = [];

  for (const relativePath of shardPaths) {
    const shardRecords = await readJsonlRecords({ vaultRoot, relativePath });

    for (const shardRecord of shardRecords) {
      const parsed = parseStoredHistoryEvent(shardRecord);

      if (!parsed) {
        continue;
      }

      if (kindFilter && !kindFilter.has(parsed.kind)) {
        continue;
      }

      if (sourceFilter && parsed.source !== sourceFilter) {
        continue;
      }

      if (fromTimestamp && parsed.occurredAt < fromTimestamp) {
        continue;
      }

      if (toTimestamp && parsed.occurredAt > toTimestamp) {
        continue;
      }

      records.push(parsed);
    }
  }

  records.sort((left, right) => compareIsoTimestamps(left, right, normalizedOrder));

  return normalizedLimit ? records.slice(0, normalizedLimit) : records;
}

export async function readHistoryEvent({
  vaultRoot,
  eventId,
}: ReadHistoryEventInput): Promise<ReadHistoryEventResult> {
  const normalizedEventId = normalizeId(eventId, "eventId", ID_PREFIXES.event);

  if (!normalizedEventId) {
    throw new VaultError("VAULT_INVALID_INPUT", "eventId is required.");
  }

  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of shardPaths) {
    const shardRecords = await readJsonlRecords({ vaultRoot, relativePath });

    for (const shardRecord of shardRecords) {
      if (!isPlainRecord(shardRecord) || shardRecord.id !== normalizedEventId) {
        continue;
      }

      const parsed = parseStoredHistoryEvent(shardRecord);

      if (!parsed) {
        throw new VaultError("VAULT_INVALID_HISTORY_EVENT", "Stored health history event is malformed.");
      }

      return {
        relativePath,
        record: parsed,
      };
    }
  }

  throw new VaultError("VAULT_HISTORY_EVENT_MISSING", "Health history event was not found.");
}
