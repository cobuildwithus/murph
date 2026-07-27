import { createHash } from "node:crypto";

import {
  clinicalFhirRetrievalPlanSchema,
  type ClinicalFhirRetrievalPlan,
  type ClinicalFhirRetrievalSlice,
} from "@murphai/clinical-records";

export const EPIC_ACQUISITION_POLICY_ID = "epic-r4-longitudinal-v1";
export const EPIC_ACQUISITION_POLICY_VERSION = "2026-07-21.longitudinal-active-v4";
export const EPIC_BETA_FHIR_PAGE_COUNT = "100";

const REQUIRED_BASE_SCOPES = Object.freeze(["fhirUser", "launch/patient", "openid"] as const);
export const EPIC_BETA_REQUESTED_BASE_SCOPES = Object.freeze([
  "openid",
  "fhirUser",
  "launch/patient",
] as const);
export type EpicFhirOperation = "read" | "search";
export type EpicQueryStatus = "active-beta" | "disabled";
export type EpicDependencyPurpose =
  | "attachment"
  | "author"
  | "context"
  | "location"
  | "medication"
  | "order"
  | "performer"
  | "provenance"
  | "result-member"
  | "specimen";

export interface EpicRegistrationApi {
  epicCatalogName: string;
  key: string;
  operation: EpicFhirOperation;
  resourceType: string;
}

export interface EpicQueryTemplate {
  fingerprintTemplate: string;
  fixedSearchParameters: readonly Readonly<{ name: string; value: string }>[];
  id: string;
  operation: EpicFhirOperation;
  patientBinding: "path-id" | "patient-search-parameter";
  resourceType: string;
  windowParameter?: string;
}

export type EpicSlicingPolicy =
  | Readonly<{
      id: string;
      kind: "whole-scope";
    }>
  | Readonly<{
      direction: "newest-first";
      id: string;
      initialWindowDays: number;
      kind: "bounded-window";
      minimumWindowDays: number;
      overlapDays: number;
    }>;

export interface EpicDependencyPolicy {
  allowedParentQueryScopeIds: readonly string[];
  countsTowardParentSliceLimits: true;
  id: string;
  maxTraversalDepth: 2;
  operation: EpicFhirOperation;
  purpose: EpicDependencyPurpose;
  registrationApiKeys: readonly string[];
  resourceType: string;
  sameFhirBaseOnly: true;
}

export interface EpicQueryScopePolicy {
  activeOrder?: number;
  dependencyPolicyIds: readonly string[];
  queryScopeId: string;
  queryTemplateId: string;
  registrationApiKeys: readonly string[];
  requiredOperations: readonly EpicFhirOperation[];
  resourceType: string;
  slicingPolicyId: string;
  status: EpicQueryStatus;
}

export interface EpicAcquisitionPolicy {
  dependencyPolicies: readonly EpicDependencyPolicy[];
  id: string;
  policyVersion: string;
  queryScopes: readonly EpicQueryScopePolicy[];
  queryTemplates: readonly EpicQueryTemplate[];
  registrationApis: readonly EpicRegistrationApi[];
  requestedBaseScopes: readonly string[];
  slicingPolicies: readonly EpicSlicingPolicy[];
  sourceSystem: "epic-fhir";
}

