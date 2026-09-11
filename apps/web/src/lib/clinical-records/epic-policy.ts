import { createHash } from "node:crypto";

import {
  clinicalFhirRetrievalPlanSchema,
  clinicalFhirScopeAllowsOperation,
  type ClinicalFhirRetrievalPlan,
  type ClinicalFhirRetrievalSlice,
} from "@murphai/clinical-records";

export const EPIC_ACQUISITION_POLICY_ID = "epic-r4-longitudinal-v1";
export const EPIC_ACQUISITION_POLICY_VERSION = "2026-09-10.document-downloads-v7";
export const EPIC_BETA_FHIR_PAGE_COUNT = "100";

const REQUIRED_BASE_SCOPES = Object.freeze(["fhirUser", "launch/patient", "openid"] as const);
export const EPIC_BETA_REQUESTED_BASE_SCOPES = Object.freeze([
  "openid",
  "fhirUser",
  "launch/patient",
] as const);
export type EpicFhirOperation = "read" | "search";

export interface EpicRegistrationApi {
  epicCatalogName: string;
  key: string;
  operation: EpicFhirOperation;
  resourceType: string;
}

export interface EpicQuery {
  queryScopeId: string;
  resourceType: ClinicalFhirRetrievalSlice["resourceType"];
  operation: EpicFhirOperation;
  fingerprintTemplate: string;
  fixedSearchParameters: readonly Readonly<{ name: string; value: string }>[];
  registrationApiKeys: readonly string[];
  // Used only to resume plans frozen before lifetime acquisition.
  legacyWindowParameter?: string;
}

export interface EpicAcquisitionPolicy {
  id: string;
  policyVersion: string;
  queries: readonly EpicQuery[];
  registrationApis: readonly EpicRegistrationApi[];
  requestedBaseScopes: readonly string[];
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
  registrationApi("document-reference-search-radiology-results", "DocumentReference.Search (Radiology Results) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-external-ccda", "DocumentReference.Search (External CCDA) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-outside-clinical-notes", "DocumentReference.Search (Outside Record - Clinical Notes) (R4)", "DocumentReference", "search"),
  registrationApi("observation-search-outside-vital-signs", "Observation.Search (Outside Record Vital Signs) (R4)", "Observation", "search"),
  registrationApi("binary-read-external-ccda", "Binary.Read (External CCDA) (R4)", "Binary", "read"),
  registrationApi("binary-read-outside-clinical-notes", "Binary.Read (Outside Record - Clinical Notes) (R4)", "Binary", "read"),
  registrationApi("binary-read-radiology-results", "Binary.Read (Radiology Results) (R4)", "Binary", "read"),
  registrationApi("binary-read-labs", "Binary.Read (Labs) (R4)", "Binary", "read"),
  registrationApi("binary-read-generated-cdas", "Binary.Read (Generated CDAs) (R4)", "Binary", "read"),
  registrationApi("binary-read-questionnaires", "Binary.Read (Patient-Entered Questionnaires) (R4)", "Binary", "read"),
  registrationApi("binary-read-correspondences", "Binary.Read (Correspondences) (R4)", "Binary", "read"),
  registrationApi("binary-read-handoff", "Binary.Read (Handoff) (R4)", "Binary", "read"),
  registrationApi("binary-read-minimum-data-set", "Binary.Read (Minimum Data Set) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-labs", "DocumentReference.Search (Labs) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-generated-cdas", "DocumentReference.Search (Generated CDAs) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-questionnaires", "DocumentReference.Search (Patient-Entered Questionnaires) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-correspondences", "DocumentReference.Search (Correspondences) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-handoff", "DocumentReference.Search (Handoff) (R4)", "DocumentReference", "search"),
  registrationApi("document-reference-search-minimum-data-set", "DocumentReference.Search (Minimum Data Set) (R4)", "DocumentReference", "search"),
  registrationApi("binary-read-document-information", "Binary.Read (Document Information) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-document-information", "DocumentReference.Search (Document Information) (R4)", "DocumentReference", "search"),
  registrationApi("binary-read-clinical-references", "Binary.Read (Clinical References) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-clinical-references", "DocumentReference.Search (Clinical References) (R4)", "DocumentReference", "search"),
  registrationApi("binary-read-his", "Binary.Read (HIS) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-his", "DocumentReference.Search (HIS) (R4)", "DocumentReference", "search"),
  registrationApi("binary-read-oasis", "Binary.Read (OASIS) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-oasis", "DocumentReference.Search (OASIS) (R4)", "DocumentReference", "search"),
  registrationApi("binary-read-irf-pai", "Binary.Read (IRF-PAI) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-irf-pai", "DocumentReference.Search (IRF-PAI) (R4)", "DocumentReference", "search"),
  registrationApi("binary-read-advance-directive", "Binary.Read (Advance Directive) (R4)", "Binary", "read"),
  registrationApi("document-reference-search-advance-directive", "DocumentReference.Search (Advance Directive) (R4)", "DocumentReference", "search"),
  registrationApi("media-read-study", "Media.Read (Study) (R4)", "Media", "read"),
  registrationApi("binary-read-study", "Binary.Read (Study) (R4)", "Binary", "read"),
] as const satisfies readonly EpicRegistrationApi[];

