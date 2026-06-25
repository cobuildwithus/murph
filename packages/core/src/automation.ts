import {
  AUTOMATION_DOC_TYPE,
  AUTOMATION_SCHEMA_VERSION,
  MIN_AUTOMATION_EVERY_MS,
  automationFrontmatterSchema,
  automationContinuityPolicyValues,
  automationDeviceActivityKindSchema,
  automationDeviceActivitySourceValues,
  automationScheduleKindValues,
  automationStatusValues,
  isValidAutomationCronExpression,
  type AutomationContinuityPolicy,
  type AutomationDeviceActivityKind,
  type AutomationDeviceActivitySource,
  type AutomationRoute,
  type AutomationSchedule,
  type AutomationScheduleKind,
  type AutomationScaffoldPayload as ContractAutomationScaffoldPayload,
  type AutomationStatus,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "./constants.ts";
import { generateRecordId } from "./ids.ts";
import { VaultError } from "./errors.ts";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  selectExistingRegistryRecord,
  writeMarkdownRegistryRecord,
} from "./registry/markdown.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import {
  normalizeId,
  normalizeSlug,
  optionalEnum,
  optionalString,
  requireObject,
  requireString,
} from "./bank/shared.ts";
import {
  canonicalLogicalResource,
  withCanonicalResourceLocks,
} from "./operations/index.ts";
import type { FrontmatterObject } from "./types.ts";

const AUTOMATIONS_DIRECTORY = VAULT_LAYOUT.automationsDirectory;
const automationRegistryResource = canonicalLogicalResource(
  "bank/automations",
  AUTOMATIONS_DIRECTORY,
);
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function rejectRecurringScheduleTimeZone(object: Record<string, unknown>): void {
  if (Object.hasOwn(object, "timeZone")) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "schedule.timeZone is not supported for canonical automation schedules.",
    );
  }
}

export type {
  AutomationContinuityPolicy,
  AutomationRoute,
  AutomationSchedule,
  AutomationStatus,
};

export interface AutomationRecord {
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  docType: typeof AUTOMATION_DOC_TYPE;
  automationId: string;
  slug: string;
  title: string;
  status: AutomationStatus;
  summary: string | null;
  schedule: AutomationSchedule;
  route: AutomationRoute;
  continuityPolicy: AutomationContinuityPolicy;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  instructions: string;
  relativePath: string;
  markdown: string;
}

export type AutomationScaffoldPayload = ContractAutomationScaffoldPayload;

export interface UpsertAutomationInput extends AutomationScaffoldPayload {
  allowSlugRename?: boolean;
  automationId?: string;
  now?: Date;
  vaultRoot: string;
}

export interface UpsertAutomationResult {
  auditPath: string;
  created: boolean;
  record: AutomationRecord;
}

export interface PatchAutomationInput {
  continuityPolicy?: AutomationContinuityPolicy;
  instructions?: string;
  lookup: string;
  now?: Date;
  route?: AutomationRoute;
  schedule?: AutomationSchedule;
  slug?: string;
  status?: AutomationStatus;
  summary?: string | null;
  tags?: string[];
  title?: string;
  vaultRoot: string;
}

export interface ReadAutomationInput {
  automationId?: string;
  slug?: string;
  vaultRoot: string;
}

export interface ListAutomationInput {
  limit?: number;
  status?: string | string[];
  text?: string;
  vaultRoot: string;
}

export interface ListAutomationResult {
  items: AutomationRecord[];
  count: number;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableRouteString(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeNullableString(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeNullableString(String(value));
  }

  return null;
}

function normalizeAutomationStatus(value: unknown): AutomationStatus {
  return optionalEnum(value, automationStatusValues, "status") ?? "active";
}

function normalizeAutomationContinuityPolicy(
  value: unknown,
): AutomationContinuityPolicy {
  return optionalEnum(value, automationContinuityPolicyValues, "continuityPolicy") ?? "preserve";
}

function normalizeAutomationDeviceActivitySource(value: unknown): AutomationDeviceActivitySource | undefined {
  return optionalEnum(value, automationDeviceActivitySourceValues, "schedule.source") ?? undefined;
}

function normalizeAutomationDeviceActivityKind(value: unknown): AutomationDeviceActivityKind | undefined {
  const rawValue = optionalString(value, "schedule.activityKind", 120);
  if (!rawValue) {
    return undefined;
  }

  const normalized = normalizeDeviceActivityKindToken(rawValue);
  const parsed = automationDeviceActivityKindSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "schedule.activityKind must be a lowercase kebab-case device activity kind.",
    );
  }

  return parsed.data;
}

