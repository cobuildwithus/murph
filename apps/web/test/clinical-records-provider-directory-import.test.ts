import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildEpicProviderDirectoryArtifact } from "@/scripts/import-epic-clinical-provider-directory";

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
      locations: [["TEST CLINIC", "ATLANTA", "ga", "30309"]],
    });
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

  it("rejects duplicate source identities", () => {
    const bundle = makeBundle();
    expect(() => buildEpicProviderDirectoryArtifact(JSON.stringify({
      ...bundle,
      entry: [...bundle.entry, bundle.entry[0]],
    }))).toThrow(/duplicate entry fullUrls/u);
  });
});

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
          address: [{ city: "Atlanta", postalCode: "30309", state: "GA" }],
          name: "Test Clinic",
          partOf: { reference: "urn:uuid:brand-1" },
          resourceType: "Organization",
        },
      },
      {
        fullUrl: "urn:uuid:facility-2",
        resource: {
          active: true,
          address: [{ city: "ATLANTA", postalCode: "30309", state: "ga" }],
          name: "TEST CLINIC",
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
