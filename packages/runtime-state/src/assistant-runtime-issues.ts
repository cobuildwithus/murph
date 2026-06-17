import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  ensureAssistantStateDir,
  writeAssistantStateJson,
} from "./assistant-state-fs.ts";
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from "./assistant-state.ts";
import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
} from "./versioned-json-state.ts";

export const ASSISTANT_RUNTIME_ISSUE_SCHEMA = "murph.assistant-runtime-issue.v1";
const ASSISTANT_RUNTIME_ISSUE_FILE_SCHEMA_VERSION = 1;

export type AssistantRuntimeIssueEnvironment = "hosted" | "local";
export type AssistantRuntimeIssuePhase =
  | "prompt_build"
  | "provider_turn"
  | "tool_call"
  | "tool_result_parse"
  | "vault_write"
  | "hosted_commit"
  | "final_response";
export type AssistantRuntimeIssueSeverity = "info" | "warning" | "error";
export type AssistantRuntimeIssueKind =
  | "tool_error"
  | "schema_rejection"
  | "fallback_used"
  | "retry_used"
  | "timeout"
  | "model_reported_friction"
  | "dev_note_stripped";

export interface AssistantRuntimeIssueRecord {
  component: string;
  details: Record<string, unknown>;
  environment: AssistantRuntimeIssueEnvironment;
  errorCode: string | null;
  fingerprint: string;
  issueId: string;
  issueKind: AssistantRuntimeIssueKind;
  occurredAt: string;
  operation: string | null;
  phase: AssistantRuntimeIssuePhase;
  schema: typeof ASSISTANT_RUNTIME_ISSUE_SCHEMA;
  severity: AssistantRuntimeIssueSeverity;
  summary: string;
  surface: string | null;
}

export interface PendingAssistantRuntimeIssueRecordParseFailure {
  error: unknown;
  fileName: string;
}

const FIELD_MAX_LENGTH = 96;
const SUMMARY_MAX_LENGTH = 240;
const DETAIL_TEXT_MAX_LENGTH = 180;
const DETAIL_MAX_KEYS = 24;
const DETAIL_MAX_ARRAY_ITEMS = 12;
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/u;
const ASSISTANT_RUNTIME_ISSUE_ID_PATTERN = /^ari_[0-9a-f]{16}_[0-9a-f]{24}$/u;
const ASSISTANT_RUNTIME_ISSUE_FINGERPRINT_PATTERN = /^[0-9a-f]{24}$/u;
const BARE_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}\b/gu,
  /\bwhsec[_-][A-Za-z0-9_-]{8,}\b/gu,
  /\bgh[opsru]_[A-Za-z0-9_]{16,}\b/gu,
  /\bxox[abprs]-[A-Za-z0-9-]{16,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu,
];
const HOSTED_RUNTIME_DIRECT_WORKFLOW_ID_PATTERN =
  /\bhosted-user-runtime:[A-Za-z0-9._:-]+/gu;
const HOSTED_RUNTIME_DIRECT_ID_PATTERN =
  /\b(member|user)_[A-Za-z0-9._:-]*\d[A-Za-z0-9._:-]*/gu;

export function createAssistantRuntimeIssueId(input: {
  fingerprint: string;
  occurredAt: string;
}): string {
  return [
    "ari",
    sha256Hex(`${normalizeRequiredString(input.occurredAt, "occurredAt")}:${randomUUID()}`).slice(0, 16),
    normalizeRequiredString(input.fingerprint, "fingerprint"),
  ].join("_");
}

export function createAssistantRuntimeIssueFingerprint(input: {
  component: string;
  errorCode?: string | null;
  issueKind: AssistantRuntimeIssueKind;
  operation?: string | null;
  phase: AssistantRuntimeIssuePhase;
  summary: string;
}): string {
  return sha256Hex(JSON.stringify({
    component: input.component,
    errorCode: input.errorCode ?? null,
    issueKind: input.issueKind,
    operation: input.operation ?? null,
    phase: input.phase,
    summary: input.summary,
  })).slice(0, 24);
}

export function resolvePendingAssistantRuntimeIssuePath(
  paths: AssistantStatePaths,
  issueId: string,
): string {
  return path.join(
    paths.issuesPendingDirectory,
    `${normalizeIssueId(issueId)}.json`,
  );
}

