import {
  SCHEDULED_LOG_DOC_TYPE,
  SCHEDULED_LOG_SCHEMA_VERSION,
  formatScheduleIntentIssues,
  scheduleIntentSchema,
  scheduledLogActionSchema,
  scheduledLogStatusValues,
  VAULT_LAYOUT,
  type ScheduleIntent,
  type ScheduledLogAction,
  type ScheduledLogStatus,
} from "@murphai/contracts";

import { readMarkdownDocument, walkRelativeFiles } from "./health/loaders.ts";
import {
  applyLimit,
  compareNullableStrings,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./health/shared.ts";
import { parseFrontmatterDocument, type FrontmatterObject } from "./health/shared.ts";

const SCHEDULED_LOGS_DIRECTORY = VAULT_LAYOUT.scheduledLogsDirectory;

export type {
  ScheduleIntent,
  ScheduledLogAction,
  ScheduledLogStatus,
};

export interface ScheduledLogQueryRecord {
  schemaVersion: typeof SCHEDULED_LOG_SCHEMA_VERSION;
  docType: typeof SCHEDULED_LOG_DOC_TYPE;
  scheduledLogId: string;
  slug: string;
  title: string;
  status: ScheduledLogStatus;
  summary: string | null;
  schedule: ScheduleIntent;
  action: ScheduledLogAction;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  body: string;
  relativePath: string;
  markdown: string;
}

export interface ScheduledLogListOptions {
  status?: string | string[];
  text?: string;
  limit?: number;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireStringValue(value: unknown, fieldName: string): string {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeScheduledLogStatus(value: unknown): ScheduledLogStatus {
  if (value === undefined || value === null) {
    return "active";
  }
  if (typeof value !== "string") {
    throw new Error("status must be a string.");
  }
  const normalized = normalizeNullableString(value);
  if (normalized === null) {
    return "active";
  }
  if (normalized && scheduledLogStatusValues.includes(normalized as ScheduledLogStatus)) {
    return normalized as ScheduledLogStatus;
  }

  throw new Error(`status must be one of ${scheduledLogStatusValues.join(", ")}.`);
}

function normalizeScheduleIntent(value: unknown): ScheduleIntent {
  const parsed = scheduleIntentSchema.safeParse(value);
  if (!parsed.success) {
    const message = formatScheduleIntentIssues(parsed.error) ||
      "schedule must match a supported scheduled-log schedule.";
    throw new Error(message);
  }

  return parsed.data;
}

function normalizeScheduledLogAction(value: unknown): ScheduledLogAction {
  const parsed = scheduledLogActionSchema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ") ||
      "action must match a supported scheduled-log action.";
    throw new Error(message);
  }

  return parsed.data;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value.flatMap((entry) => {
      const tag = normalizeNullableString(typeof entry === "string" ? entry : null);
      return tag ? [tag] : [];
    }),
  )].sort((left, right) => left.localeCompare(right));
}

function normalizeBody(body: string): string {
  return body.replace(/\s+$/u, "");
}

function parseScheduledLogRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): ScheduledLogQueryRecord {
  if (
    attributes.schemaVersion !== SCHEDULED_LOG_SCHEMA_VERSION ||
    attributes.docType !== SCHEDULED_LOG_DOC_TYPE
  ) {
    throw new Error("Scheduled log registry document has an unexpected shape.");
  }

  const parsed = parseFrontmatterDocument(markdown);

  return {
    schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
    docType: SCHEDULED_LOG_DOC_TYPE,
    scheduledLogId: requireStringValue(attributes.scheduledLogId, "scheduledLogId"),
    slug: requireStringValue(attributes.slug, "slug"),
    title: requireStringValue(attributes.title, "title"),
    status: normalizeScheduledLogStatus(attributes.status),
    summary: normalizeNullableString(typeof attributes.summary === "string" ? attributes.summary : null),
    schedule: normalizeScheduleIntent(attributes.schedule),
    action: normalizeScheduledLogAction(attributes.action),
    tags: normalizeTags(attributes.tags),
    createdAt: requireStringValue(attributes.createdAt, "createdAt"),
    updatedAt: requireStringValue(attributes.updatedAt, "updatedAt"),
    body: normalizeBody(parsed.body),
    relativePath,
    markdown,
  };
}

async function loadScheduledLogRecords(vaultRoot: string): Promise<ScheduledLogQueryRecord[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, SCHEDULED_LOGS_DIRECTORY, ".md");
  const records: ScheduledLogQueryRecord[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const record = parseScheduledLogRecord(document.attributes, relativePath, document.markdown);
    records.push(record);
  }

  return records.sort((left, right) =>
    compareNullableStrings(left.title, right.title) ||
    compareNullableStrings(left.slug, right.slug) ||
    compareNullableStrings(left.scheduledLogId, right.scheduledLogId),
  );
}

function matchesScheduledLogText(record: ScheduledLogQueryRecord, text: string | undefined): boolean {
  if (!normalizeNullableString(text)) {
    return true;
  }

  return matchesText(
    [
      record.scheduledLogId,
      record.slug,
      record.title,
      record.summary,
      record.body,
      record.createdAt,
      record.updatedAt,
      record.status,
      JSON.stringify(record.schedule),
      JSON.stringify(record.action),
      record.tags,
    ],
    text,
  );
}

export async function listScheduledLogs(
  vaultRoot: string,
  options: ScheduledLogListOptions = {},
): Promise<ScheduledLogQueryRecord[]> {
  const records = await loadScheduledLogRecords(vaultRoot);
  const filtered = records.filter((record) =>
    matchesStatus(record.status, options.status) &&
    matchesScheduledLogText(record, options.text),
  );

  return applyLimit(filtered, options.limit);
}

export async function readScheduledLog(
  vaultRoot: string,
  scheduledLogId: string,
): Promise<ScheduledLogQueryRecord | null> {
  const records = await loadScheduledLogRecords(vaultRoot);
  return records.find((record) => record.scheduledLogId === scheduledLogId) ?? null;
}

export async function showScheduledLog(
  vaultRoot: string,
  lookup: string,
): Promise<ScheduledLogQueryRecord | null> {
  const records = await loadScheduledLogRecords(vaultRoot);
  const normalized = lookup.trim().toLowerCase();
  return (
    records.find((record) =>
      matchesLookup(normalized, record.scheduledLogId, record.slug, record.title)
    ) ?? null
  );
}
