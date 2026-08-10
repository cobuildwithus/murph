import {
  AUTOMATION_DOC_TYPE,
  AUTOMATION_SCHEMA_VERSION,
  AUTOMATION_SUPPORT_SERIES_TAG_PREFIX,
  MIN_AUTOMATION_EVERY_MS,
  assistantReasoningEffortValues,
  automationActiveUntilSchema,
  automationContinuityPolicyValues,
  automationDeviceActivityKindSchema,
  automationDeviceActivitySourceValues,
  automationScheduleAtSchema,
  automationScheduleKindValues,
  automationStatusValues,
  automationSupportKindValues,
  normalizeIanaTimeZone,
  parseAutomationSupportSeriesTag,
  VAULT_LAYOUT,
  type AutomationAssistantTargetOverride,
  type AutomationContinuityPolicy,
  type AutomationDeviceActivityKind,
  type AutomationDeviceActivitySource,
  type AutomationRoute,
  type AutomationSchedule,
  type AutomationScheduleKind,
  type AutomationStatus,
  type AutomationSupportKind,
} from "@murphai/contracts";

import { readMarkdownDocument, readOptionalMarkdownDocumentOutcome, walkRelativeFiles } from "./health/loaders.ts";
import {
  applyLimit,
  compareNullableStrings,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./health/shared.ts";
import { parseFrontmatterDocument, type FrontmatterObject } from "./health/shared.ts";

const AUTOMATIONS_DIRECTORY = VAULT_LAYOUT.automationsDirectory;
const AUTOMATION_DOCUMENT_READ_CONCURRENCY = 16;
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
type AutomationAssistantReasoningEffort = NonNullable<
  AutomationAssistantTargetOverride["reasoningEffort"]
>;

export type {
  AutomationAssistantTargetOverride,
  AutomationContinuityPolicy,
  AutomationRoute,
  AutomationSchedule,
  AutomationStatus,
  AutomationSupportKind,
};

export interface AutomationQueryRecord {
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  docType: typeof AUTOMATION_DOC_TYPE;
  automationId: string;
  slug: string;
  title: string;
  status: AutomationStatus;
  summary: string | null;
  activeUntil: string | null;
  schedule: AutomationSchedule;
  route: AutomationRoute;
  assistantTargetOverride: AutomationAssistantTargetOverride | null;
  supportKind: AutomationSupportKind | null;
  continuityPolicy: AutomationContinuityPolicy;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  instructions: string;
  relativePath: string;
  markdown: string;
}

export interface AutomationListOptions {
  exactTag?: string;
  status?: string | string[];
  text?: string;
  limit?: number;
}

export interface AutomationListPageOptions extends AutomationListOptions {
  cursor?: string;
}

export interface AutomationListPageResult {
  items: AutomationQueryRecord[];
  nextCursor: string | null;
  totalCount: number;
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

function normalizeOptionalNullableRouteBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === null || typeof value === "boolean" ? value : undefined;
}

function requireStringValue(value: unknown, fieldName: string): string {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeAutomationActiveUntil(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = automationActiveUntilSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "activeUntil must be a valid ISO 8601 timestamp with an explicit offset.",
    );
  }

  return parsed.data;
}

function normalizeAutomationSupportKind(value: unknown): AutomationSupportKind | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !automationSupportKindValues.includes(value as AutomationSupportKind)
  ) {
    throw new Error(
      `supportKind must be one of ${automationSupportKindValues.join(", ")}.`,
    );
  }
  return value as AutomationSupportKind;
}

function normalizeDeviceActivityCursorEntityId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireStringValue(value, "schedule.afterEntityId");
}

function assertDeviceActivityCursorShape(input: {
  afterEntityId?: string;
  afterOccurredAt?: string;
}): void {
  const hasScalarOccurredAt = input.afterOccurredAt !== undefined;
  const hasScalarEntityId = input.afterEntityId !== undefined;
  if (hasScalarOccurredAt !== hasScalarEntityId) {
    throw new Error("schedule.afterOccurredAt and schedule.afterEntityId must be provided together.");
  }
}

