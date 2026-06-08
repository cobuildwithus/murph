import {
  AUTOMATION_DOC_TYPE,
  AUTOMATION_SCHEMA_VERSION,
  MIN_AUTOMATION_EVERY_MS,
  automationContinuityPolicyValues,
  automationDeviceActivityKindValues,
  automationDeviceActivitySourceValues,
  automationScheduleKindValues,
  automationStatusValues,
  VAULT_LAYOUT,
  type AutomationContinuityPolicy,
  type AutomationDeviceActivityKind,
  type AutomationDeviceActivitySource,
  type AutomationRoute,
  type AutomationSchedule,
  type AutomationScheduleKind,
  type AutomationStatus,
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

const AUTOMATIONS_DIRECTORY = VAULT_LAYOUT.automationsDirectory;
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export type {
  AutomationContinuityPolicy,
  AutomationRoute,
  AutomationSchedule,
  AutomationStatus,
};

export interface AutomationQueryRecord {
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

export interface AutomationListOptions {
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

function normalizeNullableRouteString(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeNullableString(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeNullableString(String(value));
  }

  return null;
}

function requireStringValue(value: unknown, fieldName: string): string {
  const normalized = normalizeNullableString(typeof value === "string" ? value : null);
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return normalized;
}

function rejectRecurringScheduleTimeZone(object: Record<string, unknown>): void {
  if (Object.hasOwn(object, "timeZone")) {
    throw new Error("schedule.timeZone is not supported for canonical automation schedules.");
  }
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
  if (!automationDeviceActivityKindValues.includes(normalized as AutomationDeviceActivityKind)) {
    throw new Error("schedule.activityKind must match a supported device activity kind.");
  }
  return normalized as AutomationDeviceActivityKind;
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
    case "at":
      return {
        kind,
        at: requireStringValue(object.at, "schedule.at"),
      };
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
    case "cron":
      rejectRecurringScheduleTimeZone(object);
      return {
        kind,
        expression: requireStringValue(object.expression, "schedule.expression"),
      };
    case "dailyLocal": {
      const localTime = requireStringValue(object.localTime, "schedule.localTime");
      if (!dailyLocalTimePattern.test(localTime)) {
        throw new Error("schedule.localTime must use HH:MM format.");
      }

      rejectRecurringScheduleTimeZone(object);

      return {
        kind,
        localTime,
      };
    }
    case "deviceActivity": {
      const after = requireStringValue(object.after, "schedule.after");
      if (Number.isNaN(Date.parse(after))) {
        throw new Error("schedule.after must be a valid ISO timestamp.");
      }
      const source = normalizeDeviceActivitySource(object.source);
      const activityKind = normalizeDeviceActivityKind(object.activityKind);
      return {
        kind,
        after,
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
  return {
    channel: requireStringValue(object.channel, "route.channel"),
    deliveryTarget: normalizeNullableRouteString(object.deliveryTarget),
    identityId: normalizeNullableRouteString(object.identityId),
    participantId: normalizeNullableRouteString(object.participantId),
    threadId: normalizeNullableRouteString(object.threadId),
  };
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
  )];
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

  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    docType: AUTOMATION_DOC_TYPE,
    automationId: requireStringValue(attributes.automationId, "automationId"),
    slug: requireStringValue(attributes.slug, "slug"),
    title: requireStringValue(attributes.title, "title"),
    status: normalizeAutomationStatus(attributes.status),
    summary: normalizeNullableString(typeof attributes.summary === "string" ? attributes.summary : null),
    schedule: normalizeAutomationSchedule(attributes.schedule),
    route: normalizeAutomationRoute(attributes.route),
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

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const record = parseAutomationRecord(document.attributes, relativePath, document.markdown);
    records.push(record);
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
      record.instructions,
      record.createdAt,
      record.updatedAt,
      record.status,
      record.continuityPolicy,
      JSON.stringify(record.schedule),
      JSON.stringify(record.route),
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

export async function listAutomations(
  vaultRoot: string,
  options: AutomationListOptions = {},
): Promise<AutomationQueryRecord[]> {
  const records = await loadAutomationRecords(vaultRoot);
  const filtered = records.filter((record) =>
    matchesAutomationStatus(record.status, options.status) &&
    matchesAutomationText(record, options.text),
  );

  return applyLimit(filtered, options.limit);
}

export async function readAutomation(
  vaultRoot: string,
  automationId: string,
): Promise<AutomationQueryRecord | null> {
  const records = await loadAutomationRecords(vaultRoot);
  return records.find((record) => record.automationId === automationId) ?? null;
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
