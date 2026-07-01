import { createHash } from "node:crypto";

import {
  ID_PREFIXES as CONTRACT_ID_PREFIXES,
  SCHEDULED_LOG_DOC_TYPE,
  SCHEDULED_LOG_SCHEMA_VERSION,
  executableScheduleIntentSchema,
  formatScheduleIntentIssues,
  scheduledLogActionSchema,
  scheduledLogStatusValues,
  type ExecutableScheduleIntent,
  type ExternalRef,
  type FoodNutrition,
  type MealNutrition,
  type ScheduledLogAction,
  type ScheduledLogScaffoldPayload as ContractScheduledLogScaffoldPayload,
  type ScheduledLogStatus,
} from "@murphai/contracts";

import { readFood } from "./bank/foods.ts";
import type { FoodRecord } from "./bank/types.ts";
import {
  normalizeId,
  normalizeSlug,
  optionalEnum,
  optionalString,
  requireString,
} from "./bank/shared.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { findEventByExternalRef, addActivitySession, addMeasurement, upsertEvent } from "./domains/events.ts";
import { VaultError } from "./errors.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import { generateRecordId } from "./ids.ts";
import { addMeal } from "./mutations.ts";
import {
  canonicalLogicalResource,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import { acquireCanonicalWriteLock, withCanonicalWriteLockScope } from "./operations/canonical-write-lock.ts";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  selectExistingRegistryRecord,
  writeMarkdownRegistryRecord,
} from "./registry/markdown.ts";
import type { FrontmatterObject } from "./types.ts";

const SCHEDULED_LOGS_DIRECTORY = VAULT_LAYOUT.scheduledLogsDirectory;
const scheduledLogRegistryResource = canonicalLogicalResource(
  "bank/scheduled-logs",
  SCHEDULED_LOGS_DIRECTORY,
);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type ScheduleIntent = ExecutableScheduleIntent;

export type { ScheduleIntent, ScheduledLogAction, ScheduledLogStatus };

export interface ScheduledLogRecord {
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

export type ScheduledLogScaffoldPayload = ContractScheduledLogScaffoldPayload;

export interface UpsertScheduledLogInput extends ScheduledLogScaffoldPayload {
  allowSlugRename?: boolean;
  now?: Date;
  scheduledLogId?: string;
  vaultRoot: string;
}

export interface UpsertScheduledLogResult {
  auditPath: string;
  created: boolean;
  record: ScheduledLogRecord;
}

export interface ReadScheduledLogInput {
  scheduledLogId?: string;
  slug?: string;
  vaultRoot: string;
}

export interface ListScheduledLogsInput {
  limit?: number;
  status?: string | string[];
  text?: string;
  vaultRoot: string;
}

export interface ListScheduledLogsResult {
  count: number;
  items: ScheduledLogRecord[];
}

export interface SetScheduledLogStatusInput extends ReadScheduledLogInput {
  now?: Date;
  status: ScheduledLogStatus;
}

export interface ExecuteScheduledLogOccurrenceInput {
  beforeWrite?: () => Promise<void> | void;
  occurrenceAt: string;
  scheduledLogId: string;
  vaultRoot: string;
}

export interface ExecuteScheduledLogOccurrenceResult {
  actionKind: ScheduledLogAction["kind"];
  eventId: string | null;
  eventKind: string | null;
  idempotent: boolean;
  message: string;
  scheduledLogId: string;
  skipped: boolean;
}

export interface UpsertDailyFoodScheduledLogInput {
  foodId: string;
  localTime: string;
  now?: Date;
  vaultRoot: string;
}

export interface DailyFoodScheduledLogResult {
  created: boolean;
  record: ScheduledLogRecord;
}

export interface ArchiveDailyFoodScheduledLogInput {
  foodId: string;
  now?: Date;
  vaultRoot: string;
}

export interface ArchiveDailyFoodScheduledLogResult {
  archived: ScheduledLogRecord[];
}


function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeScheduledLogStatus(value: unknown): ScheduledLogStatus {
  return optionalEnum(value, scheduledLogStatusValues, "status") ?? "active";
}

function normalizeScheduleIntent(value: unknown): ScheduleIntent {
  const parsed = executableScheduleIntentSchema.safeParse(value);
  if (!parsed.success) {
    const message = formatScheduleIntentIssues(parsed.error) ||
      "schedule must match a supported scheduled-log schedule.";
    throw new VaultError("VAULT_INVALID_INPUT", message);
  }

  return parsed.data;
}

function normalizeScheduledLogAction(value: unknown): ScheduledLogAction {
  const parsed = scheduledLogActionSchema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ") ||
      "action must match a supported scheduled-log action.";
    throw new VaultError("VAULT_INVALID_INPUT", message);
  }
  return parsed.data;
}

function normalizeScheduledLogTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new VaultError("VAULT_INVALID_INPUT", "tags must be an array.");

  const tags = [...new Set(value.flatMap((entry) => {
    const tag = normalizeNullableString(typeof entry === "string" ? entry : null);
    return tag ? [tag] : [];
  }))];

  for (const tag of tags) {
    if (!slugPattern.test(tag)) {
      throw new VaultError("VAULT_INVALID_INPUT", "tags must be lowercase slug strings.");
    }
  }

  return tags.sort((left, right) => left.localeCompare(right));
}

function normalizeScheduledLogTitle(value: unknown): string {
  return requireString(value, "title", 160);
}

function normalizeScheduledLogSummary(value: unknown): string | null {
  return optionalString(value, "summary", 500) ?? null;
}

function normalizeScheduledLogBody(value: unknown): string {
  if (value === undefined || value === null) return "";
  return requireString(value, "body", 40_000).replace(/\s+$/u, "");
}

function normalizeDailyFoodLocalTime(value: string): string {
  const parsed = executableScheduleIntentSchema.safeParse({ kind: "dailyLocal", localTime: value });
  if (!parsed.success || parsed.data.kind !== "dailyLocal") {
    throw new VaultError("VAULT_INVALID_INPUT", "localTime must use 24-hour HH:MM form.");
  }

  return parsed.data.localTime;
}

function buildScheduleFrontmatter(schedule: ScheduleIntent): FrontmatterObject {
  switch (schedule.kind) {
    case "at": return { kind: schedule.kind, at: schedule.at };
    case "every": return { kind: schedule.kind, everyMs: schedule.everyMs };
    case "cron": return { kind: schedule.kind, expression: schedule.expression };
    case "dailyLocal": return { kind: schedule.kind, localTime: schedule.localTime };
  }
}

function toFrontmatterObject(value: unknown): FrontmatterObject {
  return JSON.parse(JSON.stringify(value)) as FrontmatterObject;
}

function compactFrontmatter(attributes: FrontmatterObject): FrontmatterObject {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) =>
    value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0),
  )) as FrontmatterObject;
}

function buildScheduledLogFrontmatter(record: ScheduledLogRecord): FrontmatterObject {
  return compactFrontmatter({
    schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
    docType: SCHEDULED_LOG_DOC_TYPE,
    scheduledLogId: record.scheduledLogId,
    slug: record.slug,
    title: record.title,
    status: record.status,
    summary: record.summary,
    schedule: buildScheduleFrontmatter(record.schedule),
    action: toFrontmatterObject(record.action),
    tags: record.tags,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function buildScheduledLogMarkdown(record: ScheduledLogRecord): string {
  return stringifyFrontmatterDocument({ attributes: buildScheduledLogFrontmatter(record), body: record.body });
}

function parseScheduledLogRecord(attributes: FrontmatterObject, relativePath: string, markdown: string): ScheduledLogRecord {
  if (attributes.schemaVersion !== SCHEDULED_LOG_SCHEMA_VERSION || attributes.docType !== SCHEDULED_LOG_DOC_TYPE) {
    throw new VaultError("VAULT_INVALID_SCHEDULED_LOG", "Scheduled log registry document has an unexpected shape.");
  }
  const parsedDocument = parseFrontmatterDocument(markdown);
  return {
    schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
    docType: SCHEDULED_LOG_DOC_TYPE,
    scheduledLogId: requireString(attributes.scheduledLogId, "scheduledLogId", 64),
    slug: normalizeSlug(attributes.slug, "slug"),
    title: normalizeScheduledLogTitle(attributes.title),
    status: normalizeScheduledLogStatus(attributes.status),
    summary: normalizeScheduledLogSummary(attributes.summary),
    schedule: normalizeScheduleIntent(attributes.schedule),
    action: normalizeScheduledLogAction(attributes.action),
    tags: normalizeScheduledLogTags(attributes.tags),
    createdAt: requireString(attributes.createdAt, "createdAt", 64),
    updatedAt: requireString(attributes.updatedAt, "updatedAt", 64),
    body: normalizeScheduledLogBody(parsedDocument.body),
    relativePath,
    markdown,
  };
}

async function loadScheduledLogRecords(vaultRoot: string): Promise<ScheduledLogRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: SCHEDULED_LOGS_DIRECTORY,
    recordFromParts: parseScheduledLogRecord,
    isExpectedRecord: (record) => record.docType === SCHEDULED_LOG_DOC_TYPE && record.schemaVersion === SCHEDULED_LOG_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_SCHEDULED_LOG",
    invalidMessage: "Scheduled log registry document has an unexpected shape.",
  });
  return records.sort((left, right) =>
    left.title.localeCompare(right.title) || left.slug.localeCompare(right.slug) || left.scheduledLogId.localeCompare(right.scheduledLogId),
  );
}

