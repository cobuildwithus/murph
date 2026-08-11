import { isDeepStrictEqual } from "node:util";

import {
  AUTOMATION_DOC_TYPE,
  AUTOMATION_SCHEMA_VERSION,
  AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  AUTOMATION_SUPPORT_SERIES_TAG_PREFIX,
  MIN_AUTOMATION_EVERY_MS,
  assistantReasoningEffortValues,
  automationActiveUntilSchema,
  automationFrontmatterSchema,
  automationContinuityPolicyValues,
  automationDeviceActivityKindSchema,
  automationDeviceActivitySourceValues,
  automationScheduleKindValues,
  automationStatusValues,
  automationSupportKindValues,
  buildAutomationSupportSeriesTag,
  compareDeviceActivityCoverageKeys,
  isValidAutomationCronExpression,
  normalizeIanaTimeZone,
  parseAutomationSupportSeriesTag,
  resolveNextDeviceActivityCoverageCursor,
  type AutomationAssistantTargetOverride,
  type AutomationContinuityPolicy,
  type AutomationDeviceActivityKind,
  type AutomationDeviceActivitySource,
  type AutomationRoute,
  type AutomationSchedule,
  type AutomationScheduleKind,
  type AutomationScaffoldPayload as ContractAutomationScaffoldPayload,
  type AutomationStatus,
  type AutomationSupportKind,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "./constants.ts";
import { generateRecordId } from "./ids.ts";
import { VaultError } from "./errors.ts";
import { readUtf8File, walkVaultFilesInterruptible } from "./fs.ts";
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
import { commitAuditedCanonicalWrite } from "./audited-write.ts";
import { stageMarkdownDocumentWrite } from "./markdown-documents.ts";
import type { FrontmatterObject } from "./types.ts";
import { normalizeAutomationAvailabilityForSchedule } from "./automation-availability.ts";

const AUTOMATIONS_DIRECTORY = VAULT_LAYOUT.automationsDirectory;
const MAX_AUTOMATION_SUPPORT_SERIES_RECONCILIATION_RECORDS = 4_096;
const automationRegistryResource = canonicalLogicalResource(
  "bank/automations",
  AUTOMATIONS_DIRECTORY,
);
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

class AutomationSupportSeriesReconciliationYieldError extends Error {
  constructor() {
    super("Automation support-series reconciliation yielded to foreground work.");
    this.name = "AutomationSupportSeriesReconciliationYieldError";
  }
}

function normalizeRecurringScheduleTimeZone(
  object: Record<string, unknown>,
): string | undefined {
  if (!Object.hasOwn(object, "timeZone") || object.timeZone === undefined) {
    return undefined;
  }

  const requested = requireString(object.timeZone, "schedule.timeZone", 128);
  const normalized = normalizeIanaTimeZone(requested);
  if (!normalized) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "schedule.timeZone must be a valid IANA timezone.",
    );
  }
  return normalized;
}

export type {
  AutomationAssistantTargetOverride,
  AutomationContinuityPolicy,
  AutomationRoute,
  AutomationSchedule,
  AutomationStatus,
  AutomationSupportKind,
};

export interface AutomationRecord {
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
  scheduleAnchorAt?: string;
  updatedAt: string;
  instructions: string;
  relativePath: string;
  markdown: string;
}

export function resolveAutomationUpsertSlug(input: {
  slug?: string;
  title: string;
}): string {
  return normalizeSlug(
    input.slug,
    "slug",
    normalizeAutomationTitle(input.title),
  );
}

export type AutomationScaffoldPayload = ContractAutomationScaffoldPayload;

export interface UpsertAutomationInput extends AutomationScaffoldPayload {
  allowSlugRename?: boolean;
  automationId?: string;
  createOnly?: boolean;
  now?: Date;
  vaultRoot: string;
}

export interface UpsertAutomationResult {
  auditPath: string;
  created: boolean;
  record: AutomationRecord;
}

export interface PatchAutomationInput {
  activeUntil?: string | null;
  continuityPolicy?: AutomationContinuityPolicy;
  expectedUpdatedAt?: string;
  instructions?: string;
  lookup: string;
  now?: Date;
  route?: AutomationRoute;
  assistantTargetOverride?: AutomationAssistantTargetOverride | null;
  supportKind?: AutomationSupportKind | null;
  schedule?: AutomationSchedule;
  slug?: string;
  status?: AutomationStatus;
  summary?: string | null;
  tags?: string[];
  title?: string;
  vaultRoot: string;
}

export interface AdvanceAutomationDeviceActivityCursorInput {
  after: string;
  afterEntityId: string;
  afterOccurredAt: string;
  expectedActivityKind?: AutomationDeviceActivityKind;
  expectedContinuityPolicy: AutomationContinuityPolicy;
  expectedInstructions: string;
  expectedRoute: AutomationRoute;
  expectedSource?: AutomationDeviceActivitySource;
  lookup: string;
  now?: Date;
  vaultRoot: string;
}

export interface AdvanceAutomationDeviceActivityCursorResult {
  advanced: boolean;
  record: AutomationRecord;
}

export interface ReadAutomationInput {
  automationId?: string;
  slug?: string;
  vaultRoot: string;
}