function normalizeAutomationDeviceActivityCursorEntityIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", "schedule.afterEntityIds must be an array.");
  }

  const entityIds = [...new Set(value.map((entry) => requireString(entry, "schedule.afterEntityIds[]")))]
    .sort();
  return entityIds.length > 0 ? entityIds : undefined;
}

function normalizeDeviceActivityKindToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeAutomationIsoTimestamp(value: unknown, fieldName: string): string {
  const timestamp = requireString(value, fieldName, 64);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp;
}

function normalizeAutomationSchedule(
  value: unknown,
): AutomationSchedule {
  const object = requireObject(value, "schedule");
  const kind = requireString(object.kind, "schedule.kind", 24);

  if (!automationScheduleKindValues.includes(kind as AutomationScheduleKind)) {
    throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
  }

  switch (kind) {
    case "at": {
      const at = requireString(object.at, "schedule.at", 64);
      if (Number.isNaN(Date.parse(at))) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.at must be a valid ISO timestamp.");
      }

      return {
        kind,
        at,
      };
    }
    case "every":
      if (typeof object.everyMs !== "number" || !Number.isInteger(object.everyMs) || object.everyMs <= 0) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.everyMs must be a positive integer.");
      }
      if (object.everyMs < MIN_AUTOMATION_EVERY_MS) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.everyMs must be at least 60000 ms.");
      }
      return {
        kind,
        everyMs: object.everyMs,
      };
    case "cron": {
      rejectRecurringScheduleTimeZone(object);
      const expression = requireString(object.expression, "schedule.expression", 400);
      if (!isValidAutomationCronExpression(expression)) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.expression must be a valid five-field cron expression.");
      }

      return {
        kind,
        expression,
      };
    }
    case "dailyLocal": {
      const localTime = requireString(object.localTime, "schedule.localTime", 5);
      if (!dailyLocalTimePattern.test(localTime)) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.localTime must use HH:MM format.");
      }

      rejectRecurringScheduleTimeZone(object);

      return {
        kind,
        localTime,
      };
    }
    case "deviceActivity": {
      const source = normalizeAutomationDeviceActivitySource(object.source);
      const activityKind = normalizeAutomationDeviceActivityKind(object.activityKind);
      const afterEntityIds = normalizeAutomationDeviceActivityCursorEntityIds(object.afterEntityIds);

      return {
        kind,
        after: normalizeAutomationIsoTimestamp(object.after, "schedule.after"),
        ...(afterEntityIds ? { afterEntityIds } : {}),
        ...(source ? { source } : {}),
        ...(activityKind ? { activityKind } : {}),
      };
    }
  }

  throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
}

function normalizeAutomationRoute(value: unknown): AutomationRoute {
  const object = requireObject(value, "route");

  return {
    channel: normalizeAutomationRouteChannel(object.channel),
    deliverySource: normalizeAutomationRouteDeliverySource(object.deliverySource),
    deliveryTarget: normalizeNullableRouteString(object.deliveryTarget),
    identityId: normalizeNullableRouteString(object.identityId),
    participantId: normalizeNullableRouteString(object.participantId),
    threadId: normalizeNullableRouteString(object.threadId),
  };
}

function normalizeAutomationRouteDeliverySource(
  value: unknown,
): AutomationRoute["deliverySource"] {
  if (value === null || value === undefined) {
    return null;
  }

  const object = requireObject(value, "route.deliverySource");
  const kind = requireString(object.kind, "route.deliverySource.kind");
  if (kind !== "linq") {
    throw new VaultError("VAULT_INVALID_INPUT", "route.deliverySource.kind must be linq.");
  }

  return {
    fromPhoneNumber: requireString(
      object.fromPhoneNumber,
      "route.deliverySource.fromPhoneNumber",
    ),
    kind,
  };
}

function normalizeAutomationRouteChannel(value: unknown): string {
  const channel = requireString(value, "route.channel", 120);
  switch (channel.toLowerCase()) {
    case "imessage":
    case "i-message":
      return "linq";
    default:
      return channel;
  }
}

function normalizeAutomationInstructions(value: unknown): string {
  const instructions = requireString(value, "instructions", 40_000).replace(/\s+$/u, "");
  if (!instructions.trim()) {
    throw new VaultError("VAULT_INVALID_INPUT", "instructions must contain text.");
  }

  return instructions;
}

function normalizeAutomationTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", "tags must be an array.");
  }

  const tags = [...new Set(
    value.flatMap((entry) => {
      const tag = normalizeNullableString(typeof entry === "string" ? entry : null);
      return tag ? [tag] : [];
    }),
  )];

  return tags;
}

function normalizeAutomationTitle(value: unknown): string {
  return requireString(value, "title", 160);
}

function normalizeAutomationSummary(value: unknown): string | null {
  return optionalString(value, "summary", 4000) ?? null;
}

function buildAutomationMarkdown(record: AutomationRecord): string {
  return stringifyFrontmatterDocument({
    attributes: automationFrontmatterSchema.parse(buildAutomationFrontmatter(record)),
    body: record.instructions,
  });
}

function buildAutomationScheduleFrontmatter(schedule: AutomationSchedule): FrontmatterObject {
  switch (schedule.kind) {
    case "at":
      return {
        kind: schedule.kind,
        at: schedule.at,
      };
    case "every":
      return {
        kind: schedule.kind,
        everyMs: schedule.everyMs,
      };
    case "cron":
      return {
        kind: schedule.kind,
        expression: schedule.expression,
      };
    case "dailyLocal":
      return {
        kind: schedule.kind,
        localTime: schedule.localTime,
      };
    case "deviceActivity":
      return {
        kind: schedule.kind,
        after: schedule.after,
        ...(schedule.afterEntityIds ? { afterEntityIds: schedule.afterEntityIds } : {}),
        ...(schedule.source ? { source: schedule.source } : {}),
        ...(schedule.activityKind ? { activityKind: schedule.activityKind } : {}),
      };
  }

  throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
}

function buildAutomationRouteFrontmatter(route: AutomationRoute): FrontmatterObject {
  return {
    channel: route.channel,
    deliverySource: route.deliverySource ?? null,
    deliveryTarget: route.deliveryTarget,
    identityId: route.identityId,
    participantId: route.participantId,
    threadId: route.threadId,
  };
}

function buildAutomationFrontmatter(record: AutomationRecord): FrontmatterObject {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: record.automationId,
    slug: record.slug,
    title: record.title,
    status: record.status,
    ...(record.summary === null ? {} : { summary: record.summary }),
    schedule: buildAutomationScheduleFrontmatter(record.schedule),
    route: buildAutomationRouteFrontmatter(record.route),
    continuityPolicy: record.continuityPolicy,
    tags: record.tags,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseAutomationRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): AutomationRecord {
  if (
    attributes.schemaVersion !== AUTOMATION_SCHEMA_VERSION ||
    attributes.docType !== AUTOMATION_DOC_TYPE
  ) {
    throw new VaultError(
      "VAULT_INVALID_AUTOMATION",
      "Automation registry document has an unexpected shape.",
    );
  }

  const parsedDocument = parseFrontmatterDocument(markdown);

  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: requireString(attributes.automationId, "automationId", 64),
    slug: normalizeSlug(attributes.slug, "slug"),
    title: normalizeAutomationTitle(attributes.title),
    status: normalizeAutomationStatus(attributes.status),
    summary: normalizeAutomationSummary(attributes.summary),
    schedule: normalizeAutomationSchedule(attributes.schedule),
    route: normalizeAutomationRoute(attributes.route),
    continuityPolicy: normalizeAutomationContinuityPolicy(attributes.continuityPolicy),
    tags: normalizeAutomationTags(attributes.tags),
    createdAt: requireString(attributes.createdAt, "createdAt", 64),
    updatedAt: requireString(attributes.updatedAt, "updatedAt", 64),
    instructions: normalizeAutomationInstructions(parsedDocument.body),
    relativePath,
    markdown,
  };
}

async function loadAutomationRecords(vaultRoot: string): Promise<AutomationRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: AUTOMATIONS_DIRECTORY,
    recordFromParts: parseAutomationRecord,
    isExpectedRecord: (record) =>
      record.docType === AUTOMATION_DOC_TYPE && record.schemaVersion === AUTOMATION_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_AUTOMATION",
    invalidMessage: "Automation registry document has an unexpected shape.",
  });

  return records.sort((left, right) =>
    left.title.localeCompare(right.title) ||
    left.slug.localeCompare(right.slug) ||
    left.automationId.localeCompare(right.automationId),
  );
}

