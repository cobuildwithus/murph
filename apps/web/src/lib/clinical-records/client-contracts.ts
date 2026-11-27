import { ContractValidationError } from "@murphai/contracts/validation-error";
export const CLINICAL_RECORD_MAX_SOURCES = 20;

export const CLINICAL_RECORD_CONNECTION_STATUSES = [
  "active",
  "disconnected",
  "needs_reauth",
  "error",
] as const;

export type ClinicalRecordConnectionStatus =
  (typeof CLINICAL_RECORD_CONNECTION_STATUSES)[number];

export const CLINICAL_RECORD_OPEN_RUN_STATUSES = ["queued", "retrieving"] as const;
export const CLINICAL_RECORD_TERMINAL_RUN_STATUSES = [
  "complete",
  "partial",
  "needs_reauth",
  "failed",
  "canceled",
] as const;

export const CLINICAL_RECORD_RUN_STATUSES = [...CLINICAL_RECORD_OPEN_RUN_STATUSES, ...CLINICAL_RECORD_TERMINAL_RUN_STATUSES] as const;

export type ClinicalRecordRunStatus = (typeof CLINICAL_RECORD_RUN_STATUSES)[number];

export const CLINICAL_RECORD_CALLBACK_MARKERS = [
  "connected",
  "auth-required",
  "declined",
  "expired",
  "failed",
] as const;

export type ClinicalRecordCallbackMarker =
  (typeof CLINICAL_RECORD_CALLBACK_MARKERS)[number];

export const CLINICAL_RECORD_CONNECT_START_PATH =
  "/api/clinical-records/connect-intents/start";

import type { ClinicalProviderSearchResultContract, ClinicalProviderFacilityContract, ClinicalMatchedFacility } from "@murphai/clinical-records/provider-directory";
export type { ClinicalProviderSearchResultContract, ClinicalProviderFacilityContract, ClinicalMatchedFacility } from "@murphai/clinical-records/provider-directory";

export function clinicalProviderPlaceLabels(provider: ClinicalProviderSearchResultContract): string[] {
  const facility = provider.matchedFacility ?? provider.facilities[0];
  const locality = facility && [facility.name === provider.brandName ? null : facility.name,
    ...(provider.matchedFacility?.street ?? []), facility.city, facility.state].filter(Boolean).join(", ");
  return [locality, ...provider.sharedPlaces ?? [], provider.possiblyIncludedThrough
    && `May already be included through ${provider.possiblyIncludedThrough}`].filter((label): label is string => Boolean(label));
}

export interface ClinicalProviderSearchResponseContract {
  directoryVersion: string;
  ok: true;
  providers: readonly ClinicalProviderSearchResultContract[];
}

export interface ClinicalRecordLatestRunContract {
  completedAt: string | null;
  importedCount: number;
  labResultCount?: number;
  skippedExistingCount?: number;
  reviewCount: number;
  runId: string;
  status: ClinicalRecordRunStatus;
}

export interface ClinicalRecordConnectionContract {
  canImport?: boolean;
  lastCheckedAt?: string | null;
  nextSyncAt?: string | null;
  connectedAt: string;
  connectionId: string;
  displayName: string;
  lastErrorCode: string | null;
  lastSyncCompletedAt: string | null;
  latestRun: ClinicalRecordLatestRunContract | null;
  providerDirectoryEntryId: string;
  sourceSystem: string;
  status: ClinicalRecordConnectionStatus;
}

export interface ClinicalRecordConnectionsResponseContract {
  connections: readonly ClinicalRecordConnectionContract[];
  ok: true;
}

export interface ClinicalRecordConnectStartResponseContract {
  authorizationUrl: string;
  expiresAt: string;
  ok: true;
}

export interface ClinicalRecordConnectStartRequestContract {
  claim: string;
  providerDirectoryEntryId: string;
}

export interface ClinicalRecordConnectIntentResponseContract {
  claim: string;
  expiresAt: string;
  ok: true;
}

export interface ClinicalRecordDisconnectResponseContract {
  connectionId: string;
  ok: true;
  status: "disconnected";
}

