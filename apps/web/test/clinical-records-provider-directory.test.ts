import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  buildEpicProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
  searchClinicalProviderDirectorySnapshot,
} from "@/src/lib/clinical-records/provider-directory";

const generatedAt = "2026-07-10T00:00:00.000Z";

describe("Clinical Records provider directory", () => {
  it("loads the current self-hosted Epic brand registry with stable unique ids", () => {
    const directory = parseClinicalProviderDirectory(JSON.parse(readFileSync(
      new URL("../src/lib/clinical-records/provider-directory.v1.json", import.meta.url),
      "utf8",
    )));

    expect(directory.entries).toHaveLength(1_243);
    expect(directory.version).toMatch(/^2026-07-11\.epic-brands-r4$/u);
    expect(new Set(directory.entries.map((entry) => entry.id)).size).toBe(directory.entries.length);
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
  });
});

function readCommittedDirectory() {
  return parseClinicalProviderDirectory(JSON.parse(readFileSync(
    new URL("../src/lib/clinical-records/provider-directory.v1.json", import.meta.url),
    "utf8",
  )));
}

function makeDirectory(overrides: {
  locations?: Array<Array<string | null>>;
  fhirBaseUrl?: string;
}) {
  return {
    entries: [{
      aliases: ["Test Health"],
      brandName: "Test Health System",
      clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID",
      locations: overrides.locations ?? [],
      fhirBaseUrl: overrides.fhirBaseUrl ?? "https://fhir.example.test/FHIR/R4",
      id: "epic-test-brand",
      requestedBaseScopes: ["openid", "fhirUser", "launch/patient"],
      resourceTypes: ["Patient", "Observation"],
      sourceSystem: "epic-fhir",
    }],
    generatedAt,
    schema: "murph.clinical-provider-directory.v1",
    version: "test-v1",
  };
}