function matchesAutomationText(record: AutomationRecord, text: string | undefined): boolean {
  const normalized = normalizeNullableString(text);
  if (!normalized) {
    return true;
  }

  const haystack = [
    record.automationId,
    record.slug,
    record.title,
    record.status,
    record.summary,
    record.instructions,
    JSON.stringify(record.schedule),
    JSON.stringify(record.route),
    record.continuityPolicy,
    ...(record.tags ?? []),
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join("\n")
    .toLowerCase();

  return haystack.includes(normalized.toLowerCase());
}

function matchesAutomationStatus(
  value: string | null | undefined,
  status: string | string[] | undefined,
): boolean {
  if (status === undefined) {
    return true;
  }

  const candidates = Array.isArray(status) ? status : [status];
  const normalized = candidates
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());

  if (normalized.length === 0) {
    return true;
  }

  return value ? normalized.includes(value.toLowerCase()) : false;
}

export function scaffoldAutomationPayload(): AutomationScaffoldPayload {
  return {
    title: "Weekly check-in",
    slug: "weekly-check-in",
    status: "active",
    continuityPolicy: "preserve",
    schedule: {
      kind: "cron",
      expression: "0 9 * * 1",
    },
    route: {
      channel: "telegram",
      deliverySource: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    instructions: "Write the scheduled assistant instructions here.",
    summary: "Weekly scheduled assistant notification instructions.",
    tags: ["assistant", "scheduled"],
  };
}

export async function listAutomations(
  input: ListAutomationInput,
): Promise<ListAutomationResult> {
  const records = await loadAutomationRecords(input.vaultRoot);
  const filtered = records.filter((record) =>
    matchesAutomationStatus(record.status, input.status) &&
    matchesAutomationText(record, input.text),
  );

  const limit = Number.isInteger(input.limit) && input.limit !== undefined && input.limit > 0
    ? input.limit
    : filtered.length;

  return {
    items: filtered.slice(0, limit),
    count: filtered.length,
  };
}

export async function readAutomation(
  input: ReadAutomationInput,
): Promise<AutomationRecord> {
  const records = await loadAutomationRecords(input.vaultRoot);
  const match = readRegistryRecord({
    records,
    recordId: input.automationId,
    slug: input.slug,
    getRecordId: (record) => record.automationId,
    getRecordSlug: (record) => record.slug,
    readMissingCode: "VAULT_AUTOMATION_MISSING",
    readMissingMessage: "Automation was not found.",
  });

  return match;
}

export async function showAutomation(
  input: ReadAutomationInput,
): Promise<AutomationRecord | null> {
  const records = await loadAutomationRecords(input.vaultRoot);
  return selectAutomationRecord(records, input);
}

function selectAutomationRecord(
  records: AutomationRecord[],
  input: { automationId?: string; slug?: string },
): AutomationRecord | null {
  return selectExistingRegistryRecord({
    records,
    recordId: input.automationId,
    slug: input.slug,
    getRecordId: (record) => record.automationId,
    getRecordSlug: (record) => record.slug,
    conflictCode: "VAULT_AUTOMATION_CONFLICT",
    conflictMessage: "Automation id and slug resolve to different records.",
  });
}

export async function upsertAutomation(
  input: UpsertAutomationInput,
): Promise<UpsertAutomationResult> {
  return withAutomationRegistryLock(input.vaultRoot, () => upsertAutomationWithLatestRegistry(input));
}

export async function patchAutomation(
  input: PatchAutomationInput,
): Promise<UpsertAutomationResult> {
  assertAutomationPatchHasChanges(input);

  return withAutomationRegistryLock(input.vaultRoot, async () => {
    const records = await loadAutomationRecords(input.vaultRoot);
    const existingRecord = selectAutomationRecord(records, {
      automationId: input.lookup,
      slug: input.lookup,
    });
    if (!existingRecord) {
      throw new VaultError("VAULT_AUTOMATION_MISSING", "Automation was not found.");
    }
    return upsertAutomationWithLatestRegistry({
      automationId: existingRecord.automationId,
      continuityPolicy: input.continuityPolicy ?? existingRecord.continuityPolicy,
      instructions: input.instructions ?? existingRecord.instructions,
      now: input.now,
      route: input.route ?? existingRecord.route,
      schedule: input.schedule ?? existingRecord.schedule,
      slug: input.slug ?? existingRecord.slug,
      status: input.status ?? existingRecord.status,
      summary: input.summary === undefined ? existingRecord.summary : input.summary,
      tags: input.tags ?? existingRecord.tags,
      title: input.title ?? existingRecord.title,
      vaultRoot: input.vaultRoot,
      allowSlugRename: input.slug !== undefined,
    }, records);
  });
}

function assertAutomationPatchHasChanges(input: PatchAutomationInput): void {
  const { lookup: _lookup, now: _now, vaultRoot: _vaultRoot, ...patch } = input;
  if (Object.values(patch).some((value) => value !== undefined)) {
    return;
  }

  throw new VaultError(
    "VAULT_AUTOMATION_EMPTY_PATCH",
    "Automation edit requires at least one field to update.",
  );
}

async function upsertAutomationWithLatestRegistry(
  input: UpsertAutomationInput,
  records?: AutomationRecord[],
): Promise<UpsertAutomationResult> {
  const normalizedId = normalizeId(input.automationId, "automationId", "automation");
  const title = normalizeAutomationTitle(input.title);
  const requestedSlug = normalizeSlug(input.slug, "slug", title);
  const existingRecord = selectAutomationRecord(
    records ?? await loadAutomationRecords(input.vaultRoot),
    { automationId: normalizedId, slug: requestedSlug },
  );
  const now = (input.now ?? new Date()).toISOString();
  const recordId = existingRecord?.automationId ?? normalizedId ?? generateRecordId("automation");
  const createdAt = existingRecord?.createdAt ?? now;
  const updatedAt = now;
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId,
    requestedSlug,
    defaultSlug: requestedSlug,
    allowSlugUpdate: input.allowSlugRename === true,
    directory: AUTOMATIONS_DIRECTORY,
    getRecordId: (record: AutomationRecord) => record.automationId,
    getRecordSlug: (record: AutomationRecord) => record.slug,
    getRecordRelativePath: (record: AutomationRecord) => record.relativePath,
    createRecordId: () => generateRecordId("automation"),
  });

  const record: AutomationRecord = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: target.recordId,
    slug: target.slug,
    title,
    status: normalizeAutomationStatus(input.status ?? existingRecord?.status),
    summary:
      input.summary === undefined
        ? existingRecord?.summary ?? null
        : normalizeAutomationSummary(input.summary),
    schedule:
      input.schedule !== undefined
        ? normalizeAutomationSchedule(input.schedule)
        : existingRecord?.schedule ?? scaffoldAutomationPayload().schedule,
    route:
      input.route !== undefined
        ? normalizeAutomationRoute(input.route)
        : existingRecord?.route ?? scaffoldAutomationPayload().route,
    continuityPolicy:
      normalizeAutomationContinuityPolicy(input.continuityPolicy ?? existingRecord?.continuityPolicy),
    tags:
      input.tags === undefined
        ? existingRecord?.tags ?? []
        : normalizeAutomationTags(input.tags),
    createdAt,
    updatedAt,
    instructions: normalizeAutomationInstructions(input.instructions),
    relativePath: target.relativePath,
    markdown: "",
  };

  const { auditPath, record: writtenRecord } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes: buildAutomationFrontmatter(record),
    body: record.instructions,
    recordFromParts: parseAutomationRecord,
    operationType: "automation_upsert",
    summary: `Upsert automation ${record.automationId}`,
    audit: {
      action: "automation_upsert",
      commandName: "core.upsertAutomation",
      summary: `Upserted automation ${record.automationId}.`,
      targetIds: [record.automationId],
      occurredAt: updatedAt,
    },
  });

  return {
    auditPath,
    created: target.created,
    record: writtenRecord,
  };
}

