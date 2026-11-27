import { ContractValidationError } from "@murphai/contracts/validation-error";
import { createHash } from "node:crypto";

import {
  clinicalFhirRetrievalPlanSchema,
  type ClinicalFhirRetrievalPlan,
  type ClinicalFhirRetrievalSlice,
} from "@murphai/clinical-records";

export const ORACLE_INTEGRATION_ID = "oracle-millennium-r4";
export const ORACLE_ACQUISITION_POLICY_ID = "oracle-millennium-r4-v1";
const DAY_MS = 86_400_000;

export interface OracleQuery {
  queryScopeId: string;
  resourceType: ClinicalFhirRetrievalSlice["resourceType"];
  operation: "read" | "search";
  fixedSearchParameters: readonly Readonly<{ name: string; value: string }>[];
  // Oracle documents a different range grammar per family. Families whose
  // update filter accepts only a lower bound stay whole-family on daily checks.
  dailyWindow?: Readonly<{ parameter: "_lastUpdated"; upperPrefix: "lt" | "le" }>;
}

const search = (
  queryScopeId: string,
  resourceType: OracleQuery["resourceType"],
  fixedSearchParameters: OracleQuery["fixedSearchParameters"] = [],
  upperPrefix?: "lt" | "le",
): OracleQuery => ({
  queryScopeId, resourceType, operation: "search", fixedSearchParameters,
  ...(upperPrefix ? { dailyWindow: { parameter: "_lastUpdated", upperPrefix } } : {}),
});
const count = (value: string) => ({ name: "_count", value });

// Order is the frozen-plan order. Each entry's fingerprint is derived from its
// complete request shape, so an edit creates a new identity instead of
// reinterpreting a frozen run.
const QUERIES: readonly OracleQuery[] = [
  { queryScopeId: "patient-demographics", resourceType: "Patient", operation: "read", fixedSearchParameters: [] },
  search("observations", "Observation", [count("200")], "lt"),
  search("conditions", "Condition", [], "lt"),
  search("diagnostic-reports", "DiagnosticReport", [count("100")], "lt"),
  search("document-references", "DocumentReference", [count("100")], "lt"),
  search("allergies", "AllergyIntolerance", [], "lt"),
  search("devices", "Device"),
  search("family-member-history", "FamilyMemberHistory"),
  search("goals", "Goal"),
  search("care-teams", "CareTeam"),
  search("care-plans", "CarePlan", [{ name: "category", value: "assess-plan" }]),
  // Oracle documents `status` as required beside `patient`; the O3 secure-sandbox check settles it before any run.
  search("encounters", "Encounter", [count("100")], "lt"),
  search("procedures", "Procedure", [], "lt"),
  search("immunizations", "Immunization"),
  search("medication-dispenses", "MedicationDispense", [count("100")]),
  search("medication-requests", "MedicationRequest", [count("100")], "le"),
  search("service-requests", "ServiceRequest", [count("100")], "le"),
  // Oracle returns referrals only for this category, all on the first page.
  search("service-request-referrals", "ServiceRequest",
    [{ name: "category", value: "http://snomed.info/sct|386053000" }, count("100")], "le"),
];

export const ORACLE_REQUESTED_BASE_SCOPES = Object.freeze(["openid", "fhirUser", "launch/patient"] as const);
export const ORACLE_RESOURCE_TYPES: readonly string[] = Object.freeze([...new Set(QUERIES.map((query) => query.resourceType))]);

/** Serialized into the directory artifact; the parser requires an exact match. */
export const ORACLE_ACQUISITION_POLICY = {
  id: ORACLE_ACQUISITION_POLICY_ID,
  policyVersion: "2026-11-26.oracle-millennium-r4-v1",
  queries: QUERIES,
  requestedBaseScopes: ORACLE_REQUESTED_BASE_SCOPES,
  sourceSystem: "cerner-fhir",
} as const;

export function isOracleQuery(queryScopeId: string): boolean {
  return QUERIES.some((query) => query.queryScopeId === queryScopeId);
}