export interface ListAutomationInput {
  exactTag?: string;
  limit?: number;
  status?: string | string[];
  text?: string;
  vaultRoot: string;
}

export interface ListAutomationResult {
  items: AutomationRecord[];
  count: number;
}

export interface ArchiveAutomationIfActiveUntilElapsedInput {
  expectedUpdatedAt?: string;
  lookup: string;
  now?: Date;
  vaultRoot: string;
}

export interface ArchiveAutomationIfActiveUntilElapsedResult {
  archived: boolean;
  record: AutomationRecord;
}

export interface ReconcileAutomationSupportSeriesInput {
  desiredAutomationIds: readonly string[];
  now?: Date;
  shouldYield?: (() => boolean) | null;
  supportSeriesTag: string;
  vaultRoot: string;
}

export interface AutomationSupportSeriesDesiredState {
  desiredAutomationIds: readonly string[];
  supportSeriesTag: string;
}

export interface ReconcileAutomationSupportSeriesNamespaceInput {
  desiredSeries: readonly AutomationSupportSeriesDesiredState[];
  now?: Date;
  seriesIdPrefix: string;
  shouldYield?: (() => boolean) | null;
  vaultRoot: string;
}

export interface ReconcileAutomationSupportSeriesResult {
  archivedCount: number;
  auditPath: string | null;
  matchedCount: number;
  missingDesiredAutomationIds: string[];
  unchangedCount: number;
  yielded?: true;
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

function normalizeAutomationStatus(value: unknown): AutomationStatus {
  return optionalEnum(value, automationStatusValues, "status") ?? "active";
}

function normalizeAutomationContinuityPolicy(
  value: unknown,
): AutomationContinuityPolicy {
  return optionalEnum(value, automationContinuityPolicyValues, "continuityPolicy") ?? "preserve";
}

function normalizeAutomationSupportKind(
  value: unknown,
): AutomationSupportKind | null {
  return optionalEnum(value, automationSupportKindValues, "supportKind") ?? null;
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

function normalizeAutomationDeviceActivityCursorEntityId(value: unknown): string | undefined {
  return optionalString(value, "schedule.afterEntityId", 240) ?? undefined;
}

function assertAutomationDeviceActivityCursorShape(input: {
  afterEntityId?: string;
  afterOccurredAt?: string;
}): void {
  const hasScalarOccurredAt = input.afterOccurredAt !== undefined;
  const hasScalarEntityId = input.afterEntityId !== undefined;
  if (hasScalarOccurredAt !== hasScalarEntityId) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "schedule.afterOccurredAt and schedule.afterEntityId must be provided together.",
    );
  }
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

function normalizeAutomationActiveUntil(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = automationActiveUntilSchema.safeParse(value);
  if (!parsed.success) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "activeUntil must be a valid ISO 8601 timestamp with an explicit offset.",
    );
  }

  return parsed.data;
}

function assertAutomationActiveUntilMatchesSchedule(input: {
  activeUntil: string | null;
  schedule: AutomationSchedule;
}): void {
  if (
    input.activeUntil !== null &&
    input.schedule.kind === "at" &&
    Date.parse(input.activeUntil) <= Date.parse(input.schedule.at)
  ) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "activeUntil must be after schedule.at for a one-shot automation.",
    );
  }
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
      const timeZone = normalizeRecurringScheduleTimeZone(object);
      const expression = requireString(object.expression, "schedule.expression", 400);
      if (!isValidAutomationCronExpression(expression)) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.expression must be a valid five-field cron expression.");
      }

      return {
        kind,
        expression,
        ...(timeZone ? { timeZone } : {}),
      };
    }
    case "dailyLocal": {
      const localTime = requireString(object.localTime, "schedule.localTime", 5);
      if (!dailyLocalTimePattern.test(localTime)) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.localTime must use HH:MM format.");
      }

      const timeZone = normalizeRecurringScheduleTimeZone(object);

      return {
        kind,
        localTime,
        ...(timeZone ? { timeZone } : {}),
      };
    }
    case "deviceActivity": {
      const source = normalizeAutomationDeviceActivitySource(object.source);
      const activityKind = normalizeAutomationDeviceActivityKind(object.activityKind);
      const afterOccurredAt = object.afterOccurredAt === undefined || object.afterOccurredAt === null
        ? undefined
        : normalizeAutomationIsoTimestamp(object.afterOccurredAt, "schedule.afterOccurredAt");
      const afterEntityId = normalizeAutomationDeviceActivityCursorEntityId(object.afterEntityId);
      assertAutomationDeviceActivityCursorShape({
        afterEntityId,
        afterOccurredAt,
      });

      return {
        kind,
        after: normalizeAutomationIsoTimestamp(object.after, "schedule.after"),
        ...(afterOccurredAt ? { afterOccurredAt } : {}),
        ...(afterEntityId ? { afterEntityId } : {}),
        ...(source ? { source } : {}),
        ...(activityKind ? { activityKind } : {}),
      };
    }
  }

  throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
}

