import { describe, expect, it } from "vitest";
import { CLINICAL_PROVIDER_DIRECTORY_SCHEMA, matchClinicalPortalSender, searchClinicalProviderDirectorySnapshot,
  type ClinicalProviderDirectory, type ClinicalProviderDirectoryEntry } from "../src/provider-directory.js";
import { normalizePortalDiscoveryFragment, portalDiscoveryFragment } from "../src/portal-discovery-link.js";

function place(id: string, base: string): ClinicalProviderDirectoryEntry {
  return { id, aliases: [], brandName: "Copper Basin", facilities: [], fhirBaseUrl: base,
    clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID", policyId: "sample", sourceSystem: "epic-fhir" };
}

function directory(entries: ClinicalProviderDirectoryEntry[]): ClinicalProviderDirectory {
  return { entries, schema: CLINICAL_PROVIDER_DIRECTORY_SCHEMA, generatedAt: "", sourceBundleSha256: "", version: "sample" };
}

describe("portal discovery", () => {
  const shared = "https://records.epichosted.com/r4";
  const sender = { displayName: "Copper Basin Patient Portal", domain: "notices.epichosted.com" };
  it("counts all distinct portals before display limits and follows the current artifact", () => {
    const siblings = Array.from({ length: 23 }, (_, i) => place(`epic-${i}`, shared));
    expect(searchClinicalProviderDirectorySnapshot(directory(siblings), { query: "Copper Basin" }).providers).toHaveLength(20);
    expect(matchClinicalPortalSender(directory(siblings), sender)?.brandName).toBe("Copper Basin");
    expect(matchClinicalPortalSender(directory([...siblings, place("epic-other", shared + "/other")]), sender)).toEqual({ brandName: "Copper Basin" });
    expect(matchClinicalPortalSender(directory([]), sender)).toBeNull();
  });
  it("inspects facility aliases beyond the displayed eight", () => {
    const entry = place("epic-one", shared);
    entry.facilities = Array.from({ length: 10 }, (_, n) => ({ city: null, state: null, postalCode: null,
      name: "Department", aliases: n === 9 ? ["Tidal Annex"] : [] }));
    expect(matchClinicalPortalSender(directory([entry]), { ...sender, displayName: "Tidal Annex MyChart" })).toEqual({ brandName: "Tidal Annex" });
  });
  it("uses an exact name to choose among portals on one organizational domain", () => {
    const first = place("epic-east", "https://east.basin.test/r4");
    const west = { ...place("epic-west", "https://west.basin.test/r4"), brandName: "Basin West" };
    expect(matchClinicalPortalSender(directory([first, west]), { domain: "mail.basin.test", displayName: "Basin West" }))
      .toEqual({ id: west.id, brandName: west.brandName });
  });
  it.each(["Main Campus", "Urgent Care", "Family Medicine"])("keeps %s as a search on either domain", name => {
    const entry = { ...place("epic-one", "https://fhir.basin.test/r4"), aliases: [name] };
    for (const domain of ["basin.test", "another.test"]) {
      const result = matchClinicalPortalSender(directory([entry]), { domain, displayName: name });
      expect(result).toEqual({ brandName: name });
      const hash = portalDiscoveryFragment(result!);
      expect(normalizePortalDiscoveryFragment(hash)).toBe(hash);
      expect(hash).not.toContain("provider=");
    }
  });
  it("uses organizational domains and excludes shared services, URL-shaped and lookalike senders", () => {
    const entry = place("epic-one", "https://fhir.copper-basin.co.uk/r4");
    const lookup = (domain: string) => matchClinicalPortalSender(directory([entry]), { displayName: "synthetic-private-marker", domain });
    expect(lookup("mail.copper-basin.co.uk")).toEqual({ id: entry.id, brandName: entry.brandName });
    for (const domain of ["mail.other.co.uk", "copper-basin.co.uk.other.test", "https://copper-basin.co.uk", "copper-basin.co.uk/path"]) expect(lookup(domain)).toBeNull();
    expect(matchClinicalPortalSender(directory([place("epic-shared", shared)]), { ...sender, displayName: "MyChart" })).toBeNull();
  });
  it("retains a bounded public search and rejects malformed fragment shapes", () => {
    const hash = portalDiscoveryFragment({ id: "epic-one", brandName: "Copper & Basin" });
    expect(normalizePortalDiscoveryFragment(hash)).toBe(hash);
    expect(new URLSearchParams(hash.slice(1)).get("find")).toBe("Copper & Basin");
    for (const bad of ["#provider=bad/id&find=A", hash + "&find=B", "#find=A&extra=B", "#find=%0A&provider=a", "#find=" + "x".repeat(121) + "&provider=a"]) {
      expect(normalizePortalDiscoveryFragment(bad)).toBe("");
    }
  });
});