const QUERIES: readonly EpicQuery[] = [
  {
    queryScopeId: "patient-demographics",
    resourceType: "Patient",
    operation: "read",
    fingerprintTemplate: "epic-fhir-r4:Patient:read-by-launch-patient:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["patient-read-demographics"],
  },
  {
    queryScopeId: "laboratory-observations",
    resourceType: "Observation",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Observation:search:patient:category=laboratory:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "laboratory" }],
    registrationApiKeys: ["observation-search-labs"],
  },
  {
    queryScopeId: "diagnostic-reports",
    resourceType: "DiagnosticReport",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DiagnosticReport:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["diagnostic-report-search-results"],
  },
  {
    queryScopeId: "allergies",
    resourceType: "AllergyIntolerance",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:AllergyIntolerance:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["allergy-intolerance-search-patient-chart"],
  },
  {
    queryScopeId: "care-plans",
    resourceType: "CarePlan",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:CarePlan:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["care-plan-search-longitudinal"],
  },
  {
    queryScopeId: "care-teams",
    resourceType: "CareTeam",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:CareTeam:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["care-team-search-longitudinal"],
  },
  {
    queryScopeId: "condition-encounter-diagnoses",
    resourceType: "Condition",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Condition:search:patient:category=encounter-diagnosis:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "encounter-diagnosis" }],
    registrationApiKeys: ["condition-search-encounter-diagnosis"],
  },
  {
    queryScopeId: "condition-problem-list",
    resourceType: "Condition",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Condition:search:patient:category=problem-list-item:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "problem-list-item" }],
    registrationApiKeys: ["condition-search-problems"],
  },
  {
    queryScopeId: "device-implants",
    resourceType: "Device",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:Device:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["device-search-implants"],
  },
  {
    queryScopeId: "document-references-notes",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:DocumentReference:search:patient:category=clinical-note:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "clinical-note" }],
    registrationApiKeys: ["document-reference-search-clinical-notes", "document-reference-search-labs"],
    legacyWindowParameter: "period",
  },
  {
    queryScopeId: "encounters",
    resourceType: "Encounter",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:Encounter:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["encounter-search-patient-chart"],
    legacyWindowParameter: "date",
  },
  {
    queryScopeId: "family-member-history",
    resourceType: "FamilyMemberHistory",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:FamilyMemberHistory:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["family-member-history-search"],
  },
  {
    queryScopeId: "immunizations",
    resourceType: "Immunization",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:Immunization:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["immunization-search-patient-chart"],
    legacyWindowParameter: "date",
  },
  {
    queryScopeId: "medication-dispenses",
    resourceType: "MedicationDispense",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:MedicationDispense:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["medication-dispense-search-fill-status"],
  },
  {
    queryScopeId: "medication-requests",
    resourceType: "MedicationRequest",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:MedicationRequest:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["medication-request-search-signed-order"],
  },
  {
    queryScopeId: "observation-assessments",
    resourceType: "Observation",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Observation:search:patient:category=survey:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "survey" }],
    registrationApiKeys: ["observation-search-assessments"],
    legacyWindowParameter: "date",
  },
  {
    queryScopeId: "observation-sdoh-assessments",
    resourceType: "Observation",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Observation:search:patient:category=sdoh:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "sdoh" }],
    registrationApiKeys: ["observation-search-sdoh-assessments"],
    legacyWindowParameter: "date",
  },
  {
    queryScopeId: "observation-social-history",
    resourceType: "Observation",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Observation:search:patient:category=social-history:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "social-history" }],
    registrationApiKeys: ["observation-search-social-history"],
    legacyWindowParameter: "issued",
  },
  {
    queryScopeId: "procedure-orders",
    resourceType: "Procedure",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:Procedure:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["procedure-search-orders"],
    legacyWindowParameter: "date",
  },
  {
    queryScopeId: "procedure-surgeries",
    resourceType: "Procedure",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Procedure:search:patient:category=387713003:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "387713003" }],
    registrationApiKeys: ["procedure-search-surgeries"],
    legacyWindowParameter: "date",
  },
  {
    queryScopeId: "procedure-surgical-history",
    resourceType: "Procedure",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Procedure:search:patient:category=387713003:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "387713003" }],
    registrationApiKeys: ["procedure-search-surgical-history"],
  },
  {
    queryScopeId: "provider-goals",
    resourceType: "Goal",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:Goal:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["goal-search-patient"],
  },
  {
    queryScopeId: "service-requests",
    resourceType: "ServiceRequest",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:ServiceRequest:search:patient:_count={pageCount}:v1",
    fixedSearchParameters: [],
    registrationApiKeys: ["service-request-search-orders"],
  },
  {
    queryScopeId: "vital-sign-observations",
    resourceType: "Observation",
    operation: "search",
    fingerprintTemplate:
      "epic-fhir-r4:Observation:search:patient:category=vital-signs:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "vital-signs" }],
    registrationApiKeys: ["observation-search-vital-signs"],
    legacyWindowParameter: "date",
  },

  {
    queryScopeId: "document-references-imaging",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=imaging-result:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "imaging-result" }],
    registrationApiKeys: ["document-reference-search-radiology-results"],
  },
  {
    queryScopeId: "document-references-external-ccda",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=external-ccda:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "external-ccda" }],
    registrationApiKeys: ["document-reference-search-external-ccda"],
  },
  {
    queryScopeId: "document-references-outside-notes",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=external-clinical-note:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "external-clinical-note" }],
    registrationApiKeys: ["document-reference-search-outside-clinical-notes"],
  },
  {
    queryScopeId: "outside-vital-sign-observations",
    resourceType: "Observation",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:Observation:search:patient:category=external-vital-signs:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "external-vital-signs" }],
    registrationApiKeys: ["observation-search-outside-vital-signs"],
  },
  {
    queryScopeId: "document-references-summaries",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=summary-document:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "summary-document" }],
    registrationApiKeys: ["document-reference-search-generated-cdas"],
  },
  {
    queryScopeId: "document-references-questionnaires",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=questionnaire-response:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "questionnaire-response" }],
    registrationApiKeys: ["document-reference-search-questionnaires"],
  },
  {
    queryScopeId: "document-references-correspondence",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=correspondence:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "correspondence" }],
    registrationApiKeys: ["document-reference-search-correspondences"],
  },
  {
    queryScopeId: "document-references-handoff",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=handoff:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "handoff" }],
    registrationApiKeys: ["document-reference-search-handoff"],
  },
  {
    queryScopeId: "document-references-assessments",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=MDS:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "MDS" }],
    registrationApiKeys: ["document-reference-search-minimum-data-set"],
  },
  {
    queryScopeId: "document-references-document-information",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=document-information:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "document-information" }],
    registrationApiKeys: ["document-reference-search-document-information"],
  },
  {
    queryScopeId: "document-references-clinical-references",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=clinical-reference:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "clinical-reference" }],
    registrationApiKeys: ["document-reference-search-clinical-references"],
  },
  {
    queryScopeId: "document-references-his",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=HIS:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "HIS" }],
    registrationApiKeys: ["document-reference-search-his"],
  },
  {
    queryScopeId: "document-references-oasis",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=OASIS:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "OASIS" }],
    registrationApiKeys: ["document-reference-search-oasis"],
  },
  {
    queryScopeId: "document-references-irf-pai",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=IRFPAI:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "IRFPAI" }],
    registrationApiKeys: ["document-reference-search-irf-pai"],
  },
  {
    queryScopeId: "document-references-advance-directive",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=42348-3:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "42348-3" }],
    registrationApiKeys: ["document-reference-search-advance-directive"],
  },
  {
    // Epic's request table uses IRFPAI; its sample request uses IRF-PAI.
    queryScopeId: "document-references-irf-pai-hyphenated",
    resourceType: "DocumentReference",
    operation: "search",
    fingerprintTemplate: "epic-fhir-r4:DocumentReference:search:patient:category=IRF-PAI:_count={pageCount}:v1",
    fixedSearchParameters: [{ name: "category", value: "IRF-PAI" }],
    registrationApiKeys: ["document-reference-search-irf-pai"],
  },
];