function normalizeAutomationRoute(value: unknown): AutomationRoute {
  const object = requireObject(value, "route");
  const threadIsDirect = normalizeOptionalNullableRouteBoolean(object.threadIsDirect);

  return {
    channel: normalizeAutomationRouteChannel(object.channel),
    deliverySource: normalizeAutomationRouteDeliverySource(object.deliverySource),
    deliveryTarget: normalizeNullableRouteString(object.deliveryTarget),
    identityId: normalizeNullableRouteString(object.identityId),
    participantId: normalizeNullableRouteString(object.participantId),
    threadId: normalizeNullableRouteString(object.threadId),
    ...(threadIsDirect !== undefined ? { threadIsDirect } : {}),
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

function resolveAutomationPatchSchedule(input: {
  existing: AutomationSchedule;
  replacement: AutomationSchedule;
}): AutomationSchedule {
  const replacement = normalizeAutomationSchedule(input.replacement);
  if (
    (replacement.kind !== "cron" && replacement.kind !== "dailyLocal")
    || replacement.timeZone !== undefined
    || (input.existing.kind !== "cron" && input.existing.kind !== "dailyLocal")
    || input.existing.timeZone === undefined
  ) {
    return replacement;
  }

  return {
    ...replacement,
    timeZone: input.existing.timeZone,
  };
}

function normalizeAutomationAssistantTargetOverride(
  value: unknown,
): AutomationAssistantTargetOverride | null {
  if (value === undefined || value === null) {
    return null;
  }

  const object = requireObject(value, "assistantTargetOverride");
  const model = normalizeAutomationAssistantTargetOverrideString(
    object.model,
    "assistantTargetOverride.model",
    200,
  );
  const modelProvider = normalizeAutomationAssistantTargetOverrideString(
    object.modelProvider,
    "assistantTargetOverride.modelProvider",
    120,
  );
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

function normalizeAutomationAssistantTargetOverrideReasoningEffort(
  value: unknown,
): AutomationAssistantTargetOverride["reasoningEffort"] | null {
  return optionalEnum(
    value,
    assistantReasoningEffortValues,
    "assistantTargetOverride.reasoningEffort",
  ) ?? null;
}

function normalizeAutomationAssistantTargetOverrideString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireString(value, fieldName, maxLength);
}

function buildAutomationAssistantTargetOverrideFrontmatter(
  target: AutomationAssistantTargetOverride,
): FrontmatterObject {
  return {
    ...(target.model ? { model: target.model } : {}),
    ...(target.modelProvider ? { modelProvider: target.modelProvider } : {}),
    ...(target.reasoningEffort ? { reasoningEffort: target.reasoningEffort } : {}),
  };
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

  const supportSeriesTags = tags.filter((tag) =>
    tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)
  );
  if (supportSeriesTags.some((tag) => parseAutomationSupportSeriesTag(tag) === null)) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "Support series tags must use a valid canonical support series id.",
    );
  }
  if (supportSeriesTags.length > 1) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "An automation may belong to at most one support series.",
    );
  }

  return tags;
}

function resolveAutomationSupportSeriesTag(tags: readonly string[]): string | null {
  return tags.find((tag) => parseAutomationSupportSeriesTag(tag) !== null) ?? null;
}

function assertAutomationSupportSeriesOwnershipPreserved(input: {
  existingRecord: AutomationRecord | null;
  nextTags: readonly string[];
}): void {
  if (!input.existingRecord) {
    return;
  }

  const existingTag = resolveAutomationSupportSeriesTag(input.existingRecord.tags);
  const nextTag = resolveAutomationSupportSeriesTag(input.nextTags);
  // A legacy managed automation may be assigned to its first support series.
  // Once assigned, ownership is immutable across ordinary upserts and patches.
  if (existingTag !== null && existingTag !== nextTag) {
    throw new VaultError(
      "VAULT_AUTOMATION_SUPPORT_SERIES_IMMUTABLE",
      "Automation support series ownership cannot be removed or replaced.",
    );
  }
}

function assertAutomationReconciledArchiveMarkerNotForged(input: {
  existingRecord: AutomationRecord | null;
  requestedTags: readonly string[];
}): void {
  const markerWasPersisted = input.existingRecord?.tags.includes(
    AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  ) === true;
  if (
    !markerWasPersisted &&
    input.requestedTags.includes(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG)
  ) {
    throw new VaultError(
      "VAULT_AUTOMATION_RECONCILIATION_MARKER_RESERVED",
      "The automation reconciliation archive marker is reserved for internal reconciliation.",
    );
  }
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
        ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
      };
    case "dailyLocal":
      return {
        kind: schedule.kind,
        localTime: schedule.localTime,
        ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
      };
    case "deviceActivity":
      return {
        kind: schedule.kind,
        after: schedule.after,
        ...(schedule.afterOccurredAt ? { afterOccurredAt: schedule.afterOccurredAt } : {}),
        ...(schedule.afterEntityId ? { afterEntityId: schedule.afterEntityId } : {}),
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
    ...(route.threadIsDirect !== undefined
      ? { threadIsDirect: route.threadIsDirect }
      : {}),
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
    ...(record.activeUntil === null ? {} : { activeUntil: record.activeUntil }),
    schedule: buildAutomationScheduleFrontmatter(record.schedule),
    route: buildAutomationRouteFrontmatter(record.route),
    ...(record.assistantTargetOverride === null
      ? {}
      : {
          assistantTargetOverride: buildAutomationAssistantTargetOverrideFrontmatter(
            record.assistantTargetOverride,
          ),
        }),
    ...(record.supportKind === null ? {} : { supportKind: record.supportKind }),
    continuityPolicy: record.continuityPolicy,
    tags: record.tags,
    createdAt: record.createdAt,
    scheduleAnchorAt: record.scheduleAnchorAt ?? record.createdAt,
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

  const schedule = normalizeAutomationSchedule(attributes.schedule);
  const activeUntil = normalizeAutomationActiveUntil(attributes.activeUntil);
  assertAutomationActiveUntilMatchesSchedule({ activeUntil, schedule });

  const createdAt = requireString(attributes.createdAt, "createdAt", 64);

  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: requireString(attributes.automationId, "automationId", 64),
    slug: normalizeSlug(attributes.slug, "slug"),
    title: normalizeAutomationTitle(attributes.title),
    status: normalizeAutomationStatus(attributes.status),
    summary: normalizeAutomationSummary(attributes.summary),
    activeUntil,
    schedule,
    route: normalizeAutomationRoute(attributes.route),
    assistantTargetOverride: normalizeAutomationAssistantTargetOverride(
      attributes.assistantTargetOverride,
    ),
    supportKind: normalizeAutomationSupportKind(attributes.supportKind),
    continuityPolicy: normalizeAutomationContinuityPolicy(attributes.continuityPolicy),
    tags: normalizeAutomationTags(attributes.tags),
    createdAt,
    scheduleAnchorAt: normalizeAutomationIsoTimestamp(
      attributes.scheduleAnchorAt ?? createdAt,
      "scheduleAnchorAt",
    ),
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

  return sortAutomationRecords(records);
}

