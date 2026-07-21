import { createHash } from "node:crypto";

import {
  clinicalFhirRetrievalPlanSchema,
  type ClinicalFhirRetrievalPlan,
} from "@murphai/clinical-records";

export const EPIC_ACQUISITION_POLICY_ID = "epic-r4-longitudinal-v1";
export const EPIC_ACQUISITION_POLICY_VERSION = "2026-07-20.longitudinal-disabled-v1";
export const EPIC_BETA_FHIR_PAGE_COUNT = "100";

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FHIR_RESOURCE_TYPE_PATTERN = /^[A-Z][A-Za-z0-9]{0,79}$/u;
const SMART_SCOPE_PATTERN = /^[A-Za-z0-9/*._:-]+$/u;
const REQUIRED_BASE_SCOPES = Object.freeze(["fhirUser", "launch/patient", "openid"] as const);
export const EPIC_BETA_REQUESTED_BASE_SCOPES = Object.freeze([
  "openid",
  "fhirUser",
  "launch/patient",
] as const);
const ACTIVE_BETA_QUERY_CONTRACT = Object.freeze([
  {
    fingerprintTemplate: "epic-fhir-r4:Patient:read-by-launch-patient:v1",
    fixedSearchParameters: [],
    operation: "read",
    patientBinding: "path-id",
    queryScopeId: "patient-demographics",
    queryTemplateId: "patient-demographics-read",
    registrationApiKeys: ["patient-read-demographics"],
    resourceType: "Patient",
  },
  {
    fingerprintTemplate:
      "epic-fhir-r4:Observation:search:patient:category=laboratory:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "laboratory" }],
    operation: "search",
    patientBinding: "patient-search-parameter",
    queryScopeId: "laboratory-observations",
    queryTemplateId: "laboratory-observations-search",
    registrationApiKeys: ["observation-search-labs"],
    resourceType: "Observation",
  },
  {
    fingerprintTemplate:
      "epic-fhir-r4:DiagnosticReport:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    operation: "search",
    patientBinding: "patient-search-parameter",
    queryScopeId: "diagnostic-reports",
    queryTemplateId: "diagnostic-reports-search",
    registrationApiKeys: ["diagnostic-report-search-patient"],
    resourceType: "DiagnosticReport",
  },
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
  | "panel-definition"
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
  registrationApi("allergy-intolerance-search-patient", "AllergyIntolerance.Search (Patient) (R4)", "AllergyIntolerance", "search"),
  registrationApi("binary-read-clinical-notes", "Binary.Read (Clinical Notes) (R4)", "Binary", "read"),
  registrationApi("care-plan-search-patient", "CarePlan.Search (Patient) (R4)", "CarePlan", "search"),
  registrationApi("care-team-search-patient", "CareTeam.Search (Patient) (R4)", "CareTeam", "search"),
  registrationApi("condition-search-encounter-diagnosis", "Condition.Search (Encounter Diagnosis) (R4)", "Condition", "search"),
  registrationApi("condition-search-problems", "Condition.Search (Problems) (R4)", "Condition", "search"),
  registrationApi("device-search-implants", "Device.Search (Implants) (R4)", "Device", "search"),
  registrationApi("diagnostic-report-search-patient", "DiagnosticReport.Search (Patient) (R4)", "DiagnosticReport", "search"),
  registrationApi("document-reference-search-clinical-notes", "DocumentReference.Search (Clinical Notes) (R4)", "DocumentReference", "search"),
  registrationApi("encounter-read", "Encounter.Read (R4)", "Encounter", "read"),
  registrationApi("encounter-search-patient", "Encounter.Search (Patient) (R4)", "Encounter", "search"),
  registrationApi("family-member-history-search-patient", "FamilyMemberHistory.Search (Patient) (R4)", "FamilyMemberHistory", "search"),
  registrationApi("goal-search-patient", "Goal.Search (Patient) (R4)", "Goal", "search"),
  registrationApi("immunization-search-patient", "Immunization.Search (Patient) (R4)", "Immunization", "search"),
  registrationApi("location-read", "Location.Read (R4)", "Location", "read"),
  registrationApi("medication-dispense-search-fill-status", "MedicationDispense.Search (Fill Status) (R4)", "MedicationDispense", "search"),
  registrationApi("medication-read", "Medication.Read (R4)", "Medication", "read"),
  registrationApi("medication-request-read", "MedicationRequest.Read (R4)", "MedicationRequest", "read"),
  registrationApi("medication-request-search-patient", "MedicationRequest.Search (Patient) (R4)", "MedicationRequest", "search"),
  registrationApi("observation-read-assessment-member", "Observation.Read (Assessments) (R4)", "Observation", "read"),
  registrationApi("observation-read-lab-result", "Observation.Read (Labs) (R4)", "Observation", "read"),
  registrationApi("observation-search-assessments", "Observation.Search (Assessments) (R4)", "Observation", "search"),
  registrationApi("observation-search-labs", "Observation.Search (Labs) (R4)", "Observation", "search"),
  registrationApi("observation-search-sdoh-assessments", "Observation.Search (SDOH Assessments) (R4)", "Observation", "search"),
  registrationApi("observation-search-social-history", "Observation.Search (Social History) (R4)", "Observation", "search"),
  registrationApi("observation-search-vital-signs", "Observation.Search (Vital Signs) (R4)", "Observation", "search"),
  registrationApi("organization-read", "Organization.Read (R4)", "Organization", "read"),
  registrationApi("patient-read-demographics", "Patient.Read (Demographics) (R4)", "Patient", "read"),
  registrationApi("practitioner-read", "Practitioner.Read (R4)", "Practitioner", "read"),
  registrationApi("practitioner-role-read", "PractitionerRole.Read (R4)", "PractitionerRole", "read"),
  registrationApi("procedure-search-orders", "Procedure.Search (Orders) (R4)", "Procedure", "search"),
  registrationApi("procedure-search-surgeries", "Procedure.Search (Surgeries) (R4)", "Procedure", "search"),
  registrationApi("procedure-search-surgical-history", "Procedure.Search (Patient-Reported Surgical History) (R4)", "Procedure", "search"),
  registrationApi("provenance-search-target", "Provenance.Search (Target) (R4)", "Provenance", "search"),
  registrationApi("questionnaire-read", "Questionnaire.Read (R4)", "Questionnaire", "read"),
  registrationApi("service-request-read", "ServiceRequest.Read (R4)", "ServiceRequest", "read"),
  registrationApi("service-request-search-patient", "ServiceRequest.Search (Patient) (R4)", "ServiceRequest", "search"),
  registrationApi("specimen-read", "Specimen.Read (R4)", "Specimen", "read"),
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
  searchTemplate("observation-social-history-search", "Observation", { category: "social-history" }, "date"),
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
  ], ["encounter-read"]),
  dependencyPolicy("location-context", "Location", "read", "location", ["encounters", "immunizations"], ["location-read"]),
  dependencyPolicy("medication-definition", "Medication", "read", "medication", ["medication-dispenses", "medication-requests"], ["medication-read"]),
  dependencyPolicy("medication-request-context", "MedicationRequest", "read", "order", ["medication-dispenses"], ["medication-request-read"]),
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
  ], ["organization-read"]),
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
  ], ["practitioner-read"]),
  dependencyPolicy("practitioner-role-context", "PractitionerRole", "read", "performer", [
    "care-teams",
    "document-references-notes",
    "encounters",
  ], ["practitioner-role-read"]),
  dependencyPolicy("provenance-target", "Provenance", "search", "provenance", [
    "condition-problem-list",
    "diagnostic-reports",
    "document-references-notes",
    "laboratory-observations",
    "medication-requests",
  ], ["provenance-search-target"]),
  dependencyPolicy("questionnaire-definition", "Questionnaire", "read", "panel-definition", [
    "observation-assessments",
    "observation-sdoh-assessments",
  ], ["questionnaire-read"]),
  dependencyPolicy("service-request-context", "ServiceRequest", "read", "order", [
    "diagnostic-reports",
    "observation-sdoh-assessments",
    "procedure-orders",
    "procedure-surgeries",
  ], ["service-request-read"]),
  dependencyPolicy("specimen-context", "Specimen", "read", "specimen", [
    "diagnostic-reports",
    "laboratory-observations",
  ], ["specimen-read"]),
] as const satisfies readonly EpicDependencyPolicy[];

const QUERY_SCOPES = [
  queryScope("allergies", "AllergyIntolerance", "allergies-search", "whole-scope", ["allergy-intolerance-search-patient"], ["practitioner-context"]),
  queryScope("care-plans", "CarePlan", "care-plans-search", "whole-scope", ["care-plan-search-patient"], ["encounter-context", "organization-context", "practitioner-context"]),
  queryScope("care-teams", "CareTeam", "care-teams-search", "whole-scope", ["care-team-search-patient"], ["organization-context", "practitioner-context", "practitioner-role-context"]),
  queryScope("condition-encounter-diagnoses", "Condition", "condition-encounter-diagnoses-search", "whole-scope", ["condition-search-encounter-diagnosis"], ["encounter-context", "practitioner-context"]),
  queryScope("condition-problem-list", "Condition", "condition-problem-list-search", "whole-scope", ["condition-search-problems"], ["practitioner-context", "provenance-target"]),
  queryScope("device-implants", "Device", "device-implants-search", "whole-scope", ["device-search-implants"], []),
  queryScope("diagnostic-reports", "DiagnosticReport", "diagnostic-reports-search", "whole-scope", ["diagnostic-report-search-patient"], [], 2),
  queryScope("document-references-notes", "DocumentReference", "document-references-notes-search", "bounded-period-90d", ["document-reference-search-clinical-notes"], ["binary-attachment", "encounter-context", "organization-context", "practitioner-context", "practitioner-role-context", "provenance-target"]),
  queryScope("encounters", "Encounter", "encounters-search", "bounded-date-365d", ["encounter-search-patient"], ["location-context", "organization-context", "practitioner-context", "practitioner-role-context"]),
  queryScope("family-member-history", "FamilyMemberHistory", "family-member-history-search", "whole-scope", ["family-member-history-search-patient"], []),
  queryScope("immunizations", "Immunization", "immunizations-search", "bounded-date-365d", ["immunization-search-patient"], ["encounter-context", "location-context", "organization-context", "practitioner-context"]),
  queryScope("laboratory-observations", "Observation", "laboratory-observations-search", "whole-scope", ["observation-search-labs"], [], 1),
  queryScope("medication-dispenses", "MedicationDispense", "medication-dispenses-search", "whole-scope", ["medication-dispense-search-fill-status"], ["medication-definition", "medication-request-context", "organization-context", "practitioner-context"]),
  queryScope("medication-requests", "MedicationRequest", "medication-requests-search", "whole-scope", ["medication-request-search-patient"], ["medication-definition", "organization-context", "practitioner-context", "provenance-target"]),
  queryScope("observation-assessments", "Observation", "observation-assessments-search", "bounded-date-365d", ["observation-search-assessments"], ["encounter-context", "observation-result-member", "practitioner-context", "questionnaire-definition"]),
  queryScope("observation-sdoh-assessments", "Observation", "observation-sdoh-assessments-search", "bounded-date-365d", ["observation-search-sdoh-assessments"], ["encounter-context", "observation-result-member", "practitioner-context", "questionnaire-definition", "service-request-context"]),
  queryScope("observation-social-history", "Observation", "observation-social-history-search", "bounded-date-365d", ["observation-search-social-history"], []),
  queryScope("patient-demographics", "Patient", "patient-demographics-read", "whole-scope", ["patient-read-demographics"], [], 0),
  queryScope("procedure-orders", "Procedure", "procedure-orders-search", "bounded-date-365d", ["procedure-search-orders"], ["encounter-context", "organization-context", "practitioner-context", "service-request-context"]),
  queryScope("procedure-surgeries", "Procedure", "procedure-surgeries-search", "bounded-date-365d", ["procedure-search-surgeries"], ["encounter-context", "organization-context", "practitioner-context", "service-request-context"]),
  queryScope("procedure-surgical-history", "Procedure", "procedure-surgical-history-search", "whole-scope", ["procedure-search-surgical-history"], []),
  queryScope("provider-goals", "Goal", "provider-goals-search", "whole-scope", ["goal-search-patient"], ["organization-context", "practitioner-context"]),
  queryScope("service-requests", "ServiceRequest", "service-requests-search", "whole-scope", ["service-request-search-patient"], ["encounter-context", "organization-context", "practitioner-context"]),
  queryScope("vital-sign-observations", "Observation", "vital-sign-observations-search", "bounded-date-365d", ["observation-search-vital-signs"], ["encounter-context", "practitioner-context"]),
] as const satisfies readonly EpicQueryScopePolicy[];

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

export const EPIC_ACQUISITION_POLICY = parseEpicAcquisitionPolicy(
  EPIC_ACQUISITION_POLICY_INPUT,
);

const ACTIVE_QUERY_SCOPES = Object.freeze(
  EPIC_ACQUISITION_POLICY.queryScopes
    .filter((query) => query.status === "active-beta")
    .sort((left, right) => (left.activeOrder ?? 0) - (right.activeOrder ?? 0)),
);

export const EPIC_BETA_RESOURCE_TYPES = Object.freeze(
  ACTIVE_QUERY_SCOPES.map((query) => query.resourceType),
);

export type EpicBetaResourceType = "DiagnosticReport" | "Observation" | "Patient";
type SmartPermissionVersion = "v1" | "v2";

export function parseEpicAcquisitionPolicy(value: unknown): EpicAcquisitionPolicy {
  const record = requireRecord(value, "Epic acquisition policy");
  if (record.sourceSystem !== "epic-fhir") {
    throw new TypeError("Epic acquisition policy source system is unsupported.");
  }
  const id = requireIdentifier(record.id, "Epic acquisition policy id");
  const policyVersion = requireBoundedString(record.policyVersion, "Epic acquisition policy version", 120);
  const requestedBaseScopes = parseUniqueStrings(
    record.requestedBaseScopes,
    "Epic acquisition policy base scopes",
    16,
    120,
  );
  assertSorted(requestedBaseScopes, "Epic acquisition policy base scopes");
  if (
    requestedBaseScopes.length !== REQUIRED_BASE_SCOPES.length
    || requestedBaseScopes.some((scope, index) => scope !== REQUIRED_BASE_SCOPES[index])
    || requestedBaseScopes.some((scope) => !SMART_SCOPE_PATTERN.test(scope))
  ) {
    throw new TypeError("Epic acquisition policy base scopes do not match the active beta policy.");
  }

  const registrationApis = parseRegistrationApis(record.registrationApis);
  const queryTemplates = parseQueryTemplates(record.queryTemplates);
  const slicingPolicies = parseSlicingPolicies(record.slicingPolicies);
  const dependencyPolicies = parseDependencyPolicies(record.dependencyPolicies);
  const queryScopes = parseQueryScopes(record.queryScopes);

  const registrationApiByKey = uniqueBy(registrationApis, (api) => api.key, "registration API key");
  const queryTemplateById = uniqueBy(queryTemplates, (template) => template.id, "query template id");
  const slicingPolicyById = uniqueBy(slicingPolicies, (policy) => policy.id, "slicing policy id");
  const dependencyPolicyById = uniqueBy(
    dependencyPolicies,
    (policy) => policy.id,
    "dependency policy id",
  );
  const queryScopeById = uniqueBy(queryScopes, (query) => query.queryScopeId, "query scope id");

  for (const dependency of dependencyPolicies) {
    for (const parentId of dependency.allowedParentQueryScopeIds) {
      if (!queryScopeById.has(parentId)) {
        throw new TypeError(`Epic dependency policy ${dependency.id} references an unknown parent query scope.`);
      }
    }
    assertRegistrationApiReferences({
      operation: dependency.operation,
      registrationApiByKey,
      registrationApiKeys: dependency.registrationApiKeys,
      resourceType: dependency.resourceType,
      subject: `Epic dependency policy ${dependency.id}`,
    });
  }

  for (const query of queryScopes) {
    const template = queryTemplateById.get(query.queryTemplateId);
    if (!template || template.resourceType !== query.resourceType) {
      throw new TypeError(`Epic query scope ${query.queryScopeId} references an incompatible query template.`);
    }
    if (!query.requiredOperations.includes(template.operation)) {
      throw new TypeError(`Epic query scope ${query.queryScopeId} omits its template operation.`);
    }
    if (!slicingPolicyById.has(query.slicingPolicyId)) {
      throw new TypeError(`Epic query scope ${query.queryScopeId} references an unknown slicing policy.`);
    }
    for (const dependencyId of query.dependencyPolicyIds) {
      const dependency = dependencyPolicyById.get(dependencyId);
      if (!dependency || !dependency.allowedParentQueryScopeIds.includes(query.queryScopeId)) {
        throw new TypeError(`Epic query scope ${query.queryScopeId} references an incompatible dependency policy.`);
      }
    }
    for (const operation of query.requiredOperations) {
      assertRegistrationApiReferences({
        operation,
        registrationApiByKey,
        registrationApiKeys: query.registrationApiKeys,
        resourceType: query.resourceType,
        subject: `Epic query scope ${query.queryScopeId}`,
      });
    }
  }

  const activeQueries = queryScopes
    .filter((query) => query.status === "active-beta")
    .sort((left, right) => (left.activeOrder ?? 0) - (right.activeOrder ?? 0));
  if (
    activeQueries.length !== ACTIVE_BETA_QUERY_CONTRACT.length
    || activeQueries.some((query, index) => {
      const expected = ACTIVE_BETA_QUERY_CONTRACT[index];
      if (!expected) return true;
      const template = queryTemplateById.get(query.queryTemplateId);
      return query.queryScopeId !== expected.queryScopeId
        || query.activeOrder !== index
        || query.resourceType !== expected.resourceType
        || query.queryTemplateId !== expected.queryTemplateId
        || query.slicingPolicyId !== "whole-scope"
        || query.dependencyPolicyIds.length !== 0
        || !sameStringList(query.requiredOperations, [expected.operation])
        || !sameStringList(query.registrationApiKeys, expected.registrationApiKeys)
        || !template
        || template.fingerprintTemplate !== expected.fingerprintTemplate
        || template.patientBinding !== expected.patientBinding
        || template.windowParameter !== undefined
        || JSON.stringify(template.fixedSearchParameters)
          !== JSON.stringify(expected.fixedSearchParameters);
    })
  ) {
    throw new TypeError("Epic acquisition policy must preserve the exact existing beta query contract.");
  }

  return {
    dependencyPolicies,
    id,
    policyVersion,
    queryScopes,
    queryTemplates,
    registrationApis,
    requestedBaseScopes,
    slicingPolicies,
    sourceSystem: "epic-fhir",
  };
}

export function buildEpicBetaRetrievalPlan(input: {
  pageCount: string;
  resourceTypes: readonly string[];
}): ClinicalFhirRetrievalPlan {
  return clinicalFhirRetrievalPlanSchema.parse({
    schemaVersion: "murph.clinical-retrieval-plan.v1",
    slices: input.resourceTypes.map((resourceType) => {
      const query = requireActiveQueryForResource(resourceType);
      return {
        coverage: "whole-family",
        queryFingerprint: sha256Hex(
          buildEpicBetaRetrievalQueryFingerprintInput({
            pageCount: input.pageCount,
            resourceType,
          }),
        ),
        queryScopeId: query.queryScopeId,
        resourceType: query.resourceType,
        sliceId: "whole",
      };
    }),
  });
}

export function buildEpicBetaSmartResourceScope(input: {
  permissionVersion: SmartPermissionVersion;
  resourceType: string;
}): string {
  const query = requireActiveQueryForResource(input.resourceType);
  const permission = input.permissionVersion === "v1"
    ? "read"
    : query.requiredOperations.map((operation) => operation === "read" ? "r" : "s").join("");
  return `patient/${query.resourceType}.${permission}`;
}

export function readGrantedEpicBetaResourceTypes(
  scopes: readonly string[],
  candidateResourceTypes: readonly string[] = EPIC_BETA_RESOURCE_TYPES,
): EpicBetaResourceType[] {
  const candidates = candidateResourceTypes.filter(isEpicBetaResourceType);
  return candidates.filter((resourceType) => {
    const query = requireActiveQueryForResource(resourceType);
    return scopes.some((scope) => query.requiredOperations.every((operation) =>
      scopeGrantsEpicOperation(scope, resourceType, operation)
    ));
  });
}

export function buildEpicBetaRetrievalQueryFingerprintInput(input: {
  pageCount: string;
  resourceType: string;
}): string {
  const query = requireActiveQueryForResource(input.resourceType);
  const template = requireQueryTemplate(query.queryTemplateId);
  return template.fingerprintTemplate.replaceAll("{pageCount}", input.pageCount);
}

export function buildEpicBetaInitialFhirPageUrl(input: {
  fhirBaseUrl: string;
  pageCount: string;
  patientId: string;
  resourceType: string;
}): URL {
  const query = requireActiveQueryForResource(input.resourceType);
  const template = requireQueryTemplate(query.queryTemplateId);
  const base = input.fhirBaseUrl.replace(/\/+$/u, "");
  if (template.patientBinding === "path-id") {
    return new URL(`${base}/${template.resourceType}/${encodeURIComponent(input.patientId)}`);
  }
  const url = new URL(`${base}/${template.resourceType}`);
  url.searchParams.set("patient", input.patientId);
  for (const parameter of template.fixedSearchParameters) {
    url.searchParams.set(parameter.name, parameter.value);
  }
  url.searchParams.set("_count", input.pageCount);
  return url;
}

export function isEpicBetaResourceType(value: string): value is EpicBetaResourceType {
  return EPIC_BETA_RESOURCE_TYPES.includes(value);
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
  activeOrder?: number,
): EpicQueryScopePolicy {
  return {
    ...(activeOrder === undefined ? {} : { activeOrder }),
    dependencyPolicyIds,
    queryScopeId,
    queryTemplateId,
    registrationApiKeys,
    requiredOperations: [queryTemplateId.endsWith("-read") ? "read" : "search"],
    resourceType,
    slicingPolicyId,
    status: activeOrder === undefined ? "disabled" : "active-beta",
  };
}

function parseRegistrationApis(value: unknown): EpicRegistrationApi[] {
  const values = requireArray(value, "Epic registration APIs", 100);
  const apis = values.map((item, index): EpicRegistrationApi => {
    const record = requireRecord(item, `Epic registration API ${index}`);
    return {
      epicCatalogName: requireBoundedString(record.epicCatalogName, `Epic registration API ${index} catalog name`, 180),
      key: requireIdentifier(record.key, `Epic registration API ${index} key`),
      operation: requireOperation(record.operation, `Epic registration API ${index} operation`),
      resourceType: requireResourceType(record.resourceType, `Epic registration API ${index} resource type`),
    };
  });
  assertSorted(apis.map((api) => api.key), "Epic registration APIs");
  return apis;
}

function parseQueryTemplates(value: unknown): EpicQueryTemplate[] {
  const values = requireArray(value, "Epic query templates", 100);
  const templates = values.map((item, index): EpicQueryTemplate => {
    const record = requireRecord(item, `Epic query template ${index}`);
    const operation = requireOperation(record.operation, `Epic query template ${index} operation`);
    const patientBinding = record.patientBinding;
    if (patientBinding !== "path-id" && patientBinding !== "patient-search-parameter") {
      throw new TypeError(`Epic query template ${index} patient binding is invalid.`);
    }
    const fixedSearchParameters = requireArray(
      record.fixedSearchParameters,
      `Epic query template ${index} fixed parameters`,
      16,
    ).map((parameter, parameterIndex) => {
      const parameterRecord = requireRecord(
        parameter,
        `Epic query template ${index} fixed parameter ${parameterIndex}`,
      );
      return {
        name: requireSearchParameterName(
          parameterRecord.name,
          `Epic query template ${index} fixed parameter ${parameterIndex} name`,
        ),
        value: requireBoundedString(
          parameterRecord.value,
          `Epic query template ${index} fixed parameter ${parameterIndex} value`,
          200,
        ),
      };
    });
    assertSorted(
      fixedSearchParameters.map((parameter) => `${parameter.name}\n${parameter.value}`),
      `Epic query template ${index} fixed parameters`,
    );
    if (operation === "read" && (patientBinding !== "path-id" || fixedSearchParameters.length > 0)) {
      throw new TypeError(`Epic query template ${index} read semantics are invalid.`);
    }
    return {
      fingerprintTemplate: requireBoundedString(
        record.fingerprintTemplate,
        `Epic query template ${index} fingerprint template`,
        500,
      ),
      fixedSearchParameters,
      id: requireIdentifier(record.id, `Epic query template ${index} id`),
      operation,
      patientBinding,
      resourceType: requireResourceType(record.resourceType, `Epic query template ${index} resource type`),
      ...(record.windowParameter === undefined
        ? {}
        : {
            windowParameter: requireSearchParameterName(
              record.windowParameter,
              `Epic query template ${index} window parameter`,
            ),
          }),
    };
  });
  assertSorted(templates.map((template) => template.id), "Epic query templates");
  return templates;
}

function parseSlicingPolicies(value: unknown): EpicSlicingPolicy[] {
  const values = requireArray(value, "Epic slicing policies", 20);
  const policies = values.map((item, index): EpicSlicingPolicy => {
    const record = requireRecord(item, `Epic slicing policy ${index}`);
    const id = requireIdentifier(record.id, `Epic slicing policy ${index} id`);
    if (record.kind === "whole-scope") return { id, kind: "whole-scope" };
    if (record.kind !== "bounded-window" || record.direction !== "newest-first") {
      throw new TypeError(`Epic slicing policy ${index} is invalid.`);
    }
    const initialWindowDays = requirePositiveInteger(
      record.initialWindowDays,
      `Epic slicing policy ${index} initial window`,
      3_650,
    );
    const minimumWindowDays = requirePositiveInteger(
      record.minimumWindowDays,
      `Epic slicing policy ${index} minimum window`,
      initialWindowDays,
    );
    const overlapDays = requireNonNegativeInteger(
      record.overlapDays,
      `Epic slicing policy ${index} overlap`,
      minimumWindowDays,
    );
    return {
      direction: "newest-first",
      id,
      initialWindowDays,
      kind: "bounded-window",
      minimumWindowDays,
      overlapDays,
    };
  });
  assertSorted(policies.map((policy) => policy.id), "Epic slicing policies");
  return policies;
}

function parseDependencyPolicies(value: unknown): EpicDependencyPolicy[] {
  const values = requireArray(value, "Epic dependency policies", 100);
  const policies = values.map((item, index): EpicDependencyPolicy => {
    const record = requireRecord(item, `Epic dependency policy ${index}`);
    if (
      record.countsTowardParentSliceLimits !== true
      || record.maxTraversalDepth !== 2
      || record.sameFhirBaseOnly !== true
    ) {
      throw new TypeError(`Epic dependency policy ${index} is not bounded to its parent slice.`);
    }
    const purpose = requireDependencyPurpose(record.purpose, `Epic dependency policy ${index} purpose`);
    const allowedParentQueryScopeIds = parseIdentifiers(
      record.allowedParentQueryScopeIds,
      `Epic dependency policy ${index} parent scopes`,
      100,
    );
    const registrationApiKeys = parseIdentifiers(
      record.registrationApiKeys,
      `Epic dependency policy ${index} registration APIs`,
      20,
    );
    assertSorted(allowedParentQueryScopeIds, `Epic dependency policy ${index} parent scopes`);
    assertSorted(registrationApiKeys, `Epic dependency policy ${index} registration APIs`);
    return {
      allowedParentQueryScopeIds,
      countsTowardParentSliceLimits: true,
      id: requireIdentifier(record.id, `Epic dependency policy ${index} id`),
      maxTraversalDepth: 2,
      operation: requireOperation(record.operation, `Epic dependency policy ${index} operation`),
      purpose,
      registrationApiKeys,
      resourceType: requireResourceType(record.resourceType, `Epic dependency policy ${index} resource type`),
      sameFhirBaseOnly: true,
    };
  });
  assertSorted(policies.map((policy) => policy.id), "Epic dependency policies");
  return policies;
}

function parseQueryScopes(value: unknown): EpicQueryScopePolicy[] {
  const values = requireArray(value, "Epic query scopes", 100);
  const queries = values.map((item, index): EpicQueryScopePolicy => {
    const record = requireRecord(item, `Epic query scope ${index}`);
    if (record.status !== "active-beta" && record.status !== "disabled") {
      throw new TypeError(`Epic query scope ${index} status is invalid.`);
    }
    const activeOrder = record.activeOrder === undefined
      ? undefined
      : requireNonNegativeInteger(record.activeOrder, `Epic query scope ${index} active order`, 100);
    if ((record.status === "active-beta") !== (activeOrder !== undefined)) {
      throw new TypeError(`Epic query scope ${index} active order is inconsistent.`);
    }
    const dependencyPolicyIds = parseIdentifiers(
      record.dependencyPolicyIds,
      `Epic query scope ${index} dependencies`,
      40,
    );
    const registrationApiKeys = parseIdentifiers(
      record.registrationApiKeys,
      `Epic query scope ${index} registration APIs`,
      20,
    );
    const requiredOperations = requireArray(
      record.requiredOperations,
      `Epic query scope ${index} required operations`,
      2,
    ).map((operation) => requireOperation(operation, `Epic query scope ${index} required operation`));
    if (requiredOperations.length === 0) {
      throw new TypeError(`Epic query scope ${index} requires at least one FHIR operation.`);
    }
    assertSorted(dependencyPolicyIds, `Epic query scope ${index} dependencies`);
    assertSorted(registrationApiKeys, `Epic query scope ${index} registration APIs`);
    assertSorted(requiredOperations, `Epic query scope ${index} required operations`);
    return {
      ...(activeOrder === undefined ? {} : { activeOrder }),
      dependencyPolicyIds,
      queryScopeId: requireIdentifier(record.queryScopeId, `Epic query scope ${index} id`),
      queryTemplateId: requireIdentifier(record.queryTemplateId, `Epic query scope ${index} template id`),
      registrationApiKeys,
      requiredOperations,
      resourceType: requireResourceType(record.resourceType, `Epic query scope ${index} resource type`),
      slicingPolicyId: requireIdentifier(record.slicingPolicyId, `Epic query scope ${index} slicing policy id`),
      status: record.status,
    };
  });
  assertSorted(queries.map((query) => query.queryScopeId), "Epic query scopes");
  return queries;
}

function assertRegistrationApiReferences(input: {
  operation: EpicFhirOperation;
  registrationApiByKey: ReadonlyMap<string, EpicRegistrationApi>;
  registrationApiKeys: readonly string[];
  resourceType: string;
  subject: string;
}): void {
  if (input.registrationApiKeys.length === 0) {
    throw new TypeError(`${input.subject} has no matching Epic registration API.`);
  }
  for (const key of input.registrationApiKeys) {
    const api = input.registrationApiByKey.get(key);
    if (!api) {
      throw new TypeError(`${input.subject} references an unknown Epic registration API.`);
    }
    if (api.resourceType !== input.resourceType || api.operation !== input.operation) {
      throw new TypeError(`${input.subject} references an incompatible Epic registration API.`);
    }
  }
}

function requireActiveQueryForResource(resourceType: string): EpicQueryScopePolicy {
  const query = ACTIVE_QUERY_SCOPES.find((candidate) => candidate.resourceType === resourceType);
  if (!query) {
    throw new TypeError(`FHIR resource type ${resourceType} is outside the active Epic beta acquisition policy.`);
  }
  return query;
}

function requireQueryTemplate(queryTemplateId: string): EpicQueryTemplate {
  const template = EPIC_ACQUISITION_POLICY.queryTemplates.find((candidate) => candidate.id === queryTemplateId);
  if (!template) throw new TypeError("Epic query scope references an unknown query template.");
  return template;
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

function requireOperation(value: unknown, label: string): EpicFhirOperation {
  if (value === "read" || value === "search") return value;
  throw new TypeError(`${label} is invalid.`);
}

function requireDependencyPurpose(value: unknown, label: string): EpicDependencyPurpose {
  switch (value) {
    case "attachment":
    case "author":
    case "context":
    case "location":
    case "medication":
    case "order":
    case "panel-definition":
    case "performer":
    case "provenance":
    case "result-member":
    case "specimen":
      return value;
    default:
      throw new TypeError(`${label} is invalid.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new RangeError(`${label} must be a bounded array.`);
  }
  return value;
}

function requireIdentifier(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 120);
  if (!IDENTIFIER_PATTERN.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function requireResourceType(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 80);
  if (!FHIR_RESOURCE_TYPE_PATTERN.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function requireSearchParameterName(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 80);
  if (!/^_?[a-z][a-z0-9-]*$/u.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function requireBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new RangeError(`${label} is out of bounds.`);
  return text;
}

function parseUniqueStrings(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  const raw = requireArray(value, label, maxItems);
  const values = raw.map((item) => requireBoundedString(item, label, maxLength));
  if (new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicates.`);
  return values;
}

function parseIdentifiers(value: unknown, label: string, maxItems: number): string[] {
  const identifiers = requireArray(value, label, maxItems).map((item) => requireIdentifier(item, label));
  if (new Set(identifiers).size !== identifiers.length) throw new TypeError(`${label} contains duplicates.`);
  return identifiers;
}

function requirePositiveInteger(value: unknown, label: string, max: number): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > max) {
    throw new RangeError(`${label} is out of bounds.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string, max: number): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > max) {
    throw new RangeError(`${label} is out of bounds.`);
  }
  return value;
}

function assertSorted(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const comparison = (values[index - 1] ?? "").localeCompare(values[index] ?? "");
    if (comparison === 0) {
      throw new TypeError(`${label} contains a duplicate value.`);
    }
    if (comparison > 0) {
      throw new TypeError(`${label} must be strictly sorted.`);
    }
  }
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
  label: string,
): Map<string, T> {
  const entries = new Map<string, T>();
  for (const value of values) {
    const key = keyFor(value);
    if (entries.has(key)) throw new TypeError(`Epic acquisition policy contains a duplicate ${label}.`);
    entries.set(key, value);
  }
  return entries;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