export const EPIC_ACQUISITION_POLICY: EpicAcquisitionPolicy = {
  id: EPIC_ACQUISITION_POLICY_ID,
  policyVersion: EPIC_ACQUISITION_POLICY_VERSION,
  queries: QUERIES,
  registrationApis: REGISTRATION_APIS,
  requestedBaseScopes: REQUIRED_BASE_SCOPES,
  sourceSystem: "epic-fhir",
};

export const EPIC_BETA_RESOURCE_TYPES = Object.freeze([
  ...new Set(QUERIES.map((query) => query.resourceType)),
]);
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
    slices: QUERIES.filter((query) => requestedResourceTypes.has(query.resourceType)).map((query) =>
      buildActiveRetrievalSlice({
        frozenAt: input.frozenAt,
        pageCount: input.pageCount,
        query,
      }),
    ),
  });
}

export function buildEpicBetaSmartResourceScope(input: {
  permissionVersion: SmartPermissionVersion;
  resourceType: string;
}): string {
  const queries = requireActiveQueriesForResource(input.resourceType);
  const permission =
    input.permissionVersion === "v1"
      ? "read"
      : (["read", "search"] as const)
          .filter((operation) => queries.some((query) => query.operation === operation))
          .map((operation) => (operation === "read" ? "r" : "s"))
          .join("");
  return `patient/${input.resourceType}.${permission}`;
}

