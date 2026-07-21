import { describe, expect, it } from "vitest";

import {
  EPIC_ACQUISITION_POLICY,
  EPIC_BETA_RESOURCE_TYPES,
  buildEpicBetaInitialFhirPageUrl,
  buildEpicBetaRetrievalQueryFingerprintInput,
  buildEpicBetaSmartResourceScope,
} from "@/src/lib/clinical-records/epic-policy";

const EXACT_EPIC_REGISTRATION_API_NAMES = [
  "AllergyIntolerance.Search (Patient Chart) (R4)",
  "Binary.Read (Clinical Notes) (R4)",
  "CarePlan.Search (Longitudinal) (R4)",
  "CareTeam.Search (Longitudinal CareTeam) (R4)",
  "Condition.Search (Encounter Diagnosis) (R4)",
  "Condition.Search (Problems) (R4)",
  "Device.Search (Implants) (R4)",
  "DiagnosticReport.Search (Results) (R4)",
  "DocumentReference.Search (Clinical Notes) (R4)",
  "Encounter.Read (Patient Chart) (R4)",
  "Encounter.Search (Patient Chart) (R4)",
  "FamilyMemberHistory.Search (R4)",
  "Goal.Search (Patient) (R4)",
  "Immunization.Search (Patient Chart) (R4)",
  "Location.Read (Organizational Directory) (R4)",
  "MedicationDispense.Search (Fill Status) (R4)",
  "Medication.Read (Organization Med List) (R4)",
  "MedicationRequest.Read (Signed Medication Order) (R4)",
  "MedicationRequest.Search (Signed Medication Order) (R4)",
  "Observation.Read (Assessments) (R4)",
  "Observation.Read (Labs) (R4)",
  "Observation.Search (Assessments) (R4)",
  "Observation.Search (Labs) (R4)",
  "Observation.Search (SDOH Assessments) (R4)",
  "Observation.Search (Social History) (R4)",
  "Observation.Search (Vital Signs) (R4)",
  "Organization.Read (Organizational Directory) (R4)",
  "Patient.Read (Demographics) (R4)",
  "Practitioner.Read (Organizational Directory) (R4)",
  "PractitionerRole.Read (Organizational Directory) (R4)",
  "Procedure.Search (Orders) (R4)",
  "Procedure.Search (Surgeries) (R4)",
  "Procedure.Search (Patient-Reported Surgical History) (R4)",
  "Provenance.Read (R4)",
  "Questionnaire.Read (Patient-Entered Questionnaires) (R4)",
  "ServiceRequest.Read (Orders) (R4)",
  "ServiceRequest.Search (Orders) (R4)",
  "Specimen.Read (Patient Chart) (R4)",
] as const;