function matchesScheduledLogText(record: ScheduledLogRecord, text: string | undefined): boolean {
  const normalized = normalizeNullableString(text);
  if (!normalized) return true;
  const haystack = [record.scheduledLogId, record.slug, record.title, record.status, record.summary, record.body, JSON.stringify(record.schedule), JSON.stringify(record.action), ...record.tags]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join("\n")
    .toLowerCase();
  return haystack.includes(normalized.toLowerCase());
}

function matchesScheduledLogStatus(value: string | null | undefined, status: string | string[] | undefined): boolean {
  if (status === undefined) return true;
  const candidates = Array.isArray(status) ? status : [status];
  const normalized = candidates.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim().toLowerCase());
  return normalized.length === 0 ? true : Boolean(value && normalized.includes(value.toLowerCase()));
}

function buildDailyFoodScheduledLogSlug(food: Pick<FoodRecord, "slug">): string {
  return normalizeSlug(`auto-log-${food.slug}`, "slug");
}

function buildDailyFoodScheduledLogTitle(food: Pick<FoodRecord, "title">): string {
  return `Auto-log ${food.title}`;
}

function buildDailyFoodScheduledLogSummary(food: Pick<FoodRecord, "title">): string {
  return `Auto-log saved food "${food.title}" as a derived meal.`;
}

function buildDailyFoodScheduledLogBody(food: Pick<FoodRecord, "title" | "serving" | "summary">): string {
  const lines = [
    `Writes a derived meal from saved food "${food.title}".`,
    food.serving ? `Serving: ${food.serving}` : null,
    food.summary,
  ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);

  return lines.join("\n\n");
}

function isGeneratedDailyFoodScheduledLog(record: ScheduledLogRecord, foodId: string): boolean {
  return record.action.kind === "meal.add" &&
    record.action.foodId === foodId &&
    (record.slug.startsWith("auto-log-") || record.title.startsWith("Auto-log "));
}

async function findGeneratedDailyFoodScheduledLogs(input: {
  foodId: string;
  vaultRoot: string;
}): Promise<ScheduledLogRecord[]> {
  const records = await loadScheduledLogRecords(input.vaultRoot);
  return records.filter((record) => isGeneratedDailyFoodScheduledLog(record, input.foodId));
}

export function scaffoldScheduledLogPayload(): ScheduledLogScaffoldPayload {
  return {
    title: "Daily sauna",
    slug: "daily-sauna",
    status: "active",
    schedule: { kind: "dailyLocal", localTime: "18:00" },
    action: {
      kind: "intervention_session.add",
      title: "Sauna",
      interventionType: "sauna",
      durationMinutes: 20,
      note: "Sauna",
    },
    summary: "Auto-log a daily sauna session.",
    tags: ["scheduled", "sauna"],
    body: "Writes a derived sauna session at the scheduled local time.",
  };
}