export function buildEpicBinarySmartResourceScope(input: {
  permissionVersion: SmartPermissionVersion;
}): string {
  return input.permissionVersion === "v1" ? "patient/Binary.read" : "patient/Binary.r";
}

export function epicBinaryReadIsGranted(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.startsWith("patient/")
    && clinicalFhirScopeAllowsOperation(scope, "Binary", "read"));
}

export function buildEpicMediaSmartResourceScope(input: {
  permissionVersion: SmartPermissionVersion;
}): string {
  return input.permissionVersion === "v1" ? "patient/Media.read" : "patient/Media.r";
}

export function epicMediaReadIsGranted(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope.startsWith("patient/")
    && clinicalFhirScopeAllowsOperation(scope, "Media", "read"));
}

export function readGrantedEpicBetaResourceTypes(
  scopes: readonly string[],
  candidateResourceTypes: readonly string[] = EPIC_BETA_RESOURCE_TYPES,
): EpicBetaResourceType[] {
  const candidates = candidateResourceTypes.filter(isEpicBetaResourceType);
  return candidates.filter((resourceType) => {
    const requiredOperations = new Set(
      requireActiveQueriesForResource(resourceType).flatMap((query) => [query.operation]),
    );
    return scopes.some((scope) =>
      [...requiredOperations].every((operation) =>
        scopeGrantsEpicOperation(scope, resourceType, operation),
      ),
    );
  });
}