export async function writePendingAssistantRuntimeIssueRecord(input: {
  paths?: AssistantStatePaths;
  record: AssistantRuntimeIssueRecord;
  vault?: string;
}): Promise<void> {
  const paths = resolveAssistantRuntimeIssuePaths(input.vault, input.paths);
  const record = parseAssistantRuntimeIssueRecord(input.record);
  await ensureAssistantStateDir(paths.issuesPendingDirectory);
  await writeAssistantStateJson(
    resolvePendingAssistantRuntimeIssuePath(paths, record.issueId),
    createVersionedJsonStateEnvelope({
      schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
      schemaVersion: ASSISTANT_RUNTIME_ISSUE_FILE_SCHEMA_VERSION,
      value: record,
    }),
  );
}

export async function listPendingAssistantRuntimeIssueRecords(input: {
  onInvalidRecord?: ((failure: PendingAssistantRuntimeIssueRecordParseFailure) => void) | null;
  paths?: AssistantStatePaths;
  skipInvalidRecords?: boolean;
  vault?: string;
}): Promise<AssistantRuntimeIssueRecord[]> {
  const paths = resolveAssistantRuntimeIssuePaths(input.vault, input.paths);
  const onInvalidRecord = input.onInvalidRecord ?? null;
  const skipInvalidRecords = input.skipInvalidRecords ?? false;

  try {
    const entries = await readdir(paths.issuesPendingDirectory, {
      withFileTypes: true,
    });
    const records: AssistantRuntimeIssueRecord[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(path.join(paths.issuesPendingDirectory, entry.name), "utf8");
        records.push(parsePendingAssistantRuntimeIssueFile(JSON.parse(raw)));
      } catch (error) {
        if (!skipInvalidRecords) {
          throw error;
        }

        onInvalidRecord?.({
          error,
          fileName: entry.name,
        });
      }
    }

    return records.sort((left, right) => {
      const occurredAtOrder = left.occurredAt.localeCompare(right.occurredAt);

      if (occurredAtOrder !== 0) {
        return occurredAtOrder;
      }

      return left.issueId.localeCompare(right.issueId);
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

export async function deletePendingAssistantRuntimeIssueRecord(input: {
  issueId: string;
  paths?: AssistantStatePaths;
  vault?: string;
}): Promise<void> {
  const paths = resolveAssistantRuntimeIssuePaths(input.vault, input.paths);

  await rm(resolvePendingAssistantRuntimeIssuePath(paths, input.issueId), {
    force: true,
  });
}

export function parseAssistantRuntimeIssueRecord(value: unknown): AssistantRuntimeIssueRecord {
  const record = requireRecord(value, "assistant runtime issue record");
  const occurredAt = normalizeIsoTimestamp(record.occurredAt, "occurredAt");
  const fingerprint = normalizeFingerprint(record.fingerprint);
  const issueId = normalizeIssueId(record.issueId);
  const issueKind = normalizeIssueKind(record.issueKind);
  const operation = sanitizeOptionalField(record.operation, "operation");
  const phase = normalizePhase(record.phase);

  return {
    component: sanitizeRequiredField(record.component, "component", "assistant-runtime"),
    details: sanitizeDetails(record.details),
    environment: normalizeEnvironment(record.environment),
    errorCode: sanitizeOptionalField(record.errorCode, "errorCode"),
    fingerprint,
    issueId,
    issueKind,
    occurredAt,
    operation,
    phase,
    schema: normalizeIssueSchema(record.schema),
    severity: normalizeSeverity(record.severity),
    summary: sanitizeSummary(record.summary, {
      issueKind,
      operation,
      phase,
    }),
    surface: sanitizeOptionalField(record.surface, "surface"),
  };
}

function resolveAssistantRuntimeIssuePaths(
  vault: string | undefined,
  paths: AssistantStatePaths | undefined,
): AssistantStatePaths {
  if (paths) {
    return paths;
  }

  if (!vault) {
    throw new TypeError("vault or paths is required when resolving assistant runtime issue state.");
  }

  return resolveAssistantStatePaths(vault);
}

function parsePendingAssistantRuntimeIssueFile(value: unknown): AssistantRuntimeIssueRecord {
  return parseVersionedJsonStateEnvelope(value, {
    label: "pending assistant runtime issue record",
    parseValue: parseAssistantRuntimeIssueRecord,
    schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
    schemaVersion: ASSISTANT_RUNTIME_ISSUE_FILE_SCHEMA_VERSION,
  });
}

function normalizeIssueSchema(value: unknown): typeof ASSISTANT_RUNTIME_ISSUE_SCHEMA {
  const schema = normalizeRequiredString(value, "schema");

  if (schema !== ASSISTANT_RUNTIME_ISSUE_SCHEMA) {
    throw new TypeError(`assistant runtime issue record schema must be ${ASSISTANT_RUNTIME_ISSUE_SCHEMA}.`);
  }

  return ASSISTANT_RUNTIME_ISSUE_SCHEMA;
}

function normalizeFingerprint(value: unknown): string {
  const fingerprint = normalizeRequiredString(value, "fingerprint");

  if (!ASSISTANT_RUNTIME_ISSUE_FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new TypeError("fingerprint must be a 24-character hexadecimal string.");
  }

  return fingerprint;
}

function normalizeIssueId(value: unknown): string {
  const issueId = normalizeRequiredString(value, "issueId");

  if (!ASSISTANT_RUNTIME_ISSUE_ID_PATTERN.test(issueId)) {
    throw new TypeError("issueId must match the assistant runtime issue id format.");
  }

  return issueId;
}

function normalizeEnvironment(value: unknown): AssistantRuntimeIssueEnvironment {
  const normalized = normalizeRequiredString(value, "environment");
  if (normalized === "hosted" || normalized === "local") {
    return normalized;
  }
  throw new TypeError("environment must be 'hosted' or 'local'.");
}

function normalizePhase(value: unknown): AssistantRuntimeIssuePhase {
  const normalized = normalizeRequiredString(value, "phase");
  if (
    normalized === "prompt_build" ||
    normalized === "provider_turn" ||
    normalized === "tool_call" ||
    normalized === "tool_result_parse" ||
    normalized === "vault_write" ||
    normalized === "hosted_commit" ||
    normalized === "final_response"
  ) {
    return normalized;
  }
  throw new TypeError("phase is not a supported assistant runtime issue phase.");
}

function normalizeSeverity(value: unknown): AssistantRuntimeIssueSeverity {
  const normalized = normalizeRequiredString(value, "severity");
  if (normalized === "info" || normalized === "warning" || normalized === "error") {
    return normalized;
  }
  throw new TypeError("severity must be 'info', 'warning', or 'error'.");
}

function normalizeIssueKind(value: unknown): AssistantRuntimeIssueKind {
  const normalized = normalizeRequiredString(value, "issueKind");
  if (
    normalized === "tool_error" ||
    normalized === "schema_rejection" ||
    normalized === "fallback_used" ||
    normalized === "retry_used" ||
    normalized === "timeout" ||
    normalized === "model_reported_friction" ||
    normalized === "dev_note_stripped"
  ) {
    return normalized;
  }
  throw new TypeError("issueKind is not a supported assistant runtime issue kind.");
}

function sanitizeRequiredField(
  value: unknown,
  label: string,
  fallback: string,
): string {
  const field = normalizeSafeIdentifier(normalizeRequiredString(value, label));
  return field ?? fallback;
}

function sanitizeOptionalField(value: unknown, label: string): string | null {
  const normalized = normalizeOptionalString(value, label);

  if (!normalized) {
    return null;
  }

  return normalizeSafeIdentifier(normalized);
}

function sanitizeDetails(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  return sanitizeJsonObject(requireJsonObject(value, "details"));
}

function sanitizeJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(sanitized).length >= DETAIL_MAX_KEYS) {
      break;
    }

    if (!DETAIL_KEY_PATTERN.test(key)) {
      continue;
    }

    const sanitizedEntry = sanitizeDetailValue(entry);
    if (sanitizedEntry !== undefined) {
      sanitized[key] = sanitizedEntry;
    }
  }

  return sanitized;
}