function normalizeRecurringScheduleTimeZone(
  object: Record<string, unknown>,
): string | undefined {
  if (!Object.hasOwn(object, "timeZone") || object.timeZone === undefined) {
    return undefined;
  }

  const timeZone = requireStringValue(object.timeZone, "schedule.timeZone");
  const normalized = normalizeIanaTimeZone(timeZone);
  if (normalized === null) {
    throw new Error("schedule.timeZone must be a valid IANA timezone.");
  }

  return normalized;
}

function normalizeAutomationStatus(value: unknown): AutomationStatus {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (normalized && automationStatusValues.includes(normalized as AutomationStatus)) {
    return normalized as AutomationStatus;
  }

  return "active";
}

function normalizeAutomationContinuityPolicy(
  value: unknown,
): AutomationContinuityPolicy {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (normalized && automationContinuityPolicyValues.includes(normalized as AutomationContinuityPolicy)) {
    return normalized as AutomationContinuityPolicy;
  }

  return "preserve";
}

function normalizeDeviceActivitySource(value: unknown): AutomationDeviceActivitySource | undefined {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (!normalized) {
    return undefined;
  }
  if (!automationDeviceActivitySourceValues.includes(normalized as AutomationDeviceActivitySource)) {
    throw new Error("schedule.source must match a supported device activity source.");
  }
  return normalized as AutomationDeviceActivitySource;
}

function normalizeDeviceActivityKind(value: unknown): AutomationDeviceActivityKind | undefined {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (!normalized) {
    return undefined;
  }

  const parsed = automationDeviceActivityKindSchema.safeParse(normalizeDeviceActivityKindToken(normalized));
  if (!parsed.success) {
    throw new Error("schedule.activityKind must be a lowercase kebab-case device activity kind.");
  }
  return parsed.data;
}

function normalizeDeviceActivityKindToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeAutomationSchedule(value: unknown): AutomationSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("schedule must be an object.");
  }

  const object = value as Record<string, unknown>;
  const kind = requireStringValue(object.kind, "schedule.kind");
  if (!automationScheduleKindValues.includes(kind as AutomationScheduleKind)) {
    throw new Error("schedule.kind must match a supported automation schedule.");
  }

  switch (kind) {
    case "at": {
      const parsed = automationScheduleAtSchema.safeParse(object);
      if (!parsed.success) {
        throw new Error("schedule.at must be a valid ISO 8601 timestamp with an explicit offset.");
      }
      return parsed.data;
    }
    case "every": {
      const everyMs = typeof object.everyMs === "number" ? object.everyMs : Number(object.everyMs);
      if (!Number.isInteger(everyMs) || everyMs <= 0) {
        throw new Error("schedule.everyMs must be a positive integer.");
      }
      if (everyMs < MIN_AUTOMATION_EVERY_MS) {
        throw new Error("schedule.everyMs must be at least 60000 ms.");
      }

      return {
        kind,
        everyMs,
      };
    }
    case "cron": {
      const timeZone = normalizeRecurringScheduleTimeZone(object);
      return {
        kind,
        expression: requireStringValue(object.expression, "schedule.expression"),
        ...(timeZone === undefined ? {} : { timeZone }),
      };
    }
    case "dailyLocal": {
      const localTime = requireStringValue(object.localTime, "schedule.localTime");
      if (!dailyLocalTimePattern.test(localTime)) {
        throw new Error("schedule.localTime must use HH:MM format.");
      }

      const timeZone = normalizeRecurringScheduleTimeZone(object);

      return {
        kind,
        localTime,
        ...(timeZone === undefined ? {} : { timeZone }),
      };
    }
    case "deviceActivity": {
      const after = requireStringValue(object.after, "schedule.after");
      if (Number.isNaN(Date.parse(after))) {
        throw new Error("schedule.after must be a valid ISO timestamp.");
      }
      const afterOccurredAt = object.afterOccurredAt === undefined || object.afterOccurredAt === null
        ? undefined
        : requireStringValue(object.afterOccurredAt, "schedule.afterOccurredAt");
      if (afterOccurredAt && Number.isNaN(Date.parse(afterOccurredAt))) {
        throw new Error("schedule.afterOccurredAt must be a valid ISO timestamp.");
      }
      const afterEntityId = normalizeDeviceActivityCursorEntityId(object.afterEntityId);
      const source = normalizeDeviceActivitySource(object.source);
      const activityKind = normalizeDeviceActivityKind(object.activityKind);
      assertDeviceActivityCursorShape({
        afterEntityId,
        afterOccurredAt,
      });
      return {
        kind,
        after,
        ...(afterOccurredAt ? { afterOccurredAt } : {}),
        ...(afterEntityId ? { afterEntityId } : {}),
        ...(source ? { source } : {}),
        ...(activityKind ? { activityKind } : {}),
      };
    }
  }

  throw new Error("schedule.kind must match a supported automation schedule.");
}