function sortAutomationRecords(records: AutomationRecord[]): AutomationRecord[] {
  return records.sort((left, right) =>
    left.title.localeCompare(right.title) ||
    left.slug.localeCompare(right.slug) ||
    left.automationId.localeCompare(right.automationId),
  );
}

async function loadAutomationRecordsForSupportSeriesReconciliation(input: {
  shouldYield: (() => boolean) | null;
  vaultRoot: string;
}): Promise<{ records: AutomationRecord[]; yielded: boolean }> {
  if (input.shouldYield?.() === true) {
    return { records: [], yielded: true };
  }
  const walked = await walkVaultFilesInterruptible(
    input.vaultRoot,
    AUTOMATIONS_DIRECTORY,
    {
      extension: ".md",
      maxMatches: MAX_AUTOMATION_SUPPORT_SERIES_RECONCILIATION_RECORDS + 1,
      shouldContinue: () => input.shouldYield?.() !== true,
    },
  );
  if (walked.interrupted || input.shouldYield?.() === true) {
    return { records: [], yielded: true };
  }
  if (walked.relativePaths.length > MAX_AUTOMATION_SUPPORT_SERIES_RECONCILIATION_RECORDS) {
    throw new VaultError(
      "VAULT_AUTOMATION_RECONCILIATION_LIMIT_EXCEEDED",
      "Automation support-series reconciliation exceeded its bounded registry limit.",
      { maxRecords: MAX_AUTOMATION_SUPPORT_SERIES_RECONCILIATION_RECORDS },
    );
  }

  const records: AutomationRecord[] = [];
  for (const relativePath of walked.relativePaths) {
    if (input.shouldYield?.() === true) {
      return { records: [], yielded: true };
    }
    const markdown = await readUtf8File(input.vaultRoot, relativePath);
    if (input.shouldYield?.() === true) {
      return { records: [], yielded: true };
    }
    const document = parseFrontmatterDocument(markdown);
    records.push(parseAutomationRecord(document.attributes, relativePath, markdown));
  }

  if (input.shouldYield?.() === true) {
    return { records: [], yielded: true };
  }
  return { records: sortAutomationRecords(records), yielded: false };
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
    record.activeUntil,
    record.instructions,
    JSON.stringify(record.schedule),
    JSON.stringify(record.route),
    JSON.stringify(record.assistantTargetOverride),
    record.supportKind,
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

function matchesAutomationExactTag(
  record: AutomationRecord,
  exactTag: string | undefined,
): boolean {
  const normalized = normalizeNullableString(exactTag);
  return normalized === null || record.tags.includes(normalized);
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
    assistantTargetOverride: null,
    supportKind: null,
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
    matchesAutomationExactTag(record, input.exactTag) &&
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
    if (
      input.expectedUpdatedAt !== undefined
      && input.expectedUpdatedAt !== existingRecord.updatedAt
    ) {
      throw new VaultError(
        "VAULT_AUTOMATION_CONFLICT",
        "Automation changed before the patch could be applied.",
      );
    }
    return upsertAutomationWithLatestRegistry({
      activeUntil:
        input.activeUntil === undefined
          ? existingRecord.activeUntil
          : input.activeUntil,
      automationId: existingRecord.automationId,
      continuityPolicy: input.continuityPolicy ?? existingRecord.continuityPolicy,
      instructions: input.instructions ?? existingRecord.instructions,
      now: input.now,
      route: input.route ?? existingRecord.route,
      assistantTargetOverride:
        input.assistantTargetOverride === undefined
          ? existingRecord.assistantTargetOverride
          : normalizeAutomationAssistantTargetOverride(input.assistantTargetOverride),
      supportKind:
        input.supportKind === undefined
          ? existingRecord.supportKind
          : normalizeAutomationSupportKind(input.supportKind),
      schedule: input.schedule === undefined
        ? existingRecord.schedule
        : resolveAutomationPatchSchedule({
            existing: existingRecord.schedule,
            replacement: input.schedule,
          }),
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

export async function archiveAutomationIfActiveUntilElapsed(
  input: ArchiveAutomationIfActiveUntilElapsedInput,
): Promise<ArchiveAutomationIfActiveUntilElapsedResult> {
  return withAutomationRegistryLock(input.vaultRoot, async () => {
    const records = await loadAutomationRecords(input.vaultRoot);
    const existingRecord = selectAutomationRecord(records, {
      automationId: input.lookup,
      slug: input.lookup,
    });
    if (!existingRecord) {
      throw new VaultError("VAULT_AUTOMATION_MISSING", "Automation was not found.");
    }

    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) {
      throw new VaultError("VAULT_INVALID_INPUT", "now must be a valid Date.");
    }
    const activeUntilMs = existingRecord.activeUntil === null
      ? Number.NaN
      : Date.parse(existingRecord.activeUntil);
    const expectedUpdatedAtMatches = input.expectedUpdatedAt === undefined ||
      input.expectedUpdatedAt === existingRecord.updatedAt;
    if (
      !expectedUpdatedAtMatches ||
      existingRecord.status !== "active" ||
      !Number.isFinite(activeUntilMs) ||
      nowMs < activeUntilMs
    ) {
      return {
        archived: false,
        record: existingRecord,
      };
    }

    const archived = await upsertAutomationWithLatestRegistry({
      activeUntil: existingRecord.activeUntil,
      automationId: existingRecord.automationId,
      assistantTargetOverride: existingRecord.assistantTargetOverride,
      continuityPolicy: existingRecord.continuityPolicy,
      instructions: existingRecord.instructions,
      now,
      route: existingRecord.route,
      schedule: existingRecord.schedule,
      slug: existingRecord.slug,
      status: "archived",
      summary: existingRecord.summary,
      tags: existingRecord.tags,
      title: existingRecord.title,
      vaultRoot: input.vaultRoot,
    }, records);

    return {
      archived: true,
      record: archived.record,
    };
  });
}

function yieldedAutomationSupportSeriesReconciliationResult(): ReconcileAutomationSupportSeriesResult {
  return {
    archivedCount: 0,
    auditPath: null,
    matchedCount: 0,
    missingDesiredAutomationIds: [],
    unchangedCount: 0,
    yielded: true,
  };
}

function assertAutomationSupportSeriesReconciliationCanContinue(
  shouldYield: (() => boolean) | null,
): void {
  if (shouldYield?.() === true) {
    throw new AutomationSupportSeriesReconciliationYieldError();
  }
}

export async function reconcileAutomationSupportSeries(
  input: ReconcileAutomationSupportSeriesInput,
): Promise<ReconcileAutomationSupportSeriesResult> {
  if (input.shouldYield?.() === true) {
    return yieldedAutomationSupportSeriesReconciliationResult();
  }
  const supportSeriesTag = requireAutomationSupportSeriesTag(input.supportSeriesTag);
  return withAutomationRegistryLock(input.vaultRoot, async () => {
    const loaded = await loadAutomationRecordsForSupportSeriesReconciliation({
      shouldYield: input.shouldYield ?? null,
      vaultRoot: input.vaultRoot,
    });
    if (loaded.yielded) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    return reconcileAutomationSupportSeriesRecords({
      desiredBySupportSeriesTag: new Map([
        [supportSeriesTag, normalizeAutomationIdSet(input.desiredAutomationIds)],
      ]),
      matchesScope: (tag) => tag === supportSeriesTag,
      now: input.now ?? new Date(),
      records: loaded.records,
      shouldYield: input.shouldYield ?? null,
      scopeLabel: supportSeriesTag,
      vaultRoot: input.vaultRoot,
    });
  });
}

export async function reconcileAutomationSupportSeriesNamespace(
  input: ReconcileAutomationSupportSeriesNamespaceInput,
): Promise<ReconcileAutomationSupportSeriesResult> {
  if (input.shouldYield?.() === true) {
    return yieldedAutomationSupportSeriesReconciliationResult();
  }
  const seriesIdPrefix = normalizeAutomationSupportSeriesIdPrefix(input.seriesIdPrefix);
  const desiredBySupportSeriesTag = new Map<string, Set<string>>();
  const desiredOwnerByAutomationId = new Map<string, string>();
  for (const desired of input.desiredSeries) {
    if (input.shouldYield?.() === true) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    const tag = requireAutomationSupportSeriesTag(desired.supportSeriesTag);
    const parsed = parseAutomationSupportSeriesTag(tag);
    if (!parsed || !parsed.seriesId.startsWith(seriesIdPrefix)) {
      throw new VaultError(
        "VAULT_INVALID_INPUT",
        `Support series tag must be inside the ${seriesIdPrefix} namespace.`,
      );
    }
    if (desiredBySupportSeriesTag.has(tag)) {
      throw new VaultError(
        "VAULT_INVALID_INPUT",
        `Support series desired state contains duplicate tag ${tag}.`,
      );
    }
    const desiredAutomationIds = normalizeAutomationIdSet(desired.desiredAutomationIds);
    for (const automationId of desiredAutomationIds) {
      if (input.shouldYield?.() === true) {
        return yieldedAutomationSupportSeriesReconciliationResult();
      }
      const existingOwner = desiredOwnerByAutomationId.get(automationId);
      if (existingOwner && existingOwner !== tag) {
        throw new VaultError(
          "VAULT_INVALID_INPUT",
          `Automation ${automationId} cannot be desired by multiple support series.`,
        );
      }
      desiredOwnerByAutomationId.set(automationId, tag);
    }
    desiredBySupportSeriesTag.set(tag, desiredAutomationIds);
  }

  return withAutomationRegistryLock(input.vaultRoot, async () => {
    const loaded = await loadAutomationRecordsForSupportSeriesReconciliation({
      shouldYield: input.shouldYield ?? null,
      vaultRoot: input.vaultRoot,
    });
    if (loaded.yielded) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    return reconcileAutomationSupportSeriesRecords({
      desiredBySupportSeriesTag,
      matchesScope: (tag) => {
        const parsed = parseAutomationSupportSeriesTag(tag);
        return parsed !== null && parsed.seriesId.startsWith(seriesIdPrefix);
      },
      now: input.now ?? new Date(),
      records: loaded.records,
      shouldYield: input.shouldYield ?? null,
      scopeLabel: `${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}${seriesIdPrefix}*`,
      vaultRoot: input.vaultRoot,
    });
  });
}

async function reconcileAutomationSupportSeriesRecords(input: {
  desiredBySupportSeriesTag: ReadonlyMap<string, ReadonlySet<string>>;
  matchesScope: (tag: string) => boolean;
  now: Date;
  records: readonly AutomationRecord[];
  shouldYield: (() => boolean) | null;
  scopeLabel: string;
  vaultRoot: string;
}): Promise<ReconcileAutomationSupportSeriesResult> {
  if (input.shouldYield?.() === true) {
    return yieldedAutomationSupportSeriesReconciliationResult();
  }
  const matched: Array<{ record: AutomationRecord; tag: string }> = [];
  for (const record of input.records) {
    if (input.shouldYield?.() === true) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    const tag = resolveAutomationSupportSeriesTag(record.tags);
    if (tag !== null && input.matchesScope(tag)) {
      matched.push({ record, tag });
    }
  }
  const matchedDesiredKeys = new Set<string>();
  const stale: Array<{ record: AutomationRecord; tag: string }> = [];
  for (const { record, tag } of matched) {
    if (input.shouldYield?.() === true) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    const desiredIds = input.desiredBySupportSeriesTag.get(tag);
    if (desiredIds?.has(record.automationId)) {
      matchedDesiredKeys.add(`${tag}\0${record.automationId}`);
      continue;
    }
    // A user-paused automation stays paused until the user explicitly resumes
    // it. Only active records are owned by desired-state cleanup.
    if (record.status === "active") {
      stale.push({ record, tag });
    }
  }
  const missingDesiredAutomationIds: string[] = [];
  for (const [tag, ids] of input.desiredBySupportSeriesTag.entries()) {
    for (const automationId of ids) {
      if (input.shouldYield?.() === true) {
        return yieldedAutomationSupportSeriesReconciliationResult();
      }
      if (!matchedDesiredKeys.has(`${tag}\0${automationId}`)) {
        missingDesiredAutomationIds.push(automationId);
      }
    }
  }
  missingDesiredAutomationIds.sort((left, right) => left.localeCompare(right));

  if (stale.length === 0) {
    if (input.shouldYield?.() === true) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    return {
      archivedCount: 0,
      auditPath: null,
      matchedCount: matched.length,
      missingDesiredAutomationIds,
      unchangedCount: matched.length,
    };
  }

  const now = input.now.toISOString();
  const targetIds = stale.map(({ record }) => record.automationId);
  const assertCanContinue = () =>
    assertAutomationSupportSeriesReconciliationCanContinue(input.shouldYield);
  let committed: Awaited<ReturnType<typeof commitAuditedCanonicalWrite>>;
  try {
    committed = await commitAuditedCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "automation_support_series_reconcile",
      summary: `Reconcile automation support series ${input.scopeLabel}`,
      occurredAt: now,
      assertCanContinue,
      audit: {
        action: "automation_upsert",
        commandName: "core.reconcileAutomationSupportSeries",
        summary: `Archived ${stale.length} stale support-series automation(s).`,
        targetIds,
        occurredAt: now,
      },
      mutate: async ({ batch }) => {
        const changes = [];
        const files: string[] = [];
        for (const { record } of stale) {
          assertCanContinue();
          const archivedRecord: AutomationRecord = {
            ...record,
            status: "archived",
            tags: record.tags.includes(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG)
              ? record.tags
              : [...record.tags, AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG],
            updatedAt: now,
            markdown: "",
          };
          const write = await stageMarkdownDocumentWrite(
            batch,
            {
              created: false,
              relativePath: record.relativePath,
            },
            buildAutomationMarkdown(archivedRecord),
          );
          assertCanContinue();
          changes.push(...write.changes);
          files.push(write.relativePath);
        }

        return {
          result: undefined,
          changes,
          files,
          targetIds,
        };
      },
    });
  } catch (error) {
    if (error instanceof AutomationSupportSeriesReconciliationYieldError) {
      return yieldedAutomationSupportSeriesReconciliationResult();
    }
    throw error;
  }

  return {
    archivedCount: stale.length,
    auditPath: committed.auditPath,
    matchedCount: matched.length,
    missingDesiredAutomationIds,
    unchangedCount: matched.length - stale.length,
  };
}

function requireAutomationSupportSeriesTag(value: string): string {
  const normalized = value.trim();
  const parsed = parseAutomationSupportSeriesTag(normalized);
  if (!parsed || parsed.tag !== normalized) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `supportSeriesTag must use the ${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}<series-id> format.`,
    );
  }
  return parsed.tag;
}