export async function listScheduledLogs(input: ListScheduledLogsInput): Promise<ListScheduledLogsResult> {
  const records = await loadScheduledLogRecords(input.vaultRoot);
  const filtered = records.filter((record) => matchesScheduledLogStatus(record.status, input.status) && matchesScheduledLogText(record, input.text));
  const limit = Number.isInteger(input.limit) && input.limit !== undefined && input.limit > 0 ? input.limit : filtered.length;
  return { items: filtered.slice(0, limit), count: filtered.length };
}

export async function readScheduledLog(input: ReadScheduledLogInput): Promise<ScheduledLogRecord> {
  const records = await loadScheduledLogRecords(input.vaultRoot);
  return readRegistryRecord({
    records,
    recordId: input.scheduledLogId,
    slug: input.slug,
    getRecordId: (record) => record.scheduledLogId,
    getRecordSlug: (record) => record.slug,
    readMissingCode: "VAULT_SCHEDULED_LOG_MISSING",
    readMissingMessage: "Scheduled log was not found.",
  });
}

export async function showScheduledLog(input: ReadScheduledLogInput): Promise<ScheduledLogRecord | null> {
  const records = await loadScheduledLogRecords(input.vaultRoot);
  return selectExistingRegistryRecord({
    records,
    recordId: input.scheduledLogId,
    slug: input.slug,
    getRecordId: (record) => record.scheduledLogId,
    getRecordSlug: (record) => record.slug,
    conflictCode: "VAULT_SCHEDULED_LOG_CONFLICT",
    conflictMessage: "Scheduled log id and slug resolve to different records.",
  });
}

export async function upsertScheduledLog(input: UpsertScheduledLogInput): Promise<UpsertScheduledLogResult> {
  return withScheduledLogRegistryLock(input.vaultRoot, () => upsertScheduledLogWithLatestRegistry(input));
}

async function upsertScheduledLogWithLatestRegistry(input: UpsertScheduledLogInput): Promise<UpsertScheduledLogResult> {
  const normalizedId = normalizeId(input.scheduledLogId, "scheduledLogId", CONTRACT_ID_PREFIXES.scheduledLog);
  const title = normalizeScheduledLogTitle(input.title);
  const requestedSlug = normalizeSlug(input.slug, "slug", title);
  const existingRecord = await showScheduledLog({ scheduledLogId: normalizedId, slug: requestedSlug, vaultRoot: input.vaultRoot });
  const now = (input.now ?? new Date()).toISOString();
  const scaffold = scaffoldScheduledLogPayload();
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: existingRecord?.scheduledLogId ?? normalizedId ?? generateRecordId(CONTRACT_ID_PREFIXES.scheduledLog),
    requestedSlug,
    defaultSlug: requestedSlug,
    allowSlugUpdate: input.allowSlugRename === true,
    directory: SCHEDULED_LOGS_DIRECTORY,
    getRecordId: (record: ScheduledLogRecord) => record.scheduledLogId,
    getRecordSlug: (record: ScheduledLogRecord) => record.slug,
    getRecordRelativePath: (record: ScheduledLogRecord) => record.relativePath,
    createRecordId: () => generateRecordId(CONTRACT_ID_PREFIXES.scheduledLog),
  });
  const record: ScheduledLogRecord = {
    schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
    docType: SCHEDULED_LOG_DOC_TYPE,
    scheduledLogId: target.recordId,
    slug: target.slug,
    title,
    status: normalizeScheduledLogStatus(input.status ?? existingRecord?.status),
    summary: normalizeScheduledLogSummary(input.summary) ?? existingRecord?.summary ?? null,
    schedule: input.schedule !== undefined ? normalizeScheduleIntent(input.schedule) : existingRecord?.schedule ?? scaffold.schedule,
    action: input.action !== undefined ? normalizeScheduledLogAction(input.action) : existingRecord?.action ?? scaffold.action,
    tags: input.tags !== undefined ? normalizeScheduledLogTags(input.tags) : existingRecord?.tags ?? [],
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    body: normalizeScheduledLogBody(input.body ?? existingRecord?.body ?? ""),
    relativePath: target.relativePath,
    markdown: "",
  };
  const { auditPath, record: writtenRecord } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes: buildScheduledLogFrontmatter(record),
    body: record.body,
    recordFromParts: parseScheduledLogRecord,
    operationType: "scheduled_log_upsert",
    summary: `Upsert scheduled log ${record.scheduledLogId}`,
    audit: {
      action: "scheduled_log_upsert",
      commandName: "core.upsertScheduledLog",
      summary: `Upserted scheduled log ${record.scheduledLogId}.`,
      targetIds: [record.scheduledLogId],
      occurredAt: now,
    },
  });
  return { auditPath, created: target.created, record: writtenRecord };
}