const REGISTRATION_APIS = [
  registrationApi("allergy-intolerance-search-patient-chart", "AllergyIntolerance.Search (Patient Chart) (R4)", "AllergyIntolerance", "search"),
  registrationApi("binary-read-clinical-notes", "Binary.Read (Clinical Notes) (R4)", "Binary", "read"),
  registrationApi("care-plan-search-longitudinal", "CarePlan.Search (Longitudinal) (R4)", "CarePlan", "search"),
  registrationApi("care-team-search-longitudinal", "CareTeam.Search (Longitudinal CareTeam) (R4)", "CareTeam", "search"),
  registrationApi("condition-search-encounter-diagnosis", "Condition.Search (Encounter Diagnosis) (R4)", "Condition", "search"),
  registrationApi("condition-search-problems", "Condition.Search (Problems) (R4)", "Condition", "search"),
  registrationApi("device-search-implants", "Device.Search (Implants) (R4)", "Device", "search"),
  registrationApi("diagnostic-report-search-results", "DiagnosticReport.Search (Results) (R4)", "DiagnosticReport", "search"),
  registrationApi("document-reference-search-clinical-notes", "DocumentReference.Search (Clinical Notes) (R4)", "DocumentReference", "search"),
  registrationApi("encounter-read-patient-chart", "Encounter.Read (Patient Chart) (R4)", "Encounter", "read"),
  registrationApi("encounter-search-patient-chart", "Encounter.Search (Patient Chart) (R4)", "Encounter", "search"),
  registrationApi("family-member-history-search", "FamilyMemberHistory.Search (R4)", "FamilyMemberHistory", "search"),
  registrationApi("goal-search-patient", "Goal.Search (Patient) (R4)", "Goal", "search"),
  registrationApi("immunization-search-patient-chart", "Immunization.Search (Patient Chart) (R4)", "Immunization", "search"),
  registrationApi("location-read-organizational-directory", "Location.Read (Organizational Directory) (R4)", "Location", "read"),
  registrationApi("medication-dispense-search-fill-status", "MedicationDispense.Search (Fill Status) (R4)", "MedicationDispense", "search"),
  registrationApi("medication-read-organization-med-list", "Medication.Read (Organization Med List) (R4)", "Medication", "read"),
  registrationApi("medication-request-read-signed-order", "MedicationRequest.Read (Signed Medication Order) (R4)", "MedicationRequest", "read"),
  registrationApi("medication-request-search-signed-order", "MedicationRequest.Search (Signed Medication Order) (R4)", "MedicationRequest", "search"),
  registrationApi("observation-read-assessment-member", "Observation.Read (Assessments) (R4)", "Observation", "read"),
  registrationApi("observation-read-lab-result", "Observation.Read (Labs) (R4)", "Observation", "read"),
  registrationApi("observation-search-assessments", "Observation.Search (Assessments) (R4)", "Observation", "search"),
  registrationApi("observation-search-labs", "Observation.Search (Labs) (R4)", "Observation", "search"),
  registrationApi("observation-search-sdoh-assessments", "Observation.Search (SDOH Assessments) (R4)", "Observation", "search"),
  registrationApi("observation-search-social-history", "Observation.Search (Social History) (R4)", "Observation", "search"),
  registrationApi("observation-search-vital-signs", "Observation.Search (Vital Signs) (R4)", "Observation", "search"),
  registrationApi("organization-read-organizational-directory", "Organization.Read (Organizational Directory) (R4)", "Organization", "read"),
  registrationApi("patient-read-demographics", "Patient.Read (Demographics) (R4)", "Patient", "read"),
  registrationApi("practitioner-read-organizational-directory", "Practitioner.Read (Organizational Directory) (R4)", "Practitioner", "read"),
  registrationApi("practitioner-role-read-organizational-directory", "PractitionerRole.Read (Organizational Directory) (R4)", "PractitionerRole", "read"),
  registrationApi("procedure-search-orders", "Procedure.Search (Orders) (R4)", "Procedure", "search"),
  registrationApi("procedure-search-surgeries", "Procedure.Search (Surgeries) (R4)", "Procedure", "search"),
  registrationApi("procedure-search-surgical-history", "Procedure.Search (Patient-Reported Surgical History) (R4)", "Procedure", "search"),
  registrationApi("provenance-read", "Provenance.Read (R4)", "Provenance", "read"),
  registrationApi("service-request-read-orders", "ServiceRequest.Read (Orders) (R4)", "ServiceRequest", "read"),
  registrationApi("service-request-search-orders", "ServiceRequest.Search (Orders) (R4)", "ServiceRequest", "search"),
  registrationApi("specimen-read-patient-chart", "Specimen.Read (Patient Chart) (R4)", "Specimen", "read"),
] as const satisfies readonly EpicRegistrationApi[];