function normalizeAutomationSupportSeriesIdPrefix(value: string): string {
  const normalized = value.trim();
  try {
    buildAutomationSupportSeriesTag(normalized);
  } catch {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      "seriesIdPrefix must use letters, numbers, colon, period, underscore, or hyphen.",
    );
  }
  return normalized;
}

function normalizeAutomationIdSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => requireString(value, "desiredAutomationIds", 240)));
}

export async function advanceAutomationDeviceActivityCursor(
  input: AdvanceAutomationDeviceActivityCursorInput,
): Promise<AdvanceAutomationDeviceActivityCursorResult> {
  const after = normalizeAutomationIsoTimestamp(input.after, "after");
  const afterOccurredAt = normalizeAutomationIsoTimestamp(input.afterOccurredAt, "afterOccurredAt");
  const afterEntityId = requireString(input.afterEntityId, "afterEntityId");

  return withAutomationRegistryLock(input.vaultRoot, async () => {
    const records = await loadAutomationRecords(input.vaultRoot);
    const existingRecord = selectAutomationRecord(records, {
      automationId: input.lookup,
      slug: input.lookup,
    });
    if (!existingRecord) {
      throw new VaultError("VAULT_AUTOMATION_MISSING", "Automation was not found.");
    }
    if (
      existingRecord.status !== "active" ||
      existingRecord.continuityPolicy !== input.expectedContinuityPolicy ||
      existingRecord.instructions !== input.expectedInstructions ||
      !automationRoutesEqual(existingRecord.route, input.expectedRoute) ||
      existingRecord.schedule.kind !== "deviceActivity" ||
      existingRecord.schedule.activityKind !== input.expectedActivityKind ||
      existingRecord.schedule.source !== input.expectedSource
    ) {
      return {
        advanced: false,
        record: existingRecord,
      };
    }

    const cursor = resolveAdvancedDeviceActivityCursor({
      currentAfter: existingRecord.schedule.after,
      currentAfterEntityId: existingRecord.schedule.afterEntityId,
      currentAfterOccurredAt: existingRecord.schedule.afterOccurredAt,
      nextAfter: after,
      nextAfterEntityId: afterEntityId,
      nextAfterOccurredAt: afterOccurredAt,
    });
    if (!cursor) {
      return {
        advanced: false,
        record: existingRecord,
      };
    }

    const updated = await upsertAutomationWithLatestRegistry({
      activeUntil: existingRecord.activeUntil,
      automationId: existingRecord.automationId,
      continuityPolicy: existingRecord.continuityPolicy,
      instructions: existingRecord.instructions,
      now: input.now,
      route: existingRecord.route,
      assistantTargetOverride: existingRecord.assistantTargetOverride,
      schedule: {
        ...existingRecord.schedule,
        after: cursor.after,
        afterOccurredAt: cursor.afterOccurredAt,
        afterEntityId: cursor.afterEntityId,
      },
      slug: existingRecord.slug,
      status: existingRecord.status,
      summary: existingRecord.summary,
      tags: existingRecord.tags,
      title: existingRecord.title,
      vaultRoot: input.vaultRoot,
    }, records);

    return {
      advanced: true,
      record: updated.record,
    };
  });
}

