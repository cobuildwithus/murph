import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
  buildEpicProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
  searchClinicalProviderDirectorySnapshot,
} from "@/src/lib/clinical-records/provider-directory";
import {
  EPIC_ACQUISITION_POLICY,
  EPIC_ACQUISITION_POLICY_ID,
  EPIC_BETA_REQUESTED_BASE_SCOPES,
  EPIC_BETA_RESOURCE_TYPES,
  buildEpicBetaRetrievalPlan,
} from "@/src/lib/clinical-records/epic-policy";
import { selectSmartRequestedScopes } from "@/src/lib/clinical-records/smart";
import { clinicalProviderPlaceLabels } from "@/src/lib/clinical-records/client-contracts";
import { postalCentroid } from "@/src/lib/clinical-records/postal-centroids";

const generatedAt = "2026-07-10T00:00:00.000Z";

describe("Clinical Records provider directory", () => {
  it("loads the current self-hosted Epic brand registry with stable unique ids", () => {
    const directory = parseClinicalProviderDirectory(JSON.parse(readFileSync(
      new URL("../src/lib/clinical-records/provider-directory.v2.json", import.meta.url),
      "utf8",
    )));

    expect(directory.entries.length).toBeGreaterThan(1_000);
    expect(directory.version).toMatch(/^\d{4}-\d{2}-\d{2}\.epic-brands-r4-policy-v2$/u);
    expect(directory.schema).toBe(CLINICAL_PROVIDER_DIRECTORY_SCHEMA);
    expect(directory.sourceBundleSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(new Set(directory.entries.map((entry) => entry.id)).size).toBe(directory.entries.length);
    expect(directory.entries.every((entry) => entry.policyId === EPIC_ACQUISITION_POLICY_ID)).toBe(true);
    expect(directory.entries.every((entry) =>
      JSON.stringify(entry.requestedBaseScopes)
        === JSON.stringify(EPIC_BETA_REQUESTED_BASE_SCOPES)
    )).toBe(true);
    expect(directory.entries.every((entry) =>
      JSON.stringify(entry.resourceTypes) === JSON.stringify(EPIC_BETA_RESOURCE_TYPES)
    )).toBe(true);
    expect(directory.entries.find((entry) => entry.id === "epic-sandbox")).toMatchObject({
      brandName: "Epic Sandbox (test data only)",
      clientIdEnvironmentKey: "EPIC_SMART_NON_PRODUCTION_CLIENT_ID",
      fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    });
  });

  it("drives the existing SMART and retrieval contract from a committed v2 entry", () => {
    const entry = readCommittedDirectory().entries.find((candidate) =>
      candidate.id === "epic-sandbox"
    );
    if (!entry) throw new TypeError("Committed Epic sandbox entry is missing.");

    expect(selectSmartRequestedScopes({
      capabilities: ["permission-v2", "context-standalone-patient"],
      requestedBaseScopes: entry.requestedBaseScopes,
      resourceTypes: entry.resourceTypes,
    })).toEqual({
      resourceTypes: [...EPIC_BETA_RESOURCE_TYPES],
      scopes: [
        "openid",
        "fhirUser",
        "launch/patient",
        "patient/Patient.r",
        "patient/Observation.s",
        "patient/DiagnosticReport.s",
        "patient/AllergyIntolerance.s",
        "patient/CarePlan.s",
        "patient/CareTeam.s",
        "patient/Condition.s",
        "patient/Device.s",
        "patient/DocumentReference.s",
        "patient/Encounter.s",
        "patient/FamilyMemberHistory.s",
        "patient/Immunization.s",
        "patient/MedicationDispense.s",
        "patient/MedicationRequest.s",
        "patient/Procedure.s",
        "patient/Goal.s",
        "patient/ServiceRequest.s",
        "patient/Binary.r",
        "patient/Media.r",
      ],
    });
    expect(buildEpicBetaRetrievalPlan({ hospitalApprovedImports: true,
      frozenAt: new Date("2026-07-21T12:00:00.000Z"),
      pageCount: "100",
      resourceTypes: entry.resourceTypes,
    }).slices.map((slice) => slice.queryScopeId)).toEqual([
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
      "document-references-imaging",
      "document-references-external-ccda",
      "document-references-outside-notes",
      "outside-vital-sign-observations",
      "document-references-summaries",
      "document-references-questionnaires",
      "document-references-correspondence",
      "document-references-handoff",
      "document-references-assessments",
      "document-references-document-information",
      "document-references-clinical-references",
      "document-references-his",
      "document-references-oasis",
      "document-references-irf-pai",
      "document-references-advance-directive",
      "document-references-irf-pai-hyphenated",

    ]);
  });

  it("matches compound organization and location searches across fields", () => {
    const directory = parseClinicalProviderDirectory(makeDirectory({
      locations: [["Downtown Clinic", "Atlanta", "GA", "30309"]],
    }));

    expect(searchClinicalProviderDirectorySnapshot(directory, {
      query: "Test Health, Atlanta, GA",
    }).providers).toHaveLength(1);
    expect(searchClinicalProviderDirectorySnapshot(directory, {
      query: "Atlanta, GA",
    }).providers[0]?.facilities[0]).toMatchObject({
      city: "Atlanta",
      state: "GA",
    });
  });

  it("does not combine compound location tokens from different facilities", () => {
    const directory = parseClinicalProviderDirectory(makeDirectory({
      locations: [
        ["Atlanta Clinic", "Atlanta", "GA", "30309"],
        ["Austin Clinic", "Austin", "TX", "78701"],
      ],
    }));

    expect(searchClinicalProviderDirectorySnapshot(directory, {
      query: "Atlanta TX",
    }).providers).toEqual([]);
    expect(searchClinicalProviderDirectorySnapshot(directory, {
      query: "Atlanta IN",
    }).providers).toEqual([]);
    expect(searchClinicalProviderDirectorySnapshot(directory, {
      query: "IN",
    }).providers).toEqual([]);
  });

  it("matches a standalone state abbreviation only as an exact word", () => {
    const directory = parseClinicalProviderDirectory(makeDirectory({
      locations: [["Indiana Clinic", "Indianapolis", "IN", "46202"]],
    }));

    expect(searchClinicalProviderDirectorySnapshot(directory, {
      query: "IN",
    }).providers[0]?.facilities[0]).toMatchObject({
      city: "Indianapolis",
      state: "IN",
    });
  });

  it("finds current Atlanta facilities and the Piedmont brand in the committed registry", () => {
    const directory = readCommittedDirectory();
    const atlanta = searchClinicalProviderDirectorySnapshot(directory, { query: "Atlanta" });
    const piedmont = searchClinicalProviderDirectorySnapshot(directory, { query: "Piedmont" });

    expect(atlanta.providers.some((provider) =>
      provider.brandName.toLocaleLowerCase("en-US").includes("atlanta")
      || provider.facilities.some((facility) =>
        facility.city?.toLocaleLowerCase("en-US") === "atlanta"
      )
    )).toBe(true);
    expect(piedmont.providers.some((provider) =>
      provider.brandName.toLocaleLowerCase("en-US").includes("piedmont")
    )).toBe(true);
  });

  it("groups shared endpoints before the result cap while preserving the best matching directory ID", () => {
    const directory = parseClinicalProviderDirectory(makeDirectory({}));
    const original = directory.entries[0]!;
    const entries = Array.from({ length: 22 }, (_, index) => ({ ...original, id: `epic-site-${index}`, brandName: `Clinic ${index}` }));
    entries.push({ ...original, id: "epic-remote", brandName: "Clinic 2", fhirBaseUrl: "https://remote.example.test/r4" });
    const results = searchClinicalProviderDirectorySnapshot({ ...directory, entries }, { grouped: true, query: "Clinic 2" }).providers;
    expect(results.map(row => row.id)).toEqual(["epic-site-2", "epic-remote"]);
    expect(results[0]?.sharedPlaces).toContain("Clinic 1");
    expect(results[1]?.sharedPlaces).toBeUndefined();
  });

  it("keeps the Epic brand id stable when the endpoint changes", () => {
    expect(buildEpicProviderDirectoryEntryId("brand-123"))
      .toBe(buildEpicProviderDirectoryEntryId("brand-123"));
    expect(buildEpicProviderDirectoryEntryId("brand-123")).toBe("epic-brand-123");
  });

  it("ranks a matching city into the visible facilities even when it was beyond index eight", () => {
    const directory = parseClinicalProviderDirectory(makeDirectory({
      locations: [
        ...Array.from({ length: 250 }, (_, index) => [
          `Facility ${index}`,
          `Other City ${index}`,
          index < 200 ? "AK" : "FL",
          null,
        ]),
        ["Atlanta Medical Center", "Atlanta", "GA", "30309"],
      ],
    }));

    const result = searchClinicalProviderDirectorySnapshot(directory, { query: "Atlanta" });

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.facilities[0]).toMatchObject({
      city: "Atlanta",
      name: "Atlanta Medical Center",
    });
  });

  it("fails closed for duplicate ids and private provider endpoints", () => {
    const one = makeDirectory({});
    expect(() => parseClinicalProviderDirectory({
      ...one,
      entries: [one.entries[0], one.entries[0]],
    })).toThrow(/duplicate entry ids/u);
    expect(() => parseClinicalProviderDirectory(makeDirectory({
      fhirBaseUrl: "https://127.0.0.1/FHIR/R4",
    }))).toThrow(/private host/u);
    for (const fhirBaseUrl of [
      "https://[::1]/FHIR/R4",
      "https://[fc00::1]/FHIR/R4",
      "https://[fe80::1]/FHIR/R4",
      "https://[::ffff:127.0.0.1]/FHIR/R4",
      "https://[::ffff:192.168.1.10]/FHIR/R4",
    ]) {
      expect(() => parseClinicalProviderDirectory(makeDirectory({ fhirBaseUrl })))
        .toThrow(/private host/u);
    }
    expect(() => parseClinicalProviderDirectory(makeDirectory({
      clientIdEnvironmentKey: "EPIC_SMART_OTHER_CLIENT_ID",
    }))).toThrow(/client-id configuration is unsupported/u);
  });

  it("rejects obsolete schemas and unknown policy references", () => {
    expect(() => parseClinicalProviderDirectory({
      ...makeDirectory({}),
      schema: "murph.clinical-provider-directory.v1",
    })).toThrow(/schema is unsupported/u);

    expect(() => parseClinicalProviderDirectory(makeDirectory({
      policyId: "unknown-policy",
    }))).toThrow(/unknown policy/u);
  });

  it("rejects unsorted v2 entries", () => {
    const first = makeDirectory({ id: "epic-z-brand" });
    const secondEntry = makeDirectory({ id: "epic-a-brand" }).entries[0];
    expect(() => parseClinicalProviderDirectory({
      ...first,
      entries: [first.entries[0], secondEntry],
    })).toThrow(/strictly sorted/u);

  });

  it("requires the exact owned policy and rejects malformed hashes", () => {
    expect(() => parseClinicalProviderDirectory(makeDirectory({
      policies: [
        { ...EPIC_ACQUISITION_POLICY, id: "z-policy" },
        { ...EPIC_ACQUISITION_POLICY, id: "a-policy" },
      ],
      policyId: "z-policy",
    }))).toThrow(/exactly one owned policy/u);
    expect(() => parseClinicalProviderDirectory(makeDirectory({
      policies: [{
        ...EPIC_ACQUISITION_POLICY,
        registrationApis: [
          EPIC_ACQUISITION_POLICY.registrationApis[0],
          EPIC_ACQUISITION_POLICY.registrationApis[0],
          ...EPIC_ACQUISITION_POLICY.registrationApis.slice(2),
        ],
      }],
    }))).toThrow(/exactly match the owned Epic policy/u);
    expect(() => parseClinicalProviderDirectory(makeDirectory({
      policies: [{
        ...EPIC_ACQUISITION_POLICY,
        registrationApis: EPIC_ACQUISITION_POLICY.registrationApis.slice(1),
      }],
    }))).toThrow(/exactly match the owned Epic policy/u);
    expect(() => parseClinicalProviderDirectory(makeDirectory({
      sourceBundleSha256: "not-a-sha256",
    }))).toThrow(/source bundle hash/u);


  });
});