function withAutomationRegistryLock<TResult>(
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return withCanonicalResourceLocks({
    vaultRoot,
    resources: [automationRegistryResource],
    run,
  });
}

export function buildAutomationMarkdownPreview(
  input: AutomationScaffoldPayload,
): string {
  const slug = input.slug ?? normalizeSlug(undefined, "slug", input.title);
  const normalized: AutomationRecord = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: input.automationId ?? "automation_preview",
    slug,
    title: normalizeAutomationTitle(input.title),
    status: normalizeAutomationStatus(input.status),
    summary: normalizeAutomationSummary(input.summary),
    schedule: normalizeAutomationSchedule(input.schedule),
    route: normalizeAutomationRoute(input.route),
    continuityPolicy: normalizeAutomationContinuityPolicy(input.continuityPolicy),
    tags: normalizeAutomationTags(input.tags),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    instructions: normalizeAutomationInstructions(input.instructions),
    relativePath: `${AUTOMATIONS_DIRECTORY}/${slug}.md`,
    markdown: "",
  };

  return buildAutomationMarkdown(normalized);
}

export async function readAutomationMarkdown(
  vaultRoot: string,
  automationId: string,
): Promise<string> {
  const record = await readAutomation({
    automationId,
    vaultRoot,
  });

  return record.markdown;
}