export function buildOracleQueryFingerprintInput(query: OracleQuery): string {
  const shape = query.operation === "read" ? "read-by-launch-patient" : "search:patient";
  const fixed = query.fixedSearchParameters.map(({ name, value }) => `:${name}=${value}`).join("");
  const daily = query.dailyWindow ? `:daily=${query.dailyWindow.parameter}(ge,${query.dailyWindow.upperPrefix})` : "";
  return `${ORACLE_INTEGRATION_ID}:${query.resourceType}:${shape}${fixed}${daily}:v1`;
}

export function buildOracleRetrievalPlan(input: { resourceTypes: readonly string[] }): ClinicalFhirRetrievalPlan {
  const requested = new Set(input.resourceTypes);
  for (const resourceType of requested) {
    if (!ORACLE_RESOURCE_TYPES.includes(resourceType)) {
      throw new ContractValidationError(`FHIR resource type ${resourceType} is outside the Oracle acquisition policy.`);
    }
  }
  return clinicalFhirRetrievalPlanSchema.parse({
    schemaVersion: "murph.clinical-retrieval-plan.v1",
    slices: QUERIES.filter((query) => requested.has(query.resourceType)).map(wholeFamilySlice),
  });
}

/** Same cadence as Epic: a seven-day overlapping window, and lifetime every seventh check. */
export function buildOracleDailyRetrievalPlan(input: {
  previous: ClinicalFhirRetrievalPlan; now: Date; generation: number;
}): ClinicalFhirRetrievalPlan | null {
  const from = new Date(input.now.getTime() - 7 * DAY_MS).toISOString();
  const to = new Date(input.now.getTime() + DAY_MS).toISOString();
  const queries = input.previous.slices
    .map((slice) => QUERIES.find((query) => query.queryScopeId === slice.queryScopeId))
    .filter((query) => query !== undefined);
  const skipped = input.previous.slices.length - queries.length;
  if (skipped > 0) console.warn("Skipped retired medical-record queries in a daily plan.", { skipped });
  if (queries.length === 0) return null;
  return clinicalFhirRetrievalPlanSchema.parse({
    schemaVersion: input.previous.schemaVersion,
    slices: queries.map((query) => query.dailyWindow && input.generation % 7 !== 0
      ? { ...wholeFamilySlice(query), coverage: "bounded-window",
          sliceId: `daily-${input.now.toISOString().slice(0, 10)}`, from, to }
      : wholeFamilySlice(query)),
  });
}

export function buildOracleInitialFhirPageUrl(input: {
  fhirBaseUrl: string;
  patientId: string;
  retrievalSlice: ClinicalFhirRetrievalSlice;
}): URL {
  const slice = input.retrievalSlice;
  const query = QUERIES.find((candidate) => candidate.queryScopeId === slice.queryScopeId
    && candidate.resourceType === slice.resourceType
    && sha256Hex(buildOracleQueryFingerprintInput(candidate)) === slice.queryFingerprint);
  if (!query) throw new TypeError("Oracle retrieval identity does not match its query catalog.");
  if (slice.coverage === "whole-family" ? slice.sliceId !== "whole" : !query.dailyWindow) {
    throw new TypeError("Oracle retrieval slice does not match its query's date filter.");
  }
  const base = input.fhirBaseUrl.replace(/\/+$/u, "");
  if (query.operation === "read") return new URL(`${base}/${query.resourceType}/${encodeURIComponent(input.patientId)}`);
  const url = new URL(`${base}/${query.resourceType}`);
  url.searchParams.set("patient", input.patientId);
  for (const parameter of query.fixedSearchParameters) url.searchParams.append(parameter.name, parameter.value);
  if (slice.coverage === "bounded-window" && query.dailyWindow) {
    url.searchParams.append(query.dailyWindow.parameter, `ge${slice.from}`);
    url.searchParams.append(query.dailyWindow.parameter, `${query.dailyWindow.upperPrefix}${slice.to}`);
  }
  return url;
}

function wholeFamilySlice(query: OracleQuery): ClinicalFhirRetrievalSlice {
  return {
    coverage: "whole-family",
    queryFingerprint: sha256Hex(buildOracleQueryFingerprintInput(query)),
    queryScopeId: query.queryScopeId,
    resourceType: query.resourceType,
    sliceId: "whole",
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