export function parseClinicalProviderSearchResponse(
  value: unknown,
): ClinicalProviderSearchResponseContract {
  const record = requireExactRecord(value, ["directoryVersion", "ok", "providers"]);
  if (record.ok !== true) throw invalidContract();
  return {
    directoryVersion: requireString(record.directoryVersion, 80),
    ok: true,
    providers: requireArray(record.providers, 20).map((provider) => {
      const item = requireExactRecord(provider, ["brandName", "facilities", "id", "sourceSystem"],
        ["matchedFacility", "sharedPlaces", "possiblyIncludedThrough"]);
      if (item.sourceSystem !== "epic-fhir") throw invalidContract();
      return {
        ...(item.matchedFacility === undefined ? {} : { matchedFacility: item.matchedFacility === null
          ? null : parseMatchedFacility(item.matchedFacility) }),
        ...(item.sharedPlaces === undefined ? {} : { sharedPlaces: requireArray(item.sharedPlaces, 8).map(place => requireString(place, 160)) }),
        ...(item.possiblyIncludedThrough === undefined ? {} : { possiblyIncludedThrough: requireString(item.possiblyIncludedThrough, 160) }),
        brandName: requireString(item.brandName, 160),
        facilities: requireArray(item.facilities, 8).map(parseFacility),
        id: requireIdentifier(item.id),
        sourceSystem: "epic-fhir",
      };
    }),
  };
}

export function parseClinicalRecordConnectionsResponse(
  value: unknown,
): ClinicalRecordConnectionsResponseContract {
  const record = requireExactRecord(value, ["connections", "ok"]);
  if (record.ok !== true) throw invalidContract();
  return {
    connections: requireArray(record.connections, 100).map(parseConnection),
    ok: true,
  };
}

export function parseClinicalRecordConnectStartResponse(
  value: unknown,
): ClinicalRecordConnectStartResponseContract {
  const record = requireExactRecord(value, ["authorizationUrl", "expiresAt", "ok"]);
  if (record.ok !== true) throw invalidContract();
  return {
    authorizationUrl: requireString(record.authorizationUrl, 4_096),
    expiresAt: requireIsoTimestamp(record.expiresAt),
    ok: true,
  };
}

export function parseClinicalRecordConnectStartRequest(
  value: unknown,
): ClinicalRecordConnectStartRequestContract {
  const record = requireExactRecord(value, ["claim", "providerDirectoryEntryId"]);
  const claim = requireString(record.claim, 40);
  if (!/^cr_[A-Za-z0-9_-]{32}$/u.test(claim)) throw invalidContract();
  return {
    claim,
    providerDirectoryEntryId: requireIdentifier(record.providerDirectoryEntryId),
  };
}

export function parseClinicalRecordConnectIntentResponse(
  value: unknown,
): ClinicalRecordConnectIntentResponseContract {
  const record = requireExactRecord(value, ["claim", "expiresAt", "ok"]);
  if (record.ok !== true) throw invalidContract();
  const claim = requireString(record.claim, 40);
  if (!/^cr_[A-Za-z0-9_-]{32}$/u.test(claim)) throw invalidContract();
  return {
    claim,
    expiresAt: requireIsoTimestamp(record.expiresAt),
    ok: true,
  };
}

export function parseClinicalRecordDisconnectResponse(
  value: unknown,
): ClinicalRecordDisconnectResponseContract {
  const record = requireExactRecord(value, ["connectionId", "ok", "status"]);
  if (record.ok !== true || record.status !== "disconnected") throw invalidContract();
  return {
    connectionId: requireIdentifier(record.connectionId),
    ok: true,
    status: "disconnected",
  };
}

export function parseClinicalRecordCallbackMarker(
  value: unknown,
): ClinicalRecordCallbackMarker {
  if (!isStringMember(value, CLINICAL_RECORD_CALLBACK_MARKERS)) throw invalidContract();
  return value;
}

function parseMatchedFacility(value: unknown): ClinicalMatchedFacility {
  const record = requireExactRecord(value, ["city", "name", "postalCode", "state"], ["street"]);
  const { street, ...facility } = record;
  return { ...parseFacility(facility), ...(street === undefined ? {} : { street: requireArray(street, 4).map(line => requireString(line, 180)) }) };
}

function parseFacility(value: unknown): ClinicalProviderFacilityContract {
  const record = requireExactRecord(value, ["city", "name", "postalCode", "state"]);
  return {
    city: optionalString(record.city, 120),
    name: optionalString(record.name, 180),
    postalCode: optionalString(record.postalCode, 24),
    state: optionalString(record.state, 80),
  };
}

