import type { EventRecord, ExperimentEventRecord } from "@healthybob/contracts";
import { CONTRACT_SCHEMA_VERSION, eventRecordSchema } from "@healthybob/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.js";
import { VaultError } from "../errors.js";
import { walkVaultFiles } from "../fs.js";
import { generateRecordId } from "../ids.js";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.js";

import {
  compactObject,
  normalizeLocalDate,
  normalizeOptionalText,
  normalizeTimestampInput,
  runLoadedCanonicalWrite,
  uniqueTrimmedStringList,
  validateContract,
} from "./shared.js";

type JsonObject = Record<string, unknown>;
type EventWriteKind =
  | "symptom"
  | "note"
  | "observation"
  | "medication_intake"
  | "supplement_intake"
  | "activity_session"
  | "sleep_session";

export interface UpsertEventInput {
  vaultRoot: string;
  payload: JsonObject;
}

export interface UpsertEventResult {
  eventId: string;
  ledgerFile: string;
  created: boolean;
}

const EVENT_WRITE_KIND_SET = new Set<EventWriteKind>([
  "symptom",
  "note",
  "observation",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "sleep_session",
]);
const RESERVED_EVENT_KEYS = new Set([
  "schemaVersion",
  "id",
  "eventId",
  "kind",
  "occurredAt",
  "recordedAt",
  "dayKey",
  "source",
  "title",
  "note",
  "tags",
  "relatedIds",
  "rawRefs",
]);

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requireText(value: unknown, message: string): string {
  const normalized = normalizeOptionalText(valueAsString(value));
  if (!normalized) {
    throw new VaultError("HB_INVALID_INPUT", message);
  }

  return normalized;
}

function eventSpecificFields(payload: JsonObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => !RESERVED_EVENT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function buildManualEventRecord(payload: JsonObject): EventRecord {
  const kind = valueAsString(payload.kind);
  if (!kind || !EVENT_WRITE_KIND_SET.has(kind as EventWriteKind)) {
    throw new VaultError("HB_EVENT_KIND_INVALID", "Event payload requires a supported kind.");
  }

  const occurredAt = normalizeTimestampInput(payload.occurredAt);
  if (!occurredAt) {
    throw new VaultError("HB_EVENT_OCCURRED_AT_MISSING", "Event payload requires occurredAt.");
  }

  return validateContract(
    eventRecordSchema,
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.event,
      id: normalizeOptionalText(
        typeof payload.id === "string" ? payload.id : valueAsString(payload.eventId),
      ) ?? generateRecordId(ID_PREFIXES.event),
      kind,
      occurredAt,
      recordedAt: normalizeTimestampInput(payload.recordedAt) ?? new Date().toISOString(),
      dayKey: normalizeLocalDate(valueAsString(payload.dayKey)) ?? occurredAt.slice(0, 10),
      source: normalizeOptionalText(valueAsString(payload.source)) ?? "manual",
      title: requireText(payload.title, "Event payload requires a title."),
      note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
      tags: uniqueTrimmedStringList(payload.tags) ?? undefined,
      relatedIds: uniqueTrimmedStringList(payload.relatedIds) ?? undefined,
      rawRefs: uniqueTrimmedStringList(payload.rawRefs) ?? undefined,
      ...eventSpecificFields(payload),
    }),
    "HB_EVENT_CONTRACT_INVALID",
    `Event payload for kind "${kind}" is invalid.`,
  );
}

export function buildExperimentEventRecord(input: {
  occurredAt: string;
  title: string;
  note?: string;
  experimentId: string;
  experimentSlug: string;
  phase: ExperimentEventRecord["phase"];
}): ExperimentEventRecord {
  return validateContract(
    eventRecordSchema,
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.event,
      id: generateRecordId(ID_PREFIXES.event),
      kind: "experiment_event",
      occurredAt: input.occurredAt,
      recordedAt: new Date().toISOString(),
      dayKey: input.occurredAt.slice(0, 10),
      source: "manual",
      title: input.title.trim(),
      note: normalizeOptionalText(input.note) ?? undefined,
      relatedIds: [input.experimentId],
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      phase: input.phase,
    }),
    "HB_EVENT_CONTRACT_INVALID",
    'Event payload for kind "experiment_event" is invalid.',
  ) as ExperimentEventRecord;
}

async function findEventLedgerFileById(
  vaultRoot: string,
  eventId: string,
): Promise<string | null> {
  const relativePaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of relativePaths) {
    const records = await readJsonlRecords({
      vaultRoot,
      relativePath,
    });
    if (
      records.some(
        (record) =>
          typeof (record as { id?: unknown }).id === "string" &&
          (record as { id: string }).id === eventId,
      )
    ) {
      return relativePath;
    }
  }

  return null;
}

export async function upsertEvent(
  input: UpsertEventInput,
): Promise<UpsertEventResult> {
  const eventRecord = buildManualEventRecord(input.payload);
  const existingLedgerFile = await findEventLedgerFileById(input.vaultRoot, eventRecord.id);
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    eventRecord.occurredAt,
    "occurredAt",
  );

  if (existingLedgerFile) {
    return {
      eventId: eventRecord.id,
      ledgerFile: existingLedgerFile,
      created: false,
    };
  }

  return runLoadedCanonicalWrite<UpsertEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "event_upsert",
    summary: `Upsert event ${eventRecord.id}`,
    occurredAt: eventRecord.occurredAt,
    mutate: async ({ batch }) => {
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);

      return {
        eventId: eventRecord.id,
        ledgerFile,
        created: true,
      };
    },
  });
}