describe("Epic Clinical Records acquisition policy", () => {
  it("keeps the longitudinal catalog disabled behind the existing beta query set", () => {
    const active = EPIC_ACQUISITION_POLICY.queryScopes
      .filter((query) => query.status === "active-beta")
      .sort((left, right) => (left.activeOrder ?? 0) - (right.activeOrder ?? 0));

    expect(EPIC_ACQUISITION_POLICY.requestedBaseScopes).toEqual([
      "fhirUser",
      "launch/patient",
      "openid",
    ]);
    expect(EPIC_ACQUISITION_POLICY.queryScopes).toHaveLength(24);
    expect(active.map((query) => query.queryScopeId)).toEqual([
      "patient-demographics",
      "laboratory-observations",
      "diagnostic-reports",
    ]);
    expect(active.map((query) => query.resourceType)).toEqual(EPIC_BETA_RESOURCE_TYPES);
    expect(active.every((query) => query.dependencyPolicyIds.length === 0)).toBe(true);
    expect(EPIC_ACQUISITION_POLICY.queryScopes.filter((query) => query.status === "disabled"))
      .toHaveLength(21);
    expect(EPIC_ACQUISITION_POLICY.dependencyPolicies.every((dependency) =>
      dependency.sameFhirBaseOnly
      && dependency.maxTraversalDepth === 2
      && dependency.countsTowardParentSliceLimits
    )).toBe(true);
  });

  it("preserves the active SMART scopes, request URLs, and fingerprints", () => {
    expect(EPIC_BETA_RESOURCE_TYPES).toEqual(["Patient", "Observation", "DiagnosticReport"]);
    expect(EPIC_BETA_RESOURCE_TYPES.map((resourceType) =>
      buildEpicBetaSmartResourceScope({ permissionVersion: "v2", resourceType })
    )).toEqual([
      "patient/Patient.r",
      "patient/Observation.s",
      "patient/DiagnosticReport.s",
    ]);
    expect(buildEpicBetaInitialFhirPageUrl({
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      pageCount: "100",
      patientId: "patient/with spaces",
      queryScopeId: "patient-demographics",
      resourceType: "Patient",
      sliceId: "whole",
    }).toString()).toBe(
      "https://fhir.example.test/FHIR/R4/Patient/patient%2Fwith%20spaces",
    );
    expect(buildEpicBetaInitialFhirPageUrl({
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      pageCount: "100",
      patientId: "patient-1",
      queryScopeId: "laboratory-observations",
      resourceType: "Observation",
      sliceId: "whole",
    }).toString()).toBe(
      "https://fhir.example.test/FHIR/R4/Observation?patient=patient-1&category=laboratory&_count=100",
    );
    expect(buildEpicBetaRetrievalQueryFingerprintInput({
      pageCount: "100",
      resourceType: "DiagnosticReport",
    })).toBe("epic-fhir-r4:DiagnosticReport:search:patient:_count=100:v1");
  });

  it("pins the exact current Epic portal registration names", () => {
    expect(
      EPIC_ACQUISITION_POLICY.registrationApis.map((api) => api.epicCatalogName),
    ).toEqual(EXACT_EPIC_REGISTRATION_API_NAMES);
  });

  it("keeps the owned policy internally consistent", () => {
    const registrationApiByKey = new Map(
      EPIC_ACQUISITION_POLICY.registrationApis.map((api) => [api.key, api]),
    );
    const queryTemplateById = new Map(
      EPIC_ACQUISITION_POLICY.queryTemplates.map((template) => [template.id, template]),
    );
    const slicingPolicyIds = new Set(
      EPIC_ACQUISITION_POLICY.slicingPolicies.map((policy) => policy.id),
    );
    const dependencyPolicyById = new Map(
      EPIC_ACQUISITION_POLICY.dependencyPolicies.map((policy) => [policy.id, policy]),
    );
    const queryScopeIds = new Set(
      EPIC_ACQUISITION_POLICY.queryScopes.map((query) => query.queryScopeId),
    );

    expect(registrationApiByKey.size).toBe(EPIC_ACQUISITION_POLICY.registrationApis.length);
    expect(queryTemplateById.size).toBe(EPIC_ACQUISITION_POLICY.queryTemplates.length);
    expect(slicingPolicyIds.size).toBe(EPIC_ACQUISITION_POLICY.slicingPolicies.length);
    expect(dependencyPolicyById.size).toBe(EPIC_ACQUISITION_POLICY.dependencyPolicies.length);
    expect(queryScopeIds.size).toBe(EPIC_ACQUISITION_POLICY.queryScopes.length);
    expectStrictlySorted(EPIC_ACQUISITION_POLICY.registrationApis.map((api) => api.key));
    expectStrictlySorted(EPIC_ACQUISITION_POLICY.queryTemplates.map((template) => template.id));
    expectStrictlySorted(EPIC_ACQUISITION_POLICY.slicingPolicies.map((policy) => policy.id));
    expectStrictlySorted(EPIC_ACQUISITION_POLICY.dependencyPolicies.map((policy) => policy.id));
    expectStrictlySorted(EPIC_ACQUISITION_POLICY.queryScopes.map((query) => query.queryScopeId));

    for (const dependency of EPIC_ACQUISITION_POLICY.dependencyPolicies) {
      expectStrictlySorted(dependency.allowedParentQueryScopeIds);
      expectStrictlySorted(dependency.registrationApiKeys);
      expect(dependency.allowedParentQueryScopeIds.every((id) => queryScopeIds.has(id))).toBe(true);
      expect(dependency.registrationApiKeys).not.toHaveLength(0);
      expect(dependency.registrationApiKeys.every((key) => {
        const api = registrationApiByKey.get(key);
        return api?.operation === dependency.operation
          && api.resourceType === dependency.resourceType;
      })).toBe(true);
    }

    for (const query of EPIC_ACQUISITION_POLICY.queryScopes) {
      expectStrictlySorted(query.dependencyPolicyIds);
      expectStrictlySorted(query.registrationApiKeys);
      expectStrictlySorted(query.requiredOperations);
      const template = queryTemplateById.get(query.queryTemplateId);
      expect(template?.resourceType).toBe(query.resourceType);
      expect(template && query.requiredOperations.includes(template.operation)).toBe(true);
      expect(slicingPolicyIds.has(query.slicingPolicyId)).toBe(true);
      expect(query.dependencyPolicyIds.every((id) =>
        dependencyPolicyById.get(id)?.allowedParentQueryScopeIds.includes(query.queryScopeId)
      )).toBe(true);
      expect(query.registrationApiKeys).not.toHaveLength(0);
      expect(query.registrationApiKeys.every((key) => {
        const api = registrationApiByKey.get(key);
        return api?.resourceType === query.resourceType
          && query.requiredOperations.includes(api.operation);
      })).toBe(true);
    }
  });
});

function expectStrictlySorted(values: readonly string[]): void {
  expect(values).toEqual([...values].sort((left, right) => left.localeCompare(right)));
  expect(new Set(values).size).toBe(values.length);
}