function sanitizeDetailValue(value: unknown): unknown | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    return sanitizeTextValue(value, DETAIL_TEXT_MAX_LENGTH) ?? undefined;
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeDetailValue(entry))
      .filter((entry) => entry !== undefined)
      .slice(0, DETAIL_MAX_ARRAY_ITEMS);

    return sanitized.length > 0 ? sanitized : undefined;
  }

  if (value && typeof value === "object") {
    const sanitized = sanitizeJsonObject(requireJsonObject(value, "detail value"));
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  return undefined;
}

function normalizeSafeIdentifier(value: string): string | null {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > FIELD_MAX_LENGTH ||
    !SAFE_IDENTIFIER_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function sanitizeSummary(
  value: unknown,
  fallback: {
    issueKind: AssistantRuntimeIssueKind;
    operation: string | null;
    phase: AssistantRuntimeIssuePhase;
  },
): string {
  if (typeof value !== "string") {
    return resolveCanonicalSummary(fallback);
  }

  return sanitizeTextValue(value, SUMMARY_MAX_LENGTH) ?? resolveCanonicalSummary(fallback);
}

function sanitizeTextValue(value: string, maxLength: number): string | null {
  const assignedSecretRedacted = value
    .replaceAll(
      /(authorization|cookie|token|api[_-]?key|secret|password)\s*[:=]\s*[^\s),;]+/giu,
      (_match, key: string) => `${key}=[REDACTED]`,
    )
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [REDACTED]");
  const redacted = redactBareSecretValues(redactDirectIdentifierValues(assignedSecretRedacted))
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
    .replaceAll(/(?:\+?\d[\d .()\-]{6,}\d)/gu, "[number]")
    .replaceAll(/(?:https?:\/\/|file:\/\/)[^\s),;]+/giu, "[url]")
    .replaceAll(/(?:file:\/\/)?\/(?:Users|home|mnt|tmp|var|private)\/[^\s),;]+/giu, "[path]")
    .replaceAll(/[A-Za-z]:\\[^\s),;]+/gu, "[path]")
    .replaceAll(/\s+/gu, " ")
    .trim();

  if (!redacted) {
    return null;
  }

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function redactBareSecretValues(value: string): string {
  let redacted = value;
  for (const pattern of BARE_SECRET_VALUE_PATTERNS) {
    redacted = redacted.replaceAll(pattern, "[REDACTED]");
  }
  return redacted;
}

