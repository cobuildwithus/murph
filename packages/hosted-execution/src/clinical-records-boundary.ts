export const HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS = 5 * 1024 * 1024;
// A JSON string can expand one UTF-16 code unit to six ASCII bytes (`\uXXXX`).
// Keep the transport envelope broad enough for every body accepted here so
// assistant-runtime remains the single owner of exact FHIR and raw-byte limits.
export const HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES =
  (6 * HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS) + (64 * 1024);
export const HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES = 32 * 1024 * 1024;
export const HOSTED_CLINICAL_RECORDS_MAX_PAGES = 500;
export const HOSTED_CLINICAL_RECORDS_MAX_CURSOR_CHARS = 2_048;
export const HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS = 120;
export const HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
export const HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS = 80;
export const HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
export const HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE =
  "authorization-required";
export const HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH =
  "/api/internal/clinical-records/connect-link";
export const HOSTED_CLINICAL_RECORDS_CONNECT_LINK_RESPONSE_MAX_BYTES = 4 * 1024;
export const HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH =
  "/api/internal/clinical-records/runtime/read-run";
export const HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH =
  "/api/internal/clinical-records/runtime/fetch-page";
export const HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH =
  "/api/internal/clinical-records/runtime/record-outcome";

export interface HostedClinicalRecordsOutcomeCounts {
  createdCount: number;
  executableDecisionCount: number;
  fetchedPageCount: number;
  fetchedResourceFamilyCount: number;
  rawFileCount: number;
  retractedCount: number;
  reviewDecisionCount: number;
  skippedExistingCount: number;
  supersededCount: number;
}

export interface HostedClinicalRecordsRecordOutcomeRequest {
  counts: HostedClinicalRecordsOutcomeCounts;
  errorCode?: string;
  generation: number;
  runId: string;
  status: "completed" | "failed" | "partial" | "preempted";
}

export function parseHostedClinicalRecordsIdentifier(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > HOSTED_CLINICAL_RECORDS_IDENTIFIER_MAX_CHARS
    || !HOSTED_CLINICAL_RECORDS_IDENTIFIER_PATTERN.test(value)
  ) {
    throw new TypeError("Hosted clinical records identifier is invalid.");
  }
  return value;
}

export function parseHostedClinicalRecordsRecordOutcomeRequest(
  value: unknown,
): HostedClinicalRecordsRecordOutcomeRequest {
  const record = requireExactObject(
    value,
    ["counts", "errorCode", "generation", "runId", "status"],
    "Hosted clinical records outcome request",
  );
  const counts = requireExactObject(
    Reflect.get(record, "counts"),
    [
      "createdCount",
      "executableDecisionCount",
      "fetchedPageCount",
      "fetchedResourceFamilyCount",
      "rawFileCount",
      "retractedCount",
      "reviewDecisionCount",
      "skippedExistingCount",
      "supersededCount",
    ],
    "Hosted clinical records outcome counts",
  );
  const errorCode = Reflect.get(record, "errorCode");
  return {
    counts: {
      createdCount: parseNonNegativeCount(Reflect.get(counts, "createdCount")),
      executableDecisionCount: parseNonNegativeCount(
        Reflect.get(counts, "executableDecisionCount"),
      ),
      fetchedPageCount: parseNonNegativeCount(Reflect.get(counts, "fetchedPageCount")),
      fetchedResourceFamilyCount: parseNonNegativeCount(
        Reflect.get(counts, "fetchedResourceFamilyCount"),
      ),
      rawFileCount: parseNonNegativeCount(Reflect.get(counts, "rawFileCount")),
      retractedCount: parseNonNegativeCount(Reflect.get(counts, "retractedCount")),
      reviewDecisionCount: parseNonNegativeCount(Reflect.get(counts, "reviewDecisionCount")),
      skippedExistingCount: parseNonNegativeCount(
        Reflect.get(counts, "skippedExistingCount"),
      ),
      supersededCount: parseNonNegativeCount(Reflect.get(counts, "supersededCount")),
    },
    ...(errorCode === undefined ? {} : { errorCode: parseErrorCode(errorCode) }),
    generation: parsePositiveSafeInteger(Reflect.get(record, "generation")),
    runId: parseHostedClinicalRecordsIdentifier(Reflect.get(record, "runId")),
    status: parseOutcomeStatus(Reflect.get(record, "status")),
  };
}

function requireExactObject(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new TypeError(`${label} contains an unsupported field.`);
  }
  return value;
}

function parseNonNegativeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new TypeError("Hosted clinical records outcome count is invalid.");
  }
  return value;
}

function parsePositiveSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted clinical records outcome generation is invalid.");
  }
  return value;
}

function parseErrorCode(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > HOSTED_CLINICAL_RECORDS_ERROR_CODE_MAX_CHARS
    || !HOSTED_CLINICAL_RECORDS_ERROR_CODE_PATTERN.test(value)
  ) {
    throw new TypeError("Hosted clinical records outcome error code is invalid.");
  }
  return value;
}

function parseOutcomeStatus(
  value: unknown,
): HostedClinicalRecordsRecordOutcomeRequest["status"] {
  if (value === "completed" || value === "failed" || value === "partial" || value === "preempted") {
    return value;
  }
  throw new TypeError("Hosted clinical records outcome status is invalid.");
}
