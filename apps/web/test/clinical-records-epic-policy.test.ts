import { describe, expect, it } from "vitest";

import {
  EPIC_ACQUISITION_POLICY,
  EPIC_BETA_RESOURCE_TYPES,
  buildEpicBetaInitialFhirPageUrl,
  buildEpicBetaRetrievalQueryFingerprintInput,
  buildEpicBetaSmartResourceScope,
  parseEpicAcquisitionPolicy,
} from "@/src/lib/clinical-records/epic-policy";

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
      resourceType: "Patient",
    }).toString()).toBe(
      "https://fhir.example.test/FHIR/R4/Patient/patient%2Fwith%20spaces",
    );
    expect(buildEpicBetaInitialFhirPageUrl({
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      pageCount: "100",
      patientId: "patient-1",
      resourceType: "Observation",
    }).toString()).toBe(
      "https://fhir.example.test/FHIR/R4/Observation?patient=patient-1&category=laboratory&_count=100",
    );
    expect(buildEpicBetaRetrievalQueryFingerprintInput({
      pageCount: "100",
      resourceType: "DiagnosticReport",
    })).toBe("epic-fhir-r4:DiagnosticReport:search:patient:_count=100:v1");
  });

  it("rejects duplicate and unsorted policy identifiers", () => {
    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      registrationApis: [
        EPIC_ACQUISITION_POLICY.registrationApis[0],
        EPIC_ACQUISITION_POLICY.registrationApis[0],
        ...EPIC_ACQUISITION_POLICY.registrationApis.slice(2),
      ],
    })).toThrow(/duplicate/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: [
        EPIC_ACQUISITION_POLICY.queryScopes[1],
        EPIC_ACQUISITION_POLICY.queryScopes[0],
        ...EPIC_ACQUISITION_POLICY.queryScopes.slice(2),
      ],
    })).toThrow(/strictly sorted/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      registrationApis: [
        EPIC_ACQUISITION_POLICY.registrationApis[1],
        EPIC_ACQUISITION_POLICY.registrationApis[0],
        ...EPIC_ACQUISITION_POLICY.registrationApis.slice(2),
      ],
    })).toThrow(/strictly sorted/u);
  });

  it("rejects unknown references, missing API registration, and active-set expansion", () => {
    const allergies = requireQueryScope("allergies");

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        queryTemplateId: "unknown-template",
      }),
    })).toThrow(/incompatible query template/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        registrationApiKeys: [
          ...allergies.registrationApiKeys,
          "unknown-registration-api",
        ],
      }),
    })).toThrow(/unknown Epic registration API/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        registrationApiKeys: [
          ...allergies.registrationApiKeys,
          "binary-read-clinical-notes",
        ],
      }),
    })).toThrow(/incompatible Epic registration API/u);

    const binaryAttachment = requireDependencyPolicy("binary-attachment");
    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      dependencyPolicies: EPIC_ACQUISITION_POLICY.dependencyPolicies.map((dependency) =>
        dependency.id === binaryAttachment.id
          ? {
              ...dependency,
              registrationApiKeys: [
                ...dependency.registrationApiKeys,
                "unknown-registration-api",
              ],
            }
          : dependency
      ),
    })).toThrow(/unknown Epic registration API/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        registrationApiKeys: [],
      }),
    })).toThrow(/no matching Epic registration API/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        slicingPolicyId: "unknown-slice",
      }),
    })).toThrow(/unknown slicing policy/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        dependencyPolicyIds: ["unknown-dependency"],
      }),
    })).toThrow(/incompatible dependency policy/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: EPIC_ACQUISITION_POLICY.queryScopes.map((query) =>
        query.queryScopeId === allergies.queryScopeId
          ? { ...query, requiredOperations: ["delete"] }
          : query
      ),
    })).toThrow(/required operation is invalid/u);

    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryScopes: replaceQueryScope(allergies.queryScopeId, {
        ...allergies,
        activeOrder: 3,
        status: "active-beta",
      }),
    })).toThrow(/existing beta query contract/u);

    const patientTemplate = EPIC_ACQUISITION_POLICY.queryTemplates.find((template) =>
      template.id === "patient-demographics-read"
    );
    if (!patientTemplate) throw new TypeError("Missing patient test query template.");
    expect(() => parseEpicAcquisitionPolicy({
      ...EPIC_ACQUISITION_POLICY,
      queryTemplates: EPIC_ACQUISITION_POLICY.queryTemplates.map((template) =>
        template.id === patientTemplate.id
          ? { ...template, fingerprintTemplate: "changed-active-fingerprint" }
          : template
      ),
    })).toThrow(/existing beta query contract/u);
  });
});

function requireQueryScope(queryScopeId: string) {
  const query = EPIC_ACQUISITION_POLICY.queryScopes.find((candidate) =>
    candidate.queryScopeId === queryScopeId
  );
  if (!query) throw new TypeError(`Missing test query scope ${queryScopeId}.`);
  return query;
}

function requireDependencyPolicy(dependencyPolicyId: string) {
  const dependency = EPIC_ACQUISITION_POLICY.dependencyPolicies.find((candidate) =>
    candidate.id === dependencyPolicyId
  );
  if (!dependency) throw new TypeError(`Missing test dependency policy ${dependencyPolicyId}.`);
  return dependency;
}

function replaceQueryScope(
  queryScopeId: string,
  replacement: typeof EPIC_ACQUISITION_POLICY.queryScopes[number],
) {
  return EPIC_ACQUISITION_POLICY.queryScopes.map((query) =>
    query.queryScopeId === queryScopeId ? replacement : query
  );
}
