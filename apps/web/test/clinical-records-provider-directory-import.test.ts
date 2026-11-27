import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseClinicalProviderDirectory, searchClinicalProviderDirectorySnapshot } from "@/src/lib/clinical-records/provider-directory";
import { parseClinicalProviderSearchResponse } from "@/src/lib/clinical-records/client-contracts";
import { assertDirectoryRefreshCounts } from "@/src/lib/clinical-records/provider-directory-artifact";
import { buildEpicProviderDirectoryArtifact, refreshEpicProviderDirectory } from "@/scripts/import-epic-clinical-provider-directory";

const generatedAt = "2026-07-20T08:00:05.631Z";

describe("Epic Clinical Records provider directory importer", () => {
  it("is deterministic for fixed bytes and hashes the exact source bundle", () => {
    const source = JSON.stringify(makeBundle());
    const first = buildEpicProviderDirectoryArtifact(source);
    const second = buildEpicProviderDirectoryArtifact(source);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.sourceBundleSha256).toBe(
      createHash("sha256").update(source, "utf8").digest("hex"),
    );
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toMatchObject({
      fhirBaseUrl: "https://fhir.example.test/FHIR/R4",
      id: "epic-brand-123",
      locations: expect.arrayContaining([
        ["Test Clinic", "Atlanta", "GA", "30309", ["18 Lantern Way"], ["Lantern"], [33.8, -84.386]],
        ["Test Clinic", "Atlanta", "GA", "30309", ["32 Harbor Lane"], [], [33.8, -84.386]],
      ]),
    });
  });

  it("keeps nested aliases and streets on their place, skips inactive parents and serves both browser shapes", () => {
    const bundle = makeBundle();
    const child = bundle.entry[3]!;
    child.resource.partOf = { reference: "urn:uuid:facility-1" };
    const load = () => parseClinicalProviderDirectory(buildEpicProviderDirectoryArtifact(JSON.stringify(bundle)));
    const directory = load();
    const query = "Harbor Lane";
    const legacy = searchClinicalProviderDirectorySnapshot(directory, { query }).providers[0]!;
    expect(Object.keys(legacy).sort()).toEqual(["brandName", "facilities", "id", "sourceSystem"]);
    expect(Object.keys(legacy.facilities[0]!).sort()).toEqual(["city", "name", "postalCode", "state"]);
    const grouped = searchClinicalProviderDirectorySnapshot(directory, { query, grouped: true });
    expect(parseClinicalProviderSearchResponse({ ...grouped, ok: true }).providers[0]?.matchedFacility?.street).toEqual(["32 Harbor Lane"]);
    expect(directory.entries[0]?.aliases).not.toContain("Lantern");
    expect(searchClinicalProviderDirectorySnapshot(directory, { query: "Lantern", grouped: true }).providers[0]?.matchedFacility?.street)
      .toEqual(["18 Lantern Way"]);
    bundle.entry[2]!.resource.active = false;
    expect(searchClinicalProviderDirectorySnapshot(load(), { query }).providers).toEqual([]);
  });

  it("canonicalizes source entry order without falsifying the exact-byte hash", () => {
    const bundle = makeBundle();
    const source = JSON.stringify(bundle);
    const shuffledSource = JSON.stringify({
      ...bundle,
      entry: [...bundle.entry].reverse(),
    });
    const canonical = buildEpicProviderDirectoryArtifact(source);
    const shuffled = buildEpicProviderDirectoryArtifact(shuffledSource);

    expect(shuffled.entries).toEqual(canonical.entries);
    expect(shuffled.policies).toEqual(canonical.policies);
    expect(shuffled.generatedAt).toBe(canonical.generatedAt);
    expect(shuffled.version).toBe(canonical.version);
    expect(shuffled.sourceBundleSha256).not.toBe(canonical.sourceBundleSha256);
    expect(shuffled.sourceBundleSha256).toBe(
      createHash("sha256").update(shuffledSource, "utf8").digest("hex"),
    );
  });

  it("rejects a refresh losing more than ten percent of brands, facilities or located facilities", () => {
    const artifact = buildEpicProviderDirectoryArtifact(JSON.stringify(makeBundle()));
    const baseline = parseClinicalProviderDirectory(artifact);
    expect(() => assertDirectoryRefreshCounts(baseline, baseline)).not.toThrow();
    expect(() => assertDirectoryRefreshCounts(baseline, { ...baseline, entries: baseline.entries.slice(0, 1) })).toThrow(/10%/u);
    for (const facilities of [[], baseline.entries[0]!.facilities.map(f => ({ ...f, coordinate: null }))]) {
      expect(() => assertDirectoryRefreshCounts(baseline, {
        ...baseline, entries: [{ ...baseline.entries[0]!, facilities }, ...baseline.entries.slice(1)],
      })).toThrow(/10%/u);
    }
    artifact.entries[0]!.locations[0]![6] = [94, -84];
    expect(() => parseClinicalProviderDirectory(artifact)).toThrow(/coordinate/u);
  });

  it("holds endpoint changes, removals and new hosts, and publishes new entries on known hosts", () => {
    const current = "https://fhir.example.test/FHIR/R4";
    const previousArtifact = buildEpicProviderDirectoryArtifact(JSON.stringify(makeBundle()));
    const previous = JSON.stringify(previousArtifact);
    const refresh = (change: (bundle: ReturnType<typeof makeBundle>) => void) => {
      const bundle = makeBundle();
      change(bundle);
      return refreshEpicProviderDirectory(JSON.stringify(bundle), previous);
    };
    const entry = (artifact: ReturnType<typeof refresh>["artifact"], id: string) =>
      artifact.entries.find(candidate => candidate.id === id);

    for (const address of [
      "https://fhir.example.test/v2/FHIR/R4", "https://moved.example.test/FHIR/R4", "https://fhir.example.test:8443/FHIR/R4",
    ]) {
      const moved = refresh(bundle => { bundle.entry[0]!.resource.address = address; });
      expect(moved.held).toEqual([{ kind: "endpoint", id: "epic-brand-123", current, candidate: address }]);
      expect(entry(moved.artifact, "epic-brand-123")?.fhirBaseUrl).toBe(current);
    }

    const removed = refresh(bundle => { bundle.entry[1]!.resource.active = false; });
    expect(removed.held).toEqual([{ kind: "removal", id: "epic-brand-123", current }]);
    expect(entry(removed.artifact, "epic-brand-123")).toEqual(previousArtifact.entries.find(item => item.id === "epic-brand-123"));

    const added = refresh(bundle => {
      bundle.entry.push(...makeBrand("brand-456", "https://new.example.test/FHIR/R4"));
      bundle.entry.push(...makeBrand("brand-789", "https://fhir.example.test/FHIR/R4/other"));
    });
    expect(added.held).toEqual([{
      kind: "new-host", id: "epic-brand-456", brandName: "Second Health", candidate: "https://new.example.test/FHIR/R4",
    }]);
    expect(entry(added.artifact, "epic-brand-456")).toBeUndefined();
    expect(entry(added.artifact, "epic-brand-789")?.fhirBaseUrl).toBe("https://fhir.example.test/FHIR/R4/other");
    expect(added.artifact.entries.map(item => item.id)).toEqual(["epic-brand-123", "epic-brand-789", "epic-sandbox"]);
  });

  it("rejects duplicate source identities", () => {
    const bundle = makeBundle();
    expect(() => buildEpicProviderDirectoryArtifact(JSON.stringify({
      ...bundle,
      entry: [...bundle.entry, bundle.entry[0]],
    }))).toThrow(/duplicate entry fullUrls/u);
  });
});