export function buildEpicBetaRetrievalQueryFingerprintInput(input: {
  pageCount: string;
  queryScopeId: string;
}): string {
  const query = requireActiveQueryForScope(input.queryScopeId);
  const template = query;
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
    query.resourceType !== input.retrievalSlice.resourceType ||
    expectedQueryFingerprint !== input.retrievalSlice.queryFingerprint
  ) {
    throw new TypeError("Epic beta retrieval identity does not match its active query scope.");
  }
  const template = query;
  const windowParameter = query.legacyWindowParameter;
  if (
    (input.retrievalSlice.coverage === "whole-family" && input.retrievalSlice.sliceId !== "whole") ||
    (input.retrievalSlice.coverage === "bounded-window" && !windowParameter)
  ) {
    throw new TypeError("Epic beta retrieval slice does not match its active slicing policy.");
  }
  const base = input.fhirBaseUrl.replace(/\/+$/u, "");
  if (template.operation === "read") {
    return new URL(`${base}/${template.resourceType}/${encodeURIComponent(input.patientId)}`);
  }
  const url = new URL(`${base}/${template.resourceType}`);
  url.searchParams.set("patient", input.patientId);
  for (const parameter of template.fixedSearchParameters) {
    url.searchParams.set(parameter.name, parameter.value);
  }
  if (input.retrievalSlice.coverage === "bounded-window" && windowParameter) {
    url.searchParams.append(windowParameter, `ge${input.retrievalSlice.from}`);
    url.searchParams.append(windowParameter, `lt${input.retrievalSlice.to}`);
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

function requireActiveQueriesForResource(resourceType: string): EpicQuery[] {
  const queries = QUERIES.filter((candidate) => candidate.resourceType === resourceType);
  if (queries.length === 0) {
    throw new TypeError(
      `FHIR resource type ${resourceType} is outside the active Epic beta acquisition policy.`,
    );
  }
  return queries;
}

function requireActiveQueryForScope(queryScopeId: string): EpicQuery {
  const query = QUERIES.find((candidate) => candidate.queryScopeId === queryScopeId);
  if (!query) {
    throw new TypeError(
      `FHIR query scope ${queryScopeId} is outside the active Epic beta acquisition policy.`,
    );
  }
  return query;
}

function buildActiveRetrievalSlice(input: {
  frozenAt: Date;
  pageCount: string;
  query: EpicQuery;
}): ClinicalFhirRetrievalSlice {
  const resourceType = requireEpicBetaResourceType(input.query.resourceType);
  const queryFingerprint = sha256Hex(
    buildEpicBetaRetrievalQueryFingerprintInput({
      pageCount: input.pageCount,
      queryScopeId: input.query.queryScopeId,
    }),
  );
  return {
    coverage: "whole-family",
    queryFingerprint,
    queryScopeId: input.query.queryScopeId,
    resourceType,
    sliceId: "whole",
  };
}

function requireEpicBetaResourceType(value: string): EpicBetaResourceType {
  if (!isEpicBetaResourceType(value)) {
    throw new TypeError(
      `FHIR resource type ${value} is outside the active Epic beta acquisition policy.`,
    );
  }
  return value;
}


function assertValidFrozenAt(value: Date): void {
  if (!Number.isFinite(value.getTime()))
    throw new TypeError("Epic retrieval plan requires a valid frozen timestamp.");
}

function scopeGrantsEpicOperation(
  scope: string,
  resourceType: EpicBetaResourceType,
  operation: EpicFhirOperation,
): boolean {
  return (
    scope.startsWith("patient/") && clinicalFhirScopeAllowsOperation(scope, resourceType, operation)
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