function redactDirectIdentifierValues(value: string): string {
  return value
    .replaceAll(HOSTED_RUNTIME_DIRECT_WORKFLOW_ID_PATTERN, "hosted-user-runtime:[redacted-id]")
    .replaceAll(
      HOSTED_RUNTIME_DIRECT_ID_PATTERN,
      (_match, prefix: string) => `${prefix}_[redacted-id]`,
    );
}

function resolveCanonicalSummary(input: {
  issueKind: AssistantRuntimeIssueKind;
  operation: string | null;
  phase: AssistantRuntimeIssuePhase;
}): string {
  const operationSuffix = input.operation ? ` (${input.operation})` : "";

  switch (input.issueKind) {
    case "dev_note_stripped":
      return "Assistant produced a visible developer note on a surface where developer notes are hidden.";
    case "schema_rejection":
      return `Assistant runtime issue: schema rejection during ${input.phase}${operationSuffix}.`;
    case "timeout":
      return `Assistant runtime issue: timeout during ${input.phase}${operationSuffix}.`;
    case "fallback_used":
      return `Assistant runtime issue: fallback used during ${input.phase}${operationSuffix}.`;
    case "retry_used":
      return `Assistant runtime issue: retry used during ${input.phase}${operationSuffix}.`;
    case "model_reported_friction":
      return `Assistant runtime issue: model reported friction during ${input.phase}${operationSuffix}.`;
    case "tool_error":
    default:
      return `Assistant runtime issue: tool error during ${input.phase}${operationSuffix}.`;
  }
}

function requireJsonObject(value: unknown, label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function normalizeIsoTimestamp(value: unknown, label: string): string {
  const normalized = normalizeRequiredString(value, label);
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return date.toISOString();
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeOptionalString(value, label);

  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT",
  );
}