function parseConnection(value: unknown): ClinicalRecordConnectionContract {
  const record = requireExactRecord(value, [
    "connectedAt",
    "connectionId",
    "displayName",
    "lastErrorCode",
    "lastSyncCompletedAt",
    "latestRun",
    "providerDirectoryEntryId",
    "sourceSystem",
    "status",
  ], ["canImport", "lastCheckedAt", "nextSyncAt"]);
  return {
    ...(record.canImport !== undefined ? { canImport: parseBoolean(record.canImport) } : {}),
    connectedAt: requireIsoTimestamp(record.connectedAt),
    connectionId: requireIdentifier(record.connectionId),
    displayName: requireString(record.displayName, 160),
    lastErrorCode: optionalErrorCode(record.lastErrorCode),
    lastSyncCompletedAt: optionalIsoTimestamp(record.lastSyncCompletedAt),
    ...(record.lastCheckedAt === undefined ? {} : { lastCheckedAt: optionalIsoTimestamp(record.lastCheckedAt) }),
    ...(record.nextSyncAt === undefined ? {} : { nextSyncAt: optionalIsoTimestamp(record.nextSyncAt) }),
    latestRun: record.latestRun === null ? null : parseLatestRun(record.latestRun),
    providerDirectoryEntryId: requireIdentifier(record.providerDirectoryEntryId),
    sourceSystem: requireIdentifier(record.sourceSystem),
    status: requireConnectionStatus(record.status),
  };
}

function parseLatestRun(value: unknown): ClinicalRecordLatestRunContract {
  const record = requireExactRecord(value, [
    "completedAt",
    "importedCount",
    "reviewCount",
    "runId",
    "status",
  ], ["labResultCount", "skippedExistingCount"]);
  return {
    completedAt: optionalIsoTimestamp(record.completedAt),
    importedCount: requireCount(record.importedCount),
    ...(record.labResultCount === undefined ? {} : { labResultCount: requireCount(record.labResultCount) }),
    ...(record.skippedExistingCount === undefined ? {} : { skippedExistingCount: requireCount(record.skippedExistingCount) }),
    reviewCount: requireCount(record.reviewCount),
    runId: requireIdentifier(record.runId),
    status: requireRunStatus(record.status),
  };
}

function requireConnectionStatus(value: unknown): ClinicalRecordConnectionStatus {
  if (!isStringMember(value, CLINICAL_RECORD_CONNECTION_STATUSES)) throw invalidContract();
  return value;
}

function requireRunStatus(value: unknown): ClinicalRecordRunStatus {
  if (!isStringMember(value, CLINICAL_RECORD_RUN_STATUSES)) throw invalidContract();
  return value;
}

function isStringMember<Value extends string>(
  value: unknown,
  values: readonly Value[],
): value is Value {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

function requireExactRecord(value: unknown, keys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidContract();
  const record = value as Record<string, unknown>;
  if (keys.some((key) => !(key in record)) || Object.keys(record).some((key) => !keys.includes(key) && !optionalKeys.includes(key))) throw invalidContract();
  return record;
}

function requireArray(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) throw invalidContract();
  return value;
}

function requireString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || !value || value.length > maxLength) throw invalidContract();
  return value;
}

function requireIdentifier(value: unknown): string {
  const text = requireString(value, 120);
  if (!/^[A-Za-z0-9._-]+$/u.test(text)) throw invalidContract();
  return text;
}

function optionalString(value: unknown, maxLength: number): string | null {
  return value === null ? null : requireString(value, maxLength);
}

function requireIsoTimestamp(value: unknown): string {
  const text = requireString(value, 40);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) throw invalidContract();
  return text;
}

function optionalIsoTimestamp(value: unknown): string | null {
  return value === null ? null : requireIsoTimestamp(value);
}

function optionalErrorCode(value: unknown): string | null {
  if (value === null) return null;
  const text = requireString(value, 96);
  if (!/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u.test(text)) throw invalidContract();
  return text;
}

function requireCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidContract();
  return value;
}

function invalidContract(): ContractValidationError {
  return new ContractValidationError("Clinical Records response did not match the client contract.");
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ContractValidationError("Clinical Records boolean is invalid.");
  return value;
}