function assertAutomationPatchHasChanges(input: PatchAutomationInput): void {
  const {
    expectedUpdatedAt: _expectedUpdatedAt,
    lookup: _lookup,
    now: _now,
    vaultRoot: _vaultRoot,
    ...patch
  } = input;
  if (Object.values(patch).some((value) => value !== undefined)) {
    return;
  }

  throw new VaultError(
    "VAULT_AUTOMATION_EMPTY_PATCH",
    "Automation edit requires at least one field to update.",
  );
}

function automationRoutesEqual(left: AutomationRoute, right: AutomationRoute): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveAdvancedDeviceActivityCursor(input: {
  currentAfter: string;
  currentAfterEntityId?: string;
  currentAfterOccurredAt?: string;
  nextAfter: string;
  nextAfterEntityId: string;
  nextAfterOccurredAt: string;
}): { after: string; afterOccurredAt: string; afterEntityId: string } | null {
  const nextKey = {
    entityId: input.nextAfterEntityId,
    occurredAt: input.nextAfterOccurredAt,
    triggeredAt: input.nextAfter,
  };
  const cursor = resolveNextDeviceActivityCoverageCursor({
    cursor: {
      after: input.currentAfter,
      ...(input.currentAfterOccurredAt ? { afterOccurredAt: input.currentAfterOccurredAt } : {}),
      ...(input.currentAfterEntityId ? { afterEntityId: input.currentAfterEntityId } : {}),
    },
    keys: [nextKey],
  });
  if (!cursor) {
    return null;
  }

  return compareDeviceActivityCoverageKeys(nextKey, {
    entityId: cursor.afterEntityId,
    occurredAt: cursor.afterOccurredAt,
    triggeredAt: cursor.after,
  }) === 0
    ? cursor
    : null;
}