function readCommittedDirectory() {
  return parseClinicalProviderDirectory(JSON.parse(readFileSync(
    new URL("../src/lib/clinical-records/provider-directory.v2.json", import.meta.url),
    "utf8",
  )));
}

function makeDirectory(overrides: {
  clientIdEnvironmentKey?: string;
  fhirBaseUrl?: string;
  id?: string;
  locations?: Array<Array<string | null>>;
  policies?: unknown[];
  policyId?: string;
  sourceBundleSha256?: string;
}) {
  return {
    entries: [{
      aliases: ["Test Health"],
      brandName: "Test Health System",
      clientIdEnvironmentKey: overrides.clientIdEnvironmentKey ?? "EPIC_SMART_CLIENT_ID",
      fhirBaseUrl: overrides.fhirBaseUrl ?? "https://fhir.example.test/FHIR/R4",
      id: overrides.id ?? "epic-test-brand",
      locations: overrides.locations ?? [],
      policyId: overrides.policyId ?? EPIC_ACQUISITION_POLICY_ID,
    }],
    generatedAt,
    policies: overrides.policies ?? [EPIC_ACQUISITION_POLICY],
    schema: CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
    sourceBundleSha256: overrides.sourceBundleSha256 ?? "0".repeat(64),
    version: "test-v2",
  };
}