export async function setScheduledLogStatus(input: SetScheduledLogStatusInput): Promise<UpsertScheduledLogResult> {
  return withScheduledLogRegistryLock(input.vaultRoot, async () => {
    const existing = await readScheduledLog(input);
    return upsertScheduledLogWithLatestRegistry({
      vaultRoot: input.vaultRoot,
      scheduledLogId: existing.scheduledLogId,
      slug: existing.slug,
      title: existing.title,
      status: input.status,
      summary: existing.summary ?? undefined,
      schedule: existing.schedule,
      action: existing.action,
      tags: existing.tags,
      body: existing.body,
      now: input.now,
    });
  });
}

export async function upsertDailyFoodScheduledLog(
  input: UpsertDailyFoodScheduledLogInput,
): Promise<DailyFoodScheduledLogResult> {
  const result = await withScheduledLogRegistryLock(input.vaultRoot, async () => {
    const localTime = normalizeDailyFoodLocalTime(input.localTime);
    const food = await readFood({ vaultRoot: input.vaultRoot, foodId: input.foodId });
    const existing = (await findGeneratedDailyFoodScheduledLogs({
      vaultRoot: input.vaultRoot,
      foodId: food.foodId,
    }))[0] ?? null;
    return upsertScheduledLogWithLatestRegistry({
      vaultRoot: input.vaultRoot,
      scheduledLogId: existing?.scheduledLogId,
      slug: existing?.slug ?? buildDailyFoodScheduledLogSlug(food),
      title: buildDailyFoodScheduledLogTitle(food),
      status: "active",
      summary: buildDailyFoodScheduledLogSummary(food),
      schedule: { kind: "dailyLocal", localTime },
      action: {
        kind: "meal.add",
        foodId: food.foodId,
      },
      tags: ["food", "scheduled"],
      body: buildDailyFoodScheduledLogBody(food),
      now: input.now,
    });
  });

  return {
    created: result.created,
    record: result.record,
  };
}

export async function archiveDailyFoodScheduledLog(
  input: ArchiveDailyFoodScheduledLogInput,
): Promise<ArchiveDailyFoodScheduledLogResult> {
  return withScheduledLogRegistryLock(input.vaultRoot, async () => {
    const records = await findGeneratedDailyFoodScheduledLogs({
      vaultRoot: input.vaultRoot,
      foodId: input.foodId,
    });
    const archived: ScheduledLogRecord[] = [];

    for (const record of records) {
      if (record.status === "archived") {
        continue;
      }

      const result = await upsertScheduledLogWithLatestRegistry({
        vaultRoot: input.vaultRoot,
        scheduledLogId: record.scheduledLogId,
        slug: record.slug,
        title: record.title,
        status: "archived",
        summary: record.summary ?? undefined,
        schedule: record.schedule,
        action: record.action,
        tags: record.tags,
        body: record.body,
        now: input.now,
      });
      archived.push(result.record);
    }

    return { archived };
  });
}

function withScheduledLogRegistryLock<TResult>(
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return withCanonicalResourceLocks({
    vaultRoot,
    resources: [scheduledLogRegistryResource],
    run,
  });
}

export function buildScheduledLogMarkdownPreview(input: ScheduledLogScaffoldPayload): string {
  const slug = input.slug ?? normalizeSlug(undefined, "slug", input.title);
  const now = new Date().toISOString();
  const normalized: ScheduledLogRecord = {
    schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
    docType: SCHEDULED_LOG_DOC_TYPE,
    scheduledLogId: input.scheduledLogId ?? "slog_00000000000000000000000000",
    slug,
    title: normalizeScheduledLogTitle(input.title),
    status: normalizeScheduledLogStatus(input.status),
    summary: normalizeScheduledLogSummary(input.summary),
    schedule: normalizeScheduleIntent(input.schedule),
    action: normalizeScheduledLogAction(input.action),
    tags: normalizeScheduledLogTags(input.tags),
    createdAt: now,
    updatedAt: now,
    body: normalizeScheduledLogBody(input.body ?? ""),
    relativePath: `${SCHEDULED_LOGS_DIRECTORY}/${slug}.md`,
    markdown: "",
  };
  return buildScheduledLogMarkdown(normalized);
}