function normalizeAutomationRoute(value: unknown): AutomationRoute {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("route must be an object.");
  }

  const object = value as Record<string, unknown>;
  const threadIsDirect = normalizeOptionalNullableRouteBoolean(object.threadIsDirect);
  return {
    channel: requireStringValue(object.channel, "route.channel"),
    deliverySource: normalizeAutomationRouteDeliverySource(object.deliverySource),
    deliveryTarget: normalizeNullableRouteString(object.deliveryTarget),
    identityId: normalizeNullableRouteString(object.identityId),
    participantId: normalizeNullableRouteString(object.participantId),
    threadId: normalizeNullableRouteString(object.threadId),
    ...(threadIsDirect !== undefined ? { threadIsDirect } : {}),
  };
}

function normalizeAutomationAssistantTargetOverride(
  value: unknown,
): AutomationAssistantTargetOverride | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("assistantTargetOverride must be an object.");
  }

  const object = value as Record<string, unknown>;
  const model = normalizeAutomationAssistantTargetOverrideString(object.model);
  const modelProvider = normalizeAutomationAssistantTargetOverrideString(object.modelProvider);
  const reasoningEffort = normalizeAutomationAssistantTargetOverrideReasoningEffort(
    object.reasoningEffort,
  );
  const target: AutomationAssistantTargetOverride = {
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };

  return Object.keys(target).length > 0 ? target : null;
}

function normalizeAutomationAssistantTargetOverrideString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("assistantTargetOverride values must be strings when provided.");
  }

  return normalizeNullableString(value);
}

function normalizeAutomationAssistantTargetOverrideReasoningEffort(
  value: unknown,
): AutomationAssistantReasoningEffort | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("assistantTargetOverride.reasoningEffort must be a string.");
  }

  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  if (
    !assistantReasoningEffortValues.includes(
      normalized as AutomationAssistantReasoningEffort,
    )
  ) {
    throw new Error(
      `assistantTargetOverride.reasoningEffort must be one of ${assistantReasoningEffortValues.join(", ")}.`,
    );
  }

  return normalized as AutomationAssistantReasoningEffort;
}

function normalizeAutomationRouteDeliverySource(
  value: unknown,
): AutomationRoute["deliverySource"] {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route.deliverySource must be an object.");
  }

  const object = value as Record<string, unknown>;
  const kind = requireStringValue(object.kind, "route.deliverySource.kind");
  if (kind !== "linq") {
    throw new Error("route.deliverySource.kind must be linq.");
  }

  return {
    fromPhoneNumber: requireStringValue(
      object.fromPhoneNumber,
      "route.deliverySource.fromPhoneNumber",
    ),
    kind,
  };
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = [...new Set(
    value.flatMap((entry) => {
      const tag = normalizeNullableString(typeof entry === "string" ? entry : null);
      return tag ? [tag] : [];
    }),
  )];
  const supportSeriesTags = tags.filter((tag) =>
    tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)
  );
  if (supportSeriesTags.some((tag) => parseAutomationSupportSeriesTag(tag) === null)) {
    throw new Error("Support series tags must use a valid canonical support series id.");
  }
  if (supportSeriesTags.length > 1) {
    throw new Error("An automation may belong to at most one support series.");
  }

  return tags;
}