describe("public facility proximity", () => {
  const directory = parseClinicalProviderDirectory(makeDirectory({ locations: [] }));
  const template = directory.entries[0]!;
  const facility = (name: string, coordinate: readonly [number, number] | null, postalCode = "30309") =>
    ({ name, city: "Pond", state: "GA", postalCode, coordinate });
  const entry = (id: string, facilities: ReturnType<typeof facility>[], base = id) =>
    ({ ...template, id, brandName: id, facilities, fhirBaseUrl: `https://${base}.example.test/r4` });
  const snapshot = { ...directory, entries: [
    entry("first", [facility("Reed", [33.85, -84.4])], "shared"),
    entry("second", [facility("Reed", [33.8, -84.4]), facility("Moss", [33.79, -84.39])], "shared"),
    entry("third", [facility("Distant", [35, -84.5])]),
    entry("unplaced", [facility("Unplaced", null, "00000")]),
  ] };

  it("uses a ZIP at either end of the query and matches the facility before grouping", () => {
    for (const query of ["30309 Reed", "Reed, 30309", "30309-1001 Reed"]) {
      const { providers } = searchClinicalProviderDirectorySnapshot(snapshot, { query, grouped: true, includeDistance: true, postalCentroid });
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({ id: "second", matchedFacility: { name: "Reed", approximateDistanceMiles: expect.any(Number) } });
    }
  });

  it("applies the radius before caps and ranks ties stably using unrounded distances", () => {
    const entries = [...Array.from({ length: 23 }, (_, n) => entry("far-" + n, [facility("Far", [33.9, -84.4])])),
      entry("tie-z", [facility("South", [33.8, -84.4])]), ...snapshot.entries, entry("tie-a", [facility("East", [33.8, -84.4])])];
    const { providers } = searchClinicalProviderDirectorySnapshot({ ...directory, entries }, {
      near: { lat: 33.8, lon: -84.4 }, grouped: true, includeDistance: true,
    });
    expect(providers).toHaveLength(20);
    expect(providers.slice(0, 3).map(row => row.id)).toEqual(["second", "tie-a", "tie-z"]);
    expect(providers[0]?.matchedFacility).toMatchObject({ name: "Reed", approximateDistanceMiles: 0 });
    expect(providers.some(row => ["third", "unplaced"].includes(row.id))).toBe(false);
  });

  it("reads a street number, or digits inside the query, as text rather than a ZIP", () => {
    const valley = { ...facility("Valley Clinic", [33.85, -84.4]), street: ["12401 Hospital Drive"] };
    const withStreet = { ...snapshot, entries: [...snapshot.entries, entry("valley", [valley])] };
    for (const query of ["12401 Hospital Drive", "12401 Hospital Drive, Pond", "Hospital 12401 Drive"]) {
      const { providers } = searchClinicalProviderDirectorySnapshot(withStreet, { query, grouped: true, includeDistance: true, postalCentroid });
      expect(providers.map(row => row.id)).toEqual(["valley"]);
      expect(providers[0]?.matchedFacility).not.toHaveProperty("approximateDistanceMiles");
    }
    // A leading "St" names a saint; the ZIP still locates the search.
    const saint = { ...snapshot, entries: [entry("st-reed", [facility("St Reed", [33.8, -84.4])])] };
    for (const query of ["St Reed 30309", "30309 St Reed", "30309"]) {
      const { providers } = searchClinicalProviderDirectorySnapshot(saint, { query, grouped: true, includeDistance: true, postalCentroid });
      expect(providers[0]?.matchedFacility).toMatchObject({ name: "St Reed", approximateDistanceMiles: expect.any(Number) });
    }
  });

  it("shows sub-mile distances as less than a mile", () => {
    const labels = (approximateDistanceMiles: number) => clinicalProviderPlaceLabels({
      brandName: "Reed", id: "reed", sourceSystem: "epic-fhir", facilities: [],
      matchedFacility: { name: "Reed", city: "Pond", state: "GA", postalCode: null, approximateDistanceMiles },
    });
    expect(labels(0)).toContain("less than 1 mi");
    expect(labels(3)).toContain("about 3 mi");
  });

  it("falls back to text for an unmapped ZIP and keeps unmapped clinics discoverable by name", () => {
    for (const query of ["00000", "Unplaced"]) {
      const result = searchClinicalProviderDirectorySnapshot(snapshot, { query, grouped: true, includeDistance: true, postalCentroid });
      expect(result.providers.map(p => p.id)).toEqual(["unplaced"]);
      expect(result.providers[0]?.matchedFacility).not.toHaveProperty("approximateDistanceMiles");
    }
    const directoryOnly = { ...snapshot, entries: [entry("westhaven", [])] };
    const named = searchClinicalProviderDirectorySnapshot(directoryOnly, { query: "westhaven 30309", grouped: true, postalCentroid });
    expect(named.providers[0]).toMatchObject({ id: "westhaven", matchedFacility: null });
    const old = searchClinicalProviderDirectorySnapshot(snapshot, { query: "30309", grouped: true, postalCentroid });
    expect(old.providers[0]?.matchedFacility).not.toHaveProperty("approximateDistanceMiles");
    expect(old.providers[0]?.matchedFacility).not.toHaveProperty("coordinate");
  });
});