const QUERY_TEMPLATES = [
  searchTemplate("allergies-search", "AllergyIntolerance"),
  searchTemplate("care-plans-search", "CarePlan"),
  searchTemplate("care-teams-search", "CareTeam"),
  searchTemplate("condition-encounter-diagnoses-search", "Condition", { category: "encounter-diagnosis" }),
  searchTemplate("condition-problem-list-search", "Condition", { category: "problem-list-item" }),
  searchTemplate("device-implants-search", "Device"),
  searchTemplate("diagnostic-reports-search", "DiagnosticReport", {}, undefined, "epic-fhir-r4:DiagnosticReport:search:patient:_count={pageCount}:v1"),
  searchTemplate("document-references-notes-search", "DocumentReference", { category: "clinical-note" }, "period"),
  searchTemplate("encounters-search", "Encounter", {}, "date"),
  searchTemplate("family-member-history-search", "FamilyMemberHistory"),
  searchTemplate("immunizations-search", "Immunization", {}, "date"),
  searchTemplate("laboratory-observations-search", "Observation", { category: "laboratory" }, undefined, "epic-fhir-r4:Observation:search:patient:category=laboratory:_count={pageCount}:v1"),
  searchTemplate("medication-dispenses-search", "MedicationDispense"),
  searchTemplate("medication-requests-search", "MedicationRequest"),
  searchTemplate("observation-assessments-search", "Observation", { category: "survey" }, "date"),
  searchTemplate("observation-sdoh-assessments-search", "Observation", { category: "sdoh" }, "date"),
  searchTemplate("observation-social-history-search", "Observation", { category: "social-history" }, "issued"),
  {
    fingerprintTemplate: "epic-fhir-r4:Patient:read-by-launch-patient:v1",
    fixedSearchParameters: [],
    id: "patient-demographics-read",
    operation: "read",
    patientBinding: "path-id",
    resourceType: "Patient",
  },
  searchTemplate("procedure-orders-search", "Procedure", {}, "date"),
  searchTemplate("procedure-surgeries-search", "Procedure", { category: "387713003" }, "date"),
  searchTemplate("procedure-surgical-history-search", "Procedure", { category: "387713003" }),
  searchTemplate("provider-goals-search", "Goal"),
  searchTemplate("service-requests-search", "ServiceRequest"),
  searchTemplate("vital-sign-observations-search", "Observation", { category: "vital-signs" }, "date"),
] as const satisfies readonly EpicQueryTemplate[];

const SLICING_POLICIES = [
  {
    direction: "newest-first",
    id: "bounded-date-365d",
    initialWindowDays: 365,
    kind: "bounded-window",
    minimumWindowDays: 1,
    overlapDays: 1,
  },
  {
    direction: "newest-first",
    id: "bounded-period-90d",
    initialWindowDays: 90,
    kind: "bounded-window",
    minimumWindowDays: 1,
    overlapDays: 1,
  },
  { id: "whole-scope", kind: "whole-scope" },
] as const satisfies readonly EpicSlicingPolicy[];