export async function readScheduledLogMarkdown(vaultRoot: string, scheduledLogId: string): Promise<string> {
  const record = await readScheduledLog({ scheduledLogId, vaultRoot });
  return record.markdown;
}

function normalizeOccurrenceAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new VaultError("VAULT_INVALID_INPUT", "occurrenceAt must be a valid ISO timestamp.");
  }
  return new Date(timestamp).toISOString();
}

function buildScheduledLogExternalRef(input: { occurrenceAt: string; scheduledLogId: string }): ExternalRef {
  return {
    system: "murph-scheduled-log",
    resourceType: "occurrence",
    resourceId: `${input.scheduledLogId}:${input.occurrenceAt}`,
  };
}

function deterministicOccurrenceId(prefix: string, seed: string, occurrenceAt: string): string {
  const timestamp = encodeUlidTimestamp(Date.parse(occurrenceAt));
  const entropy = encodeBase32(createHash("sha256").update(`${prefix}:${seed}:${occurrenceAt}`).digest(), 16);
  return `${prefix}_${timestamp}${entropy}`;
}

function encodeUlidTimestamp(value: number): string {
  let remaining = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  let output = "";
  for (let index = 0; index < 10; index += 1) {
    output = CROCKFORD_BASE32_ALPHABET[remaining % 32] + output;
    remaining = Math.floor(remaining / 32);
  }
  return output;
}

function encodeBase32(bytes: Uint8Array, length: number): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < length) {
      bits -= 5;
      output += CROCKFORD_BASE32_ALPHABET[(buffer >> bits) & 31];
    }
    if (output.length >= length) break;
  }
  if (bits > 0 && output.length < length) {
    output += CROCKFORD_BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return output.padEnd(length, "0").slice(0, length);
}

function buildInheritedMealNutrition(foodNutrition: FoodNutrition | null | undefined, title: string): MealNutrition | undefined {
  const totals = foodNutrition?.perServing;
  if (!totals) return undefined;
  return {
    totals,
    provenance: {
      source: "inherited",
      ...(foodNutrition.provenance?.confidence ? { confidence: foodNutrition.provenance.confidence } : {}),
      sourceDetail: `Copied from saved food "${title}".`,
    },
  };
}

function renderScheduledFoodMealNote(food: Pick<FoodRecord, "title" | "serving" | "summary" | "note" | "ingredients">): string {
  const lines = [`Auto-logged saved food: ${food.title}`];
  if (food.serving) lines.push(`Serving: ${food.serving}`);
  if (food.summary) lines.push(food.summary);
  if (food.note) lines.push(food.note);
  if (food.ingredients && food.ingredients.length > 0) lines.push(`Ingredients: ${food.ingredients.join(", ")}`);
  return lines.join("\n");
}