async function upsertAutomationWithLatestRegistry(
  input: UpsertAutomationInput,
  records?: AutomationRecord[],
): Promise<UpsertAutomationResult> {
  const suppliedId = normalizeId(input.automationId, "automationId", "automation");
  const normalizedId = input.createOnly === true && suppliedId === undefined
    ? generateRecordId("automation")
    : suppliedId;
  const title = normalizeAutomationTitle(input.title);
  const requestedSlug = input.createOnly === true && input.slug === undefined
    ? normalizeSlug(undefined, "slug", normalizedId)
    : resolveAutomationUpsertSlug({
        slug: input.slug,
        title,
      });
  const existingRecord = selectAutomationRecord(
    records ?? await loadAutomationRecords(input.vaultRoot),
    { automationId: normalizedId, slug: requestedSlug },
  );
  if (input.createOnly === true && existingRecord !== null) {
    throw new VaultError(
      "VAULT_AUTOMATION_CONFLICT",
      "Create-only automation ownership already exists.",
    );
  }
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
  const schedule = input.schedule !== undefined
    ? normalizeAutomationSchedule(input.schedule)
    : existingRecord?.schedule ?? scaffoldAutomationPayload().schedule;
  const activeUntil = input.activeUntil === undefined
    ? existingRecord?.activeUntil ?? null
    : normalizeAutomationActiveUntil(input.activeUntil);
  assertAutomationActiveUntilMatchesSchedule({ activeUntil, schedule });
  const status = normalizeAutomationStatus(input.status ?? existingRecord?.status);
  const timingChanged =
    existingRecord === null ||
    !isDeepStrictEqual(existingRecord.schedule, schedule) ||
    (existingRecord.status !== "active" && status === "active");
  const scheduleAnchorAt = timingChanged
    ? now
    : existingRecord.scheduleAnchorAt ?? existingRecord.createdAt;
  const requestedTags = input.tags === undefined
    ? existingRecord?.tags ?? []
    : normalizeAutomationTags(input.tags);
  assertAutomationReconciledArchiveMarkerNotForged({
    existingRecord,
    requestedTags,
  });
  // Reconciliation is the only writer allowed to grant future automatic
  // reactivation. Any ordinary upsert or patch consumes that authority,
  // including an explicit archive of a record that reconciliation already
  // archived.
  const tags = requestedTags.filter(
    (tag) => tag !== AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  );
  assertAutomationSupportSeriesOwnershipPreserved({
    existingRecord,
    nextTags: tags,
  });

  const record: AutomationRecord = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: target.recordId,
    slug: target.slug,
    title,
    status,
    summary:
      input.summary === undefined
        ? existingRecord?.summary ?? null
        : normalizeAutomationSummary(input.summary),
    activeUntil,
    schedule,
    route:
      input.route !== undefined
        ? normalizeAutomationRoute(input.route)
        : existingRecord?.route ?? scaffoldAutomationPayload().route,
    assistantTargetOverride:
      input.assistantTargetOverride === undefined
        ? existingRecord?.assistantTargetOverride ?? null
        : normalizeAutomationAssistantTargetOverride(input.assistantTargetOverride),
    supportKind:
      input.supportKind === undefined
        ? existingRecord?.supportKind ?? null
        : normalizeAutomationSupportKind(input.supportKind),
    continuityPolicy:
      normalizeAutomationContinuityPolicy(input.continuityPolicy ?? existingRecord?.continuityPolicy),
    tags,
    createdAt,
    scheduleAnchorAt,
    updatedAt,
    instructions: normalizeAutomationAvailabilityForSchedule({
      instructions: normalizeAutomationInstructions(input.instructions),
      scheduleKind: schedule.kind,
    }),
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
  const now = new Date().toISOString();
  const schedule = normalizeAutomationSchedule(input.schedule);
  const activeUntil = normalizeAutomationActiveUntil(input.activeUntil);
  assertAutomationActiveUntilMatchesSchedule({ activeUntil, schedule });
  const normalized: AutomationRecord = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: input.automationId ?? "automation_preview",
    slug,
    title: normalizeAutomationTitle(input.title),
    status: normalizeAutomationStatus(input.status),
    summary: normalizeAutomationSummary(input.summary),
    activeUntil,
    schedule,
    route: normalizeAutomationRoute(input.route),
    assistantTargetOverride: normalizeAutomationAssistantTargetOverride(
      input.assistantTargetOverride,
    ),
    supportKind: normalizeAutomationSupportKind(input.supportKind),
    continuityPolicy: normalizeAutomationContinuityPolicy(input.continuityPolicy),
    tags: normalizeAutomationTags(input.tags),
    createdAt: now,
    scheduleAnchorAt: now,
    updatedAt: now,
    instructions: normalizeAutomationAvailabilityForSchedule({
      instructions: normalizeAutomationInstructions(input.instructions),
      scheduleKind: schedule.kind,
    }),
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