const DEPENDENCY_POLICIES = [
  dependencyPolicy("binary-attachment", "Binary", "read", "attachment", ["document-references-notes"], ["binary-read-clinical-notes"]),
  dependencyPolicy("encounter-context", "Encounter", "read", "context", [
    "care-plans",
    "condition-encounter-diagnoses",
    "diagnostic-reports",
    "document-references-notes",
    "immunizations",
    "laboratory-observations",
    "observation-assessments",
    "observation-sdoh-assessments",
    "procedure-orders",
    "procedure-surgeries",
    "service-requests",
    "vital-sign-observations",
  ], ["encounter-read-patient-chart"]),
  dependencyPolicy("location-context", "Location", "read", "location", ["encounters", "immunizations"], ["location-read-organizational-directory"]),
  dependencyPolicy("medication-definition", "Medication", "read", "medication", ["medication-dispenses", "medication-requests"], ["medication-read-organization-med-list"]),
  dependencyPolicy("medication-request-context", "MedicationRequest", "read", "order", ["medication-dispenses"], ["medication-request-read-signed-order"]),
  dependencyPolicy("observation-result-member", "Observation", "read", "result-member", [
    "diagnostic-reports",
    "laboratory-observations",
    "observation-assessments",
    "observation-sdoh-assessments",
  ], ["observation-read-assessment-member", "observation-read-lab-result"]),
  dependencyPolicy("organization-context", "Organization", "read", "performer", [
    "care-plans",
    "care-teams",
    "diagnostic-reports",
    "document-references-notes",
    "encounters",
    "immunizations",
    "laboratory-observations",
    "medication-dispenses",
    "medication-requests",
    "procedure-orders",
    "procedure-surgeries",
    "provider-goals",
    "service-requests",
  ], ["organization-read-organizational-directory"]),
  dependencyPolicy("practitioner-context", "Practitioner", "read", "author", [
    "allergies",
    "care-plans",
    "care-teams",
    "condition-encounter-diagnoses",
    "condition-problem-list",
    "diagnostic-reports",
    "document-references-notes",
    "encounters",
    "immunizations",
    "laboratory-observations",
    "medication-dispenses",
    "medication-requests",
    "observation-assessments",
    "observation-sdoh-assessments",
    "procedure-orders",
    "procedure-surgeries",
    "provider-goals",
    "service-requests",
    "vital-sign-observations",
  ], ["practitioner-read-organizational-directory"]),
  dependencyPolicy("practitioner-role-context", "PractitionerRole", "read", "performer", [
    "care-teams",
    "document-references-notes",
    "encounters",
  ], ["practitioner-role-read-organizational-directory"]),
  dependencyPolicy("provenance-target", "Provenance", "read", "provenance", [
    "condition-problem-list",
    "diagnostic-reports",
    "document-references-notes",
    "laboratory-observations",
    "medication-requests",
  ], ["provenance-read"]),
  dependencyPolicy("service-request-context", "ServiceRequest", "read", "order", [
    "diagnostic-reports",
    "observation-sdoh-assessments",
    "procedure-orders",
    "procedure-surgeries",
  ], ["service-request-read-orders"]),
  dependencyPolicy("specimen-context", "Specimen", "read", "specimen", [
    "diagnostic-reports",
    "laboratory-observations",
  ], ["specimen-read-patient-chart"]),
] as const satisfies readonly EpicDependencyPolicy[];

const ACTIVE_QUERY_SCOPE_ORDER = [
  "patient-demographics",
  "laboratory-observations",
  "diagnostic-reports",
  "allergies",
  "care-plans",
  "care-teams",
  "condition-encounter-diagnoses",
  "condition-problem-list",
  "device-implants",
  "document-references-notes",
  "encounters",
  "family-member-history",
  "immunizations",
  "medication-dispenses",
  "medication-requests",
  "observation-assessments",
  "observation-sdoh-assessments",
  "observation-social-history",
  "procedure-orders",
  "procedure-surgeries",
  "procedure-surgical-history",
  "provider-goals",
  "service-requests",
  "vital-sign-observations",
] as const;

