import {
  AUTOMATION_DOC_TYPE,
  AUTOMATION_SCHEMA_VERSION,
  automationContinuityPolicyValues,
  automationScheduleKindValues,
  automationStatusValues,
  isValidIanaTimeZone,
  type AutomationContinuityPolicy,
  type AutomationRoute,
  type AutomationSchedule,
  type AutomationScheduleKind,
  type AutomationScaffoldPayload as ContractAutomationScaffoldPayload,
  type AutomationStatus,
} from "@murphai/contracts";

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
import type { FrontmatterObject } from "./types.ts";

const AUTOMATIONS_DIRECTORY = "bank/automations";
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function requireValidTimeZone(value: unknown, fieldName: string): string {
  const timeZone = requireString(value, fieldName, 64);
  if (!isValidIanaTimeZone(timeZone)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a valid IANA timezone.`);
  }

  return timeZone;
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
  prompt: string;
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

function normalizeAutomationSchedule(
  value: unknown,
): AutomationSchedule {
  const object = requireObject(value, "schedule");
  const kind = requireString(object.kind, "schedule.kind", 24);

  if (!automationScheduleKindValues.includes(kind as AutomationScheduleKind)) {
    throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
  }

  switch (kind) {
    case "at":
      return {
        kind,
        at: requireString(object.at, "schedule.at", 64),
      };
    case "every":
      if (typeof object.everyMs !== "number" || !Number.isInteger(object.everyMs) || object.everyMs <= 0) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.everyMs must be a positive integer.");
      }
      return {
        kind,
        everyMs: object.everyMs,
      };
    case "cron":
      return {
        kind,
        expression: requireString(object.expression, "schedule.expression", 400),
        timeZone: requireValidTimeZone(object.timeZone, "schedule.timeZone"),
      };
    case "dailyLocal": {
      const localTime = requireString(object.localTime, "schedule.localTime", 5);
      if (!dailyLocalTimePattern.test(localTime)) {
        throw new VaultError("VAULT_INVALID_INPUT", "schedule.localTime must use HH:MM format.");
      }

      return {
        kind,
        localTime,
        timeZone: requireValidTimeZone(object.timeZone, "schedule.timeZone"),
      };
    }
  }

  throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
}

function normalizeAutomationRoute(value: unknown): AutomationRoute {
  const object = requireObject(value, "route");

  return {
    channel: requireString(object.channel, "route.channel", 120),
    deliverResponse: object.deliverResponse === true,
    deliveryTarget: normalizeNullableRouteString(object.deliveryTarget),
    identityId: normalizeNullableRouteString(object.identityId),
    participantId: normalizeNullableRouteString(object.participantId),
    sourceThreadId: normalizeNullableRouteString(object.sourceThreadId),
  };
}

function normalizeAutomationPrompt(value: unknown): string {
  const prompt = requireString(value, "prompt", 40_000).replace(/\s+$/u, "");
  if (!prompt.trim()) {
    throw new VaultError("VAULT_INVALID_INPUT", "prompt must contain text.");
  }

  return prompt;
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
    attributes: buildAutomationFrontmatter(record),
    body: record.prompt,
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
        timeZone: schedule.timeZone,
      };
    case "dailyLocal":
      return {
        kind: schedule.kind,
        localTime: schedule.localTime,
        timeZone: schedule.timeZone,
      };
  }

  throw new VaultError("VAULT_INVALID_INPUT", "schedule.kind must match a supported automation schedule.");
}

function buildAutomationRouteFrontmatter(route: AutomationRoute): FrontmatterObject {
  return {
    channel: route.channel,
    deliverResponse: route.deliverResponse,
    deliveryTarget: route.deliveryTarget,
    identityId: route.identityId,
    participantId: route.participantId,
    sourceThreadId: route.sourceThreadId,
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
    summary: record.summary,
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
    prompt: normalizeAutomationPrompt(parsedDocument.body),
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
    record.prompt,
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
      timeZone: "Australia/Sydney",
    },
    route: {
      channel: "imessage",
      deliverResponse: true,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    },
    prompt: "Write the scheduled assistant prompt here.",
    summary: "Weekly scheduled assistant prompt.",
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
  const existing = selectExistingRegistryRecord({
    records,
    recordId: input.automationId,
    slug: input.slug,
    getRecordId: (record) => record.automationId,
    getRecordSlug: (record) => record.slug,
    conflictCode: "VAULT_AUTOMATION_CONFLICT",
    conflictMessage: "Automation id and slug resolve to different records.",
  });

  return existing;
}

export async function upsertAutomation(
  input: UpsertAutomationInput,
): Promise<UpsertAutomationResult> {
  const normalizedId = normalizeId(input.automationId, "automationId", "automation");
  const title = normalizeAutomationTitle(input.title);
  const requestedSlug = normalizeSlug(input.slug, "slug", title);
  const existingRecord = await showAutomation({
    automationId: normalizedId,
    slug: requestedSlug,
    vaultRoot: input.vaultRoot,
  });
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
      normalizeAutomationSummary(input.summary) ??
      existingRecord?.summary ??
      null,
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
    tags: normalizeAutomationTags(input.tags) ?? existingRecord?.tags ?? [],
    createdAt,
    updatedAt,
    prompt: normalizeAutomationPrompt(input.prompt),
    relativePath: target.relativePath,
    markdown: "",
  };

  const { auditPath, record: writtenRecord } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes: buildAutomationFrontmatter(record),
    body: record.prompt,
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
    schedule: input.schedule,
    route: input.route,
    continuityPolicy: normalizeAutomationContinuityPolicy(input.continuityPolicy),
    tags: normalizeAutomationTags(input.tags),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt: normalizeAutomationPrompt(input.prompt),
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