function makeBrand(identifier: string, address: string) {
  return [
    { fullUrl: `urn:uuid:endpoint-${identifier}`, resource: {
      address, extension: [{ url: "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version", valueCode: "4.0.1" }],
      resourceType: "Endpoint", status: "active",
    } },
    { fullUrl: `urn:uuid:${identifier}`, resource: {
      active: true, endpoint: [{ reference: `urn:uuid:endpoint-${identifier}` }], name: "Second Health",
      identifier: [{ system: "https://open.epic.com/brand-identifier", value: identifier }], resourceType: "Organization",
    } },
  ];
}

function makeBundle() {
  return {
    entry: [
      {
        fullUrl: "urn:uuid:endpoint-1",
        resource: {
          address: "https://fhir.example.test/FHIR/R4",
          extension: [{
            url: "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version",
            valueCode: "4.0.1",
          }],
          resourceType: "Endpoint",
          status: "active",
        },
      },
      {
        fullUrl: "urn:uuid:brand-1",
        resource: {
          active: true,
          endpoint: [{ reference: "urn:uuid:endpoint-1" }],
          identifier: [{
            system: "https://open.epic.com/brand-identifier",
            value: "brand-123",
          }],
          name: "Test Health System",
          resourceType: "Organization",
        },
      },
      {
        fullUrl: "urn:uuid:facility-1",
        resource: {
          active: true,
          alias: ["Lantern"],
          address: [{ city: "Atlanta", postalCode: "30309", state: "GA", line: ["18 Lantern Way"] }],
          name: "Test Clinic",
          partOf: { reference: "urn:uuid:brand-1" },
          resourceType: "Organization",
        },
      },
      {
        fullUrl: "urn:uuid:facility-2",
        resource: {
          active: true,
          id: "facility-north",
          address: [{ city: "Atlanta", postalCode: "30309", state: "GA", line: ["Test Clinic", "32 Harbor Lane"] }],
          name: "Test Clinic",
          partOf: { reference: "urn:uuid:brand-1" },
          resourceType: "Organization",
        },
      },
    ],
    resourceType: "Bundle",
    timestamp: generatedAt,
    type: "collection",
  };
}