const QUERY_SCOPES = [
  queryScope("allergies", "AllergyIntolerance", "allergies-search", "whole-scope", ["allergy-intolerance-search-patient-chart"], ["practitioner-context"]),
  queryScope("care-plans", "CarePlan", "care-plans-search", "whole-scope", ["care-plan-search-longitudinal"], ["encounter-context", "organization-context", "practitioner-context"]),
  queryScope("care-teams", "CareTeam", "care-teams-search", "whole-scope", ["care-team-search-longitudinal"], ["organization-context", "practitioner-context", "practitioner-role-context"]),
  queryScope("condition-encounter-diagnoses", "Condition", "condition-encounter-diagnoses-search", "whole-scope", ["condition-search-encounter-diagnosis"], ["encounter-context", "practitioner-context"]),
  queryScope("condition-problem-list", "Condition", "condition-problem-list-search", "whole-scope", ["condition-search-problems"], ["practitioner-context", "provenance-target"]),
  queryScope("device-implants", "Device", "device-implants-search", "whole-scope", ["device-search-implants"], []),
  queryScope("diagnostic-reports", "DiagnosticReport", "diagnostic-reports-search", "whole-scope", ["diagnostic-report-search-results"], []),
  queryScope("document-references-notes", "DocumentReference", "document-references-notes-search", "bounded-period-90d", ["document-reference-search-clinical-notes"], ["binary-attachment", "encounter-context", "organization-context", "practitioner-context", "practitioner-role-context", "provenance-target"]),
  queryScope("encounters", "Encounter", "encounters-search", "bounded-date-365d", ["encounter-search-patient-chart"], ["location-context", "organization-context", "practitioner-context", "practitioner-role-context"]),
  queryScope("family-member-history", "FamilyMemberHistory", "family-member-history-search", "whole-scope", ["family-member-history-search"], []),
  queryScope("immunizations", "Immunization", "immunizations-search", "bounded-date-365d", ["immunization-search-patient-chart"], ["encounter-context", "location-context", "organization-context", "practitioner-context"]),
  queryScope("laboratory-observations", "Observation", "laboratory-observations-search", "whole-scope", ["observation-search-labs"], []),
  queryScope("medication-dispenses", "MedicationDispense", "medication-dispenses-search", "whole-scope", ["medication-dispense-search-fill-status"], ["medication-definition", "medication-request-context", "organization-context", "practitioner-context"]),
  queryScope("medication-requests", "MedicationRequest", "medication-requests-search", "whole-scope", ["medication-request-search-signed-order"], ["medication-definition", "organization-context", "practitioner-context", "provenance-target"]),
  queryScope("observation-assessments", "Observation", "observation-assessments-search", "bounded-date-365d", ["observation-search-assessments"], ["encounter-context", "observation-result-member", "practitioner-context"]),
  queryScope("observation-sdoh-assessments", "Observation", "observation-sdoh-assessments-search", "bounded-date-365d", ["observation-search-sdoh-assessments"], ["encounter-context", "observation-result-member", "practitioner-context", "service-request-context"]),
  queryScope("observation-social-history", "Observation", "observation-social-history-search", "bounded-date-365d", ["observation-search-social-history"], []),
  queryScope("patient-demographics", "Patient", "patient-demographics-read", "whole-scope", ["patient-read-demographics"], []),
  queryScope("procedure-orders", "Procedure", "procedure-orders-search", "bounded-date-365d", ["procedure-search-orders"], ["encounter-context", "organization-context", "practitioner-context", "service-request-context"]),
  queryScope("procedure-surgeries", "Procedure", "procedure-surgeries-search", "bounded-date-365d", ["procedure-search-surgeries"], ["encounter-context", "organization-context", "practitioner-context", "service-request-context"]),
  queryScope("procedure-surgical-history", "Procedure", "procedure-surgical-history-search", "whole-scope", ["procedure-search-surgical-history"], []),
  queryScope("provider-goals", "Goal", "provider-goals-search", "whole-scope", ["goal-search-patient"], ["organization-context", "practitioner-context"]),
  queryScope("service-requests", "ServiceRequest", "service-requests-search", "whole-scope", ["service-request-search-orders"], ["encounter-context", "organization-context", "practitioner-context"]),
  queryScope("vital-sign-observations", "Observation", "vital-sign-observations-search", "bounded-date-365d", ["observation-search-vital-signs"], ["encounter-context", "practitioner-context"]),
].map((query) => ({
  ...query,
  activeOrder: activeOrderForQueryScope(query.queryScopeId),
})) satisfies readonly EpicQueryScopePolicy[];

const EPIC_ACQUISITION_POLICY_INPUT = {
  dependencyPolicies: DEPENDENCY_POLICIES,
  id: EPIC_ACQUISITION_POLICY_ID,
  policyVersion: EPIC_ACQUISITION_POLICY_VERSION,
  queryScopes: QUERY_SCOPES,
  queryTemplates: QUERY_TEMPLATES,
  registrationApis: REGISTRATION_APIS,
  requestedBaseScopes: REQUIRED_BASE_SCOPES,
  slicingPolicies: SLICING_POLICIES,
  sourceSystem: "epic-fhir",
} as const satisfies EpicAcquisitionPolicy;

export const EPIC_ACQUISITION_POLICY: EpicAcquisitionPolicy =
  EPIC_ACQUISITION_POLICY_INPUT;

const ACTIVE_QUERY_SCOPES = Object.freeze(
  EPIC_ACQUISITION_POLICY.queryScopes
    .filter((query) => query.status === "active-beta")
    .sort((left, right) => (left.activeOrder ?? 0) - (right.activeOrder ?? 0)),
);