function normalizeInstructions(body: string): string {
  const instructions = body.replace(/\s+$/u, "");
  if (!instructions.trim()) {
    throw new Error("instructions body must contain text.");
  }

  return instructions;
}

function parseAutomationRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): AutomationQueryRecord {
  if (
    attributes.schemaVersion !== AUTOMATION_SCHEMA_VERSION ||
    attributes.docType !== AUTOMATION_DOC_TYPE
  ) {
    throw new Error("Automation registry document has an unexpected shape.");
  }

  const parsed = parseFrontmatterDocument(markdown);
  const schedule = normalizeAutomationSchedule(attributes.schedule);
  const activeUntil = normalizeAutomationActiveUntil(attributes.activeUntil);
  if (
    activeUntil !== null &&
    schedule.kind === "at" &&
    Date.parse(activeUntil) <= Date.parse(schedule.at)
  ) {
    throw new Error("activeUntil must be after schedule.at for a one-shot automation.");
  }

  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: requireStringValue(attributes.automationId, "automationId"),
    slug: requireStringValue(attributes.slug, "slug"),
    title: requireStringValue(attributes.title, "title"),
    status: normalizeAutomationStatus(attributes.status),
    summary: normalizeNullableString(typeof attributes.summary === "string" ? attributes.summary : null),
    activeUntil,
    schedule,
    route: normalizeAutomationRoute(attributes.route),
    assistantTargetOverride: normalizeAutomationAssistantTargetOverride(
      attributes.assistantTargetOverride,
    ),
    supportKind: normalizeAutomationSupportKind(attributes.supportKind),
    continuityPolicy: normalizeAutomationContinuityPolicy(attributes.continuityPolicy),
    tags: normalizeTags(attributes.tags),
    createdAt: requireStringValue(attributes.createdAt, "createdAt"),
    updatedAt: requireStringValue(attributes.updatedAt, "updatedAt"),
    instructions: normalizeInstructions(parsed.body),
    relativePath,
    markdown,
  };
}

async function loadAutomationRecords(vaultRoot: string): Promise<AutomationQueryRecord[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, AUTOMATIONS_DIRECTORY, ".md");
  const records: AutomationQueryRecord[] = [];

  for (
    let offset = 0;
    offset < relativePaths.length;
    offset += AUTOMATION_DOCUMENT_READ_CONCURRENCY
  ) {
    const outcomes = await Promise.allSettled(
      relativePaths
        .slice(offset, offset + AUTOMATION_DOCUMENT_READ_CONCURRENCY)
        .map(async (relativePath) => {
          const document = await readMarkdownDocument(vaultRoot, relativePath);
          return parseAutomationRecord(document.attributes, relativePath, document.markdown);
        }),
    );

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
      records.push(outcome.value);
    }
  }

  return records.sort((left, right) =>
    compareNullableStrings(left.title, right.title) ||
    compareNullableStrings(left.slug, right.slug) ||
    compareNullableStrings(left.automationId, right.automationId),
  );
}

function matchesAutomationText(record: AutomationQueryRecord, text: string | undefined): boolean {
  if (!normalizeNullableString(text)) {
    return true;
  }

  return matchesText(
    [
      record.automationId,
      record.slug,
      record.title,
      record.summary,
      record.activeUntil,
      record.instructions,
      record.createdAt,
      record.updatedAt,
      record.status,
      record.continuityPolicy,
      JSON.stringify(record.schedule),
      JSON.stringify(record.route),
      record.supportKind,
      JSON.stringify(record.assistantTargetOverride),
      record.tags,
    ],
    text,
  );
}