async function executeScheduledLogAction(input: {
  action: ScheduledLogAction;
  externalRef: ExternalRef;
  occurrenceAt: string;
  scheduledLogId: string;
  vaultRoot: string;
}): Promise<{ eventId: string; eventKind: string }> {
  const eventId = deterministicOccurrenceId(CONTRACT_ID_PREFIXES.event, `${input.scheduledLogId}:event`, input.occurrenceAt);
  switch (input.action.kind) {
    case "meal.add": {
      const food = input.action.foodId ? await readFood({ vaultRoot: input.vaultRoot, foodId: input.action.foodId }) : null;
      const result = await addMeal({
        vaultRoot: input.vaultRoot,
        mealId: deterministicOccurrenceId(CONTRACT_ID_PREFIXES.meal, `${input.scheduledLogId}:${input.action.kind}:meal`, input.occurrenceAt),
        eventId,
        occurredAt: input.occurrenceAt,
        note: input.action.note ?? (food ? renderScheduledFoodMealNote(food) : undefined),
        ingredients: input.action.ingredients ?? food?.ingredients,
        nutrition: input.action.nutrition ?? buildInheritedMealNutrition(food?.nutrition, food?.title ?? "Food"),
        source: "derived",
        tags: input.action.tags,
        externalRef: input.externalRef,
      });
      return { eventId: result.event.id, eventKind: result.event.kind };
    }
    case "activity_session.add": {
      const result = await addActivitySession({
        vaultRoot: input.vaultRoot,
        draft: {
          id: eventId,
          occurredAt: input.occurrenceAt,
          source: "derived",
          title: input.action.title,
          note: input.action.note,
          tags: input.action.tags,
          externalRef: input.externalRef,
          activityType: input.action.activityType,
          durationMinutes: input.action.durationMinutes,
          distanceKm: input.action.distanceKm,
          workout: input.action.workout ?? {
            sourceApp: "murph-scheduled-log",
            startedAt: input.occurrenceAt,
            sessionNote: input.action.note ?? input.action.title,
            exercises: [],
          },
        },
      });
      return { eventId: result.event.id, eventKind: result.event.kind };
    }
    case "intervention_session.add": {
      const result = await upsertEvent({
        vaultRoot: input.vaultRoot,
        draft: {
          kind: "intervention_session",
          id: eventId,
          occurredAt: input.occurrenceAt,
          source: "derived",
          title: input.action.title,
          note: input.action.note,
          tags: input.action.tags,
          externalRef: input.externalRef,
          interventionType: input.action.interventionType,
          durationMinutes: input.action.durationMinutes,
          protocolId: input.action.protocolId,
          links: input.action.protocolId ? [{ type: "related_to", targetId: input.action.protocolId }] : undefined,
        },
      });
      return { eventId: result.eventId, eventKind: "intervention_session" };
    }
    case "measurement.add": {
      const result = await addMeasurement({
        vaultRoot: input.vaultRoot,
        draft: {
          id: eventId,
          occurredAt: input.occurrenceAt,
          source: "derived",
          title: input.action.title ?? "Scheduled measurement",
          note: input.action.note,
          tags: input.action.tags,
          externalRef: input.externalRef,
          measurements: input.action.measurements,
        },
      });
      return { eventId: result.event.id, eventKind: result.event.kind };
    }
  }
}

export async function executeScheduledLogOccurrence(input: ExecuteScheduledLogOccurrenceInput): Promise<ExecuteScheduledLogOccurrenceResult> {
  const occurrenceAt = normalizeOccurrenceAt(input.occurrenceAt);
  return await withCanonicalWriteLockScope(input.vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.vaultRoot);

    try {
      const record = await readScheduledLog({ vaultRoot: input.vaultRoot, scheduledLogId: input.scheduledLogId });
      const externalRef = buildScheduledLogExternalRef({ occurrenceAt, scheduledLogId: record.scheduledLogId });
      const existing = await findEventByExternalRef({ vaultRoot: input.vaultRoot, ...externalRef });
      if (existing) {
        return {
          actionKind: record.action.kind,
          eventId: existing.id,
          eventKind: existing.kind,
          idempotent: true,
          message: `Skipped scheduled log "${record.title}" because occurrence ${occurrenceAt} is already logged as ${existing.kind} ${existing.id}.`,
          scheduledLogId: record.scheduledLogId,
          skipped: true,
        };
      }

      if (record.status !== "active") {
        return {
          actionKind: record.action.kind,
          eventId: null,
          eventKind: null,
          idempotent: false,
          message: `Skipped scheduled log "${record.title}" because it is ${record.status}.`,
          scheduledLogId: record.scheduledLogId,
          skipped: true,
        };
      }

      await input.beforeWrite?.();
      const written = await executeScheduledLogAction({
        action: record.action,
        externalRef,
        occurrenceAt,
        scheduledLogId: record.scheduledLogId,
        vaultRoot: input.vaultRoot,
      });
      return {
        actionKind: record.action.kind,
        eventId: written.eventId,
        eventKind: written.eventKind,
        idempotent: false,
        message: `Auto-logged scheduled log "${record.title}" as ${written.eventKind} ${written.eventId}.`,
        scheduledLogId: record.scheduledLogId,
        skipped: false,
      };
    } finally {
      await lock.release();
    }
  });
}