export const EPIC_BETA_RESOURCE_TYPES = Object.freeze(
  [
    "Patient",
    "Observation",
    "DiagnosticReport",
    "AllergyIntolerance",
    "CarePlan",
    "CareTeam",
    "Condition",
    "Device",
    "DocumentReference",
    "Encounter",
    "FamilyMemberHistory",
    "Immunization",
    "MedicationDispense",
    "MedicationRequest",
    "Procedure",
    "Goal",
    "ServiceRequest",
  ] as const,
);

export type EpicBetaResourceType = (typeof EPIC_BETA_RESOURCE_TYPES)[number];
const EPIC_BETA_RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(EPIC_BETA_RESOURCE_TYPES);
type SmartPermissionVersion = "v1" | "v2";

export function buildEpicBetaRetrievalPlan(input: {
  frozenAt: Date;
  pageCount: string;
  resourceTypes: readonly string[];
}): ClinicalFhirRetrievalPlan {
  assertValidFrozenAt(input.frozenAt);
  const requestedResourceTypes = new Set(input.resourceTypes);
  for (const resourceType of requestedResourceTypes) {
    requireActiveQueriesForResource(resourceType);
  }
  return clinicalFhirRetrievalPlanSchema.parse({
    schemaVersion: "murph.clinical-retrieval-plan.v1",
    slices: ACTIVE_QUERY_SCOPES
      .filter((query) => requestedResourceTypes.has(query.resourceType))
      .map((query) => buildActiveRetrievalSlice({
        frozenAt: input.frozenAt,
        pageCount: input.pageCount,
        query,
      })),
  });
}

export function buildEpicLegacyBetaRetrievalPlan(input: {
  pageCount: string;
  resourceTypes: readonly string[];
}): ClinicalFhirRetrievalPlan {
  return clinicalFhirRetrievalPlanSchema.parse({
    schemaVersion: "murph.clinical-retrieval-plan.v1",
    slices: input.resourceTypes.map((resourceType) => {
      const queryScopeId = legacyQueryScopeIdForResource(resourceType);
      return {
        coverage: "whole-family",
        queryFingerprint: sha256Hex(
          buildEpicBetaRetrievalQueryFingerprintInput({
            pageCount: input.pageCount,
            queryScopeId,
          }),
        ),
        queryScopeId,
        resourceType,
        sliceId: "whole",
      };
    }),
  });
}

export function buildEpicBetaSmartResourceScope(input: {
  permissionVersion: SmartPermissionVersion;
  resourceType: string;
}): string {
  const queries = requireActiveQueriesForResource(input.resourceType);
  const permission = input.permissionVersion === "v1"
    ? "read"
    : (["read", "search"] as const)
      .filter((operation) => queries.some((query) => query.requiredOperations.includes(operation)))
      .map((operation) => operation === "read" ? "r" : "s")
      .join("");
  return `patient/${input.resourceType}.${permission}`;
}

export function readGrantedEpicBetaResourceTypes(
  scopes: readonly string[],
  candidateResourceTypes: readonly string[] = EPIC_BETA_RESOURCE_TYPES,
): EpicBetaResourceType[] {
  const candidates = candidateResourceTypes.filter(isEpicBetaResourceType);
  return candidates.filter((resourceType) => {
    const requiredOperations = new Set(
      requireActiveQueriesForResource(resourceType).flatMap((query) => query.requiredOperations),
    );
    return scopes.some((scope) => [...requiredOperations].every((operation) =>
      scopeGrantsEpicOperation(scope, resourceType, operation)
    ));
  });
}

export function buildEpicBetaRetrievalQueryFingerprintInput(input: {
  pageCount: string;
  queryScopeId: string;
}): string {
  const query = requireActiveQueryForScope(input.queryScopeId);
  const template = requireQueryTemplate(query.queryTemplateId);
  return template.fingerprintTemplate.replaceAll("{pageCount}", input.pageCount);
}