function matchesAutomationStatus(
  value: string | null | undefined,
  status: string | string[] | undefined,
): boolean {
  return matchesStatus(value, status);
}

function matchesAutomationExactTag(
  record: AutomationQueryRecord,
  exactTag: string | undefined,
): boolean {
  const normalized = normalizeNullableString(exactTag);
  return normalized === null || record.tags.includes(normalized);
}

function filterAutomationRecords(
  records: readonly AutomationQueryRecord[],
  options: AutomationListOptions,
): AutomationQueryRecord[] {
  return records.filter((record) =>
    matchesAutomationStatus(record.status, options.status) &&
    matchesAutomationExactTag(record, options.exactTag) &&
    matchesAutomationText(record, options.text)
  );
}

export async function listAutomations(
  vaultRoot: string,
  options: AutomationListOptions = {},
): Promise<AutomationQueryRecord[]> {
  const records = await loadAutomationRecords(vaultRoot);
  const filtered = filterAutomationRecords(records, options);

  return applyLimit(filtered, options.limit);
}

export async function listAutomationPage(
  vaultRoot: string,
  options: AutomationListPageOptions = {},
): Promise<AutomationListPageResult> {
  const records = await loadAutomationRecords(vaultRoot);
  const filtered = filterAutomationRecords(records, options);
  const stablePagination = Boolean(
    normalizeNullableString(options.exactTag) || normalizeNullableString(options.cursor),
  );
  if (stablePagination) {
    filtered.sort((left, right) => left.automationId.localeCompare(right.automationId));
  }
  const cursor = normalizeNullableString(options.cursor);
  const afterCursor = cursor === null
    ? filtered
    : filtered.filter((record) => record.automationId.localeCompare(cursor) > 0);
  const limit = Number.isInteger(options.limit) && options.limit !== undefined && options.limit > 0
    ? options.limit
    : afterCursor.length;
  const items = afterCursor.slice(0, limit);
  const nextCursor = stablePagination && afterCursor.length > items.length
    ? items.at(-1)?.automationId ?? null
    : null;

  return {
    items,
    nextCursor,
    totalCount: filtered.length,
  };
}

export async function readAutomation(
  vaultRoot: string,
  automationId: string,
): Promise<AutomationQueryRecord | null> {
  const records = await loadAutomationRecords(vaultRoot);
  return records.find((record) => record.automationId === automationId) ?? null;
}

export async function readAutomationByRelativePath(
  vaultRoot: string,
  relativePath: string,
): Promise<AutomationQueryRecord | null> {
  const normalizedPath = normalizeAutomationRelativePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const outcome = await readOptionalMarkdownDocumentOutcome(vaultRoot, normalizedPath);
  if (!outcome) {
    return null;
  }
  if (!outcome.ok) {
    throw new Error(`Failed to parse automation at ${outcome.relativePath}: ${outcome.reason}`);
  }

  return parseAutomationRecord(
    outcome.document.attributes,
    outcome.document.relativePath,
    outcome.document.markdown,
  );
}

export async function showAutomation(
  vaultRoot: string,
  lookup: string,
): Promise<AutomationQueryRecord | null> {
  const records = await loadAutomationRecords(vaultRoot);
  const normalized = lookup.trim().toLowerCase();
  return (
    records.find((record) =>
      matchesLookup(normalized, record.automationId, record.slug, record.title)
    ) ?? null
  );
}

function normalizeAutomationRelativePath(relativePath: string): string | null {
  const normalized = relativePath.trim();
  if (
    normalized.length === 0 ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    !normalized.startsWith(`${AUTOMATIONS_DIRECTORY}/`) ||
    !normalized.endsWith(".md")
  ) {
    return null;
  }

  return normalized;
}