export function buildEpicBetaInitialFhirPageUrl(input: {
  fhirBaseUrl: string;
  pageCount: string;
  patientId: string;
  retrievalSlice: ClinicalFhirRetrievalSlice;
}): URL {
  const query = requireActiveQueryForScope(input.retrievalSlice.queryScopeId);
  const expectedQueryFingerprint = sha256Hex(
    buildEpicBetaRetrievalQueryFingerprintInput({
      pageCount: input.pageCount,
      queryScopeId: query.queryScopeId,
    }),
  );
  if (
    query.resourceType !== input.retrievalSlice.resourceType
    || expectedQueryFingerprint !== input.retrievalSlice.queryFingerprint
  ) {
    throw new TypeError("Epic beta retrieval identity does not match its active query scope.");
  }
  const template = requireQueryTemplate(query.queryTemplateId);
  const slicingPolicy = requireSlicingPolicy(query.slicingPolicyId);
  if (
    (slicingPolicy.kind === "whole-scope"
      && (input.retrievalSlice.coverage !== "whole-family" || input.retrievalSlice.sliceId !== "whole"))
    || (slicingPolicy.kind === "bounded-window"
      && (input.retrievalSlice.coverage !== "bounded-window" || !template.windowParameter))
  ) {
    throw new TypeError("Epic beta retrieval slice does not match its active slicing policy.");
  }
  const base = input.fhirBaseUrl.replace(/\/+$/u, "");
  if (template.patientBinding === "path-id") {
    return new URL(`${base}/${template.resourceType}/${encodeURIComponent(input.patientId)}`);
  }
  const url = new URL(`${base}/${template.resourceType}`);
  url.searchParams.set("patient", input.patientId);
  for (const parameter of template.fixedSearchParameters) {
    url.searchParams.set(parameter.name, parameter.value);
  }
  if (input.retrievalSlice.coverage === "bounded-window" && template.windowParameter) {
    url.searchParams.append(template.windowParameter, `ge${input.retrievalSlice.from}`);
    url.searchParams.append(template.windowParameter, `lt${input.retrievalSlice.to}`);
  }
  url.searchParams.set("_count", input.pageCount);
  return url;
}

export function isEpicBetaResourceType(value: string): value is EpicBetaResourceType {
  return EPIC_BETA_RESOURCE_TYPE_SET.has(value);
}

function registrationApi(
  key: string,
  epicCatalogName: string,
  resourceType: string,
  operation: EpicFhirOperation,
): EpicRegistrationApi {
  return { epicCatalogName, key, operation, resourceType };
}

function searchTemplate(
  id: string,
  resourceType: string,
  fixedParameters: Readonly<Record<string, string>> = {},
  windowParameter?: string,
  fingerprintTemplate?: string,
): EpicQueryTemplate {
  const fixedSearchParameters = Object.entries(fixedParameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, value }));
  const fixedFingerprint = fixedSearchParameters
    .map((parameter) => `${parameter.name}=${parameter.value}`)
    .join(":");
  return {
    fingerprintTemplate: fingerprintTemplate
      ?? ["epic-fhir-r4", resourceType, "search", "patient", fixedFingerprint, "_count={pageCount}", "v1"]
        .filter(Boolean)
        .join(":"),
    fixedSearchParameters,
    id,
    operation: "search",
    patientBinding: "patient-search-parameter",
    resourceType,
    ...(windowParameter ? { windowParameter } : {}),
  };
}

function dependencyPolicy(
  id: string,
  resourceType: string,
  operation: EpicFhirOperation,
  purpose: EpicDependencyPurpose,
  allowedParentQueryScopeIds: readonly string[],
  registrationApiKeys: readonly string[],
): EpicDependencyPolicy {
  return {
    allowedParentQueryScopeIds,
    countsTowardParentSliceLimits: true,
    id,
    maxTraversalDepth: 2,
    operation,
    purpose,
    registrationApiKeys,
    resourceType,
    sameFhirBaseOnly: true,
  };
}

function queryScope(
  queryScopeId: string,
  resourceType: string,
  queryTemplateId: string,
  slicingPolicyId: string,
  registrationApiKeys: readonly string[],
  dependencyPolicyIds: readonly string[],
): EpicQueryScopePolicy {
  return {
    dependencyPolicyIds,
    queryScopeId,
    queryTemplateId,
    registrationApiKeys,
    requiredOperations: [queryTemplateId.endsWith("-read") ? "read" : "search"],
    resourceType,
    slicingPolicyId,
    status: "active-beta",
  };
}

function activeOrderForQueryScope(queryScopeId: string): number {
  const activeOrder = ACTIVE_QUERY_SCOPE_ORDER.findIndex(
    (candidate) => candidate === queryScopeId,
  );
  if (activeOrder < 0) {
    throw new TypeError(`FHIR query scope ${queryScopeId} is missing from the Epic activation order.`);
  }
  return activeOrder;
}

function requireActiveQueriesForResource(resourceType: string): EpicQueryScopePolicy[] {
  const queries = ACTIVE_QUERY_SCOPES.filter((candidate) => candidate.resourceType === resourceType);
  if (queries.length === 0) {
    throw new TypeError(`FHIR resource type ${resourceType} is outside the active Epic beta acquisition policy.`);
  }
  return queries;
}

function requireActiveQueryForScope(queryScopeId: string): EpicQueryScopePolicy {
  const query = ACTIVE_QUERY_SCOPES.find(
    (candidate) => candidate.queryScopeId === queryScopeId,
  );
  if (!query) {
    throw new TypeError(
      `FHIR query scope ${queryScopeId} is outside the active Epic beta acquisition policy.`,
    );
  }
  return query;
}

function requireQueryTemplate(queryTemplateId: string): EpicQueryTemplate {
  const template = EPIC_ACQUISITION_POLICY.queryTemplates.find((candidate) => candidate.id === queryTemplateId);
  if (!template) throw new TypeError("Epic query scope references an unknown query template.");
  return template;
}

function requireSlicingPolicy(slicingPolicyId: string): EpicSlicingPolicy {
  const policy = EPIC_ACQUISITION_POLICY.slicingPolicies.find(
    (candidate) => candidate.id === slicingPolicyId,
  );
  if (!policy) throw new TypeError("Epic query scope references an unknown slicing policy.");
  return policy;
}

function buildActiveRetrievalSlice(input: {
  frozenAt: Date;
  pageCount: string;
  query: EpicQueryScopePolicy;
}): ClinicalFhirRetrievalSlice {
  const resourceType = requireEpicBetaResourceType(input.query.resourceType);
  const queryFingerprint = sha256Hex(
    buildEpicBetaRetrievalQueryFingerprintInput({
      pageCount: input.pageCount,
      queryScopeId: input.query.queryScopeId,
    }),
  );
  const slicingPolicy = requireSlicingPolicy(input.query.slicingPolicyId);
  if (slicingPolicy.kind === "whole-scope") {
    return {
      coverage: "whole-family",
      queryFingerprint,
      queryScopeId: input.query.queryScopeId,
      resourceType,
      sliceId: "whole",
    };
  }
  const to = input.frozenAt.toISOString();
  const from = new Date(
    input.frozenAt.getTime() - slicingPolicy.initialWindowDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  return {
    coverage: "bounded-window",
    from,
    queryFingerprint,
    queryScopeId: input.query.queryScopeId,
    resourceType,
    sliceId: `window-${compactIsoDate(from)}-${compactIsoDate(to)}`,
    to,
  };
}

function requireEpicBetaResourceType(value: string): EpicBetaResourceType {
  if (!isEpicBetaResourceType(value)) {
    throw new TypeError(`FHIR resource type ${value} is outside the active Epic beta acquisition policy.`);
  }
  return value;
}

function legacyQueryScopeIdForResource(resourceType: string): string {
  if (resourceType === "Patient") return "patient-demographics";
  if (resourceType === "Observation") return "laboratory-observations";
  if (resourceType === "DiagnosticReport") return "diagnostic-reports";
  throw new TypeError(`FHIR resource type ${resourceType} is outside the legacy Epic beta acquisition policy.`);
}

function compactIsoDate(value: string): string {
  return value.slice(0, 10).replaceAll("-", "");
}

function assertValidFrozenAt(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError("Epic retrieval plan requires a valid frozen timestamp.");
  }
}

function scopeGrantsEpicOperation(
  scope: string,
  resourceType: EpicBetaResourceType,
  operation: EpicFhirOperation,
): boolean {
  const match = /^patient\/([A-Z][A-Za-z0-9]+|\*)\.([a-z]+)$/u.exec(scope);
  if (!match || (match[1] !== "*" && match[1] !== resourceType)) return false;
  const permission = match[2] ?? "";
  if (permission === "read") return true;
  if (!/^c?r?u?d?s?$/u.test(permission)) return false;
  return permission.includes(operation === "read" ? "r" : "s");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
