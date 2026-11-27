import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as companionSearch } from "../app/api/clinical-records/companion/providers/search/route";
import { POST } from "../app/api/clinical-records/providers/search/route";
import { parseClinicalProviderSearchResponse } from "@/src/lib/clinical-records/client-contracts";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ clinicalRecordConnection: { findMany } }) }));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({ assertHostedOnboardingMutationOrigin: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: async () => ({ member: { id: "member-alder" } }),
}));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActiveHostedMemberAuthFromBearerToken: async () => ({ member: { id: "member-alder" } }),
}));
afterEach(() => vi.unstubAllEnvs());
vi.mock("@/src/lib/clinical-records/provider-directory.v2.json", async () => {
  const { EPIC_ACQUISITION_POLICY, EPIC_ACQUISITION_POLICY_ID } = await import("@/src/lib/clinical-records/epic-policy");
  const { ORACLE_ACQUISITION_POLICY } = await import("@/src/lib/clinical-records/oracle-policy");
  return { default: {
    schema: "murph.clinical-provider-directory.v2", version: "sample", sourceBundleSha256: "0".repeat(64),
    generatedAt: "2026-07-10T00:00:00.000Z", policies: [EPIC_ACQUISITION_POLICY, ORACLE_ACQUISITION_POLICY],
    entries: [...["Alder", "Birch"].map(brandName => ({
      aliases: [], brandName, id: "epic-" + brandName.toLowerCase(), policyId: EPIC_ACQUISITION_POLICY_ID,
      clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID", fhirBaseUrl: "https://portal.example.test/r4",
      locations: [[brandName + " Clinic", "Cove", "ME", null, ["12 Pine Road"], [], [44.1, -70.2]]],
    })),
    // Twenty exact-name Oracle tenants outrank both Epic brands for "Clinic".
    ...Array.from({ length: 20 }, (_, index) => ({
      aliases: [], brandName: "Clinic", id: `oracle-${String(index).padStart(20, "0")}`, integration: "oracle-millennium-r4",
      policyId: ORACLE_ACQUISITION_POLICY.id, fhirBaseUrl: `https://fhir-myrecord.cerner.com/r4/tenant-${index}`, locations: [],
    }))],
  } };
});

it.each([
  ["equivalent saved grants", "chart-a", "client-a", "direct"],
  ["different patient", "chart-b", "client-a", "direct"],
  ["different client", "chart-a", "client-b", "direct"],
  ["different acquisition authority", "chart-a", "client-a", "other"],
])("keeps one selectable portal with an advisory for %s", async (_case, patient, client, authority) => {
  const hash = createHash("sha256").update("https://portal.example.test/r4").digest("hex");
  findMany.mockResolvedValue([
    { displayName: "Birch", fhirBaseHash: hash, patient: "chart-a", client: "client-a", authority: "direct" },
    { displayName: "Alder", fhirBaseHash: hash, patient, client, authority },
  ]);
  const rich = await searchClinicalProviderDirectory({ query: "Alder" }, "member-alder");
  expect(rich.providers).toHaveLength(1);
  expect(rich.providers[0]).toMatchObject({ id: "epic-alder", sharedPlaces: ["Birch"], possiblyIncludedThrough: "Birch" });
  expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { memberId: "member-alder", fhirBaseHash: { in: [hash] }, status: { not: "disconnected" } },
    select: { fhirBaseHash: true, displayName: true }, take: 100,
  }));
});

it("negotiates place fields while a loaded legacy browser gets its exact projection", async () => {
  const request = (headers: Record<string, string>) => new Request("https://app.example.test/search", {
    method: "POST", body: JSON.stringify({ query: "Clinic" }), headers,
  });
  const legacy = await (await POST(request({}))).json();
  expect(legacy.providers).toHaveLength(2);
  for (const row of legacy.providers) {
    expect(Object.keys(row).sort()).toEqual(["brandName", "facilities", "id", "sourceSystem"]);
    expect(Object.keys(row.facilities[0]).sort()).toEqual(["city", "name", "postalCode", "state"]);
  }
  findMany.mockResolvedValue([]);
  const rich = parseClinicalProviderSearchResponse(await (await POST(request({ "X-Clinical-Directory-Version": "2" }))).json());
  expect(rich.providers).toHaveLength(1);
  expect(rich.providers[0]?.matchedFacility).toEqual({ name: "Alder Clinic", city: "Cove", state: "ME",
    postalCode: null, street: ["12 Pine Road"] });
});

it.each(["basic", "hospital"] as const)("selects the %s sibling in both grouped search responses", async access => {
  vi.stubEnv("EPIC_SMART_CLIENT_ID", "public");
  vi.stubEnv("EPIC_SMART_PERSISTENT_CREDENTIALS", JSON.stringify({
    [access === "hospital" ? "epic-alder" : "epic-birch"]: { clientId: "refresh", clientSecret: "synthetic-secret" },
  }));
  vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS", access === "hospital" ? "epic-birch" : "");
  vi.stubEnv("EPIC_SMART_HOSPITAL_APPROVED_CLIENT_ID", "approved");
  findMany.mockResolvedValue([]);
  for (const search of [POST, companionSearch]) {
    for (const query of ["Cove", "Alder"]) {
      const response = await search(new Request("https://app.example.test/search", {
        method: "POST", headers: { "X-Clinical-Directory-Version": "2" }, body: JSON.stringify({ query }),
      }));
      expect((await response.json()).providers).toMatchObject([{
        id: "epic-birch", matchedFacility: { name: "Alder Clinic" }, sharedPlaces: ["Alder"],
      }]);
    }
  }
});

it("keeps origins out of storage, logs and public responses in both transports", async () => {
  findMany.mockReset().mockResolvedValue([]);
  const log = vi.spyOn(console, "log");
  const warn = vi.spyOn(console, "warn");
  const error = vi.spyOn(console, "error");
  try {
    for (const search of [POST, companionSearch]) {
      for (const body of [{ query: "", near: { lat: 44.2, lon: -70.2 } }, { query: "04210" }]) {
        const request = new Request("https://app.example.test/search", { method: "POST",
          headers: { "X-Clinical-Directory-Version": "3" }, body: JSON.stringify(body) });
        const response = await search(request);
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const result = await response.json();
        expect(result.providers[0].matchedFacility.approximateDistanceMiles).toEqual(expect.any(Number));
        expect(JSON.stringify([request.url, result, findMany.mock.calls, log.mock.calls, warn.mock.calls, error.mock.calls]))
          .not.toMatch(/04210|44\.2|-70\.2/u);
      }
      const before = findMany.mock.calls.length;
      const bad = await search(new Request("https://app.example.test/search", { method: "POST",
        body: JSON.stringify({ query: "", near: { lat: 44.21234, lon: -70.2 } }) }));
      expect(bad.status).toBe(400);
      expect(await bad.text()).not.toContain("44.21234");
      expect(findMany).toHaveBeenCalledTimes(before);
      expect(JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain("44.21234");
    }
  } finally {
    log.mockRestore(); warn.mockRestore(); error.mockRestore();
  }
});

it("parses the ZIP table only when a search runs", async () => {
  vi.resetModules();
  const loaded = vi.fn();
  vi.doMock("@/src/lib/clinical-records/zcta-centroids.2026.json", () => {
    loaded();
    return { default: { "04210": [44.085, -70.25] } };
  });
  try {
    const store = await import("@/src/lib/clinical-records/provider-directory-store");
    expect(store.resolveClinicalProviderDirectoryEntry("epic-alder")?.id).toBe("epic-alder");
    expect(loaded).not.toHaveBeenCalled();
    const { providers } = await store.searchClinicalProviderDirectory({ query: "04210", includeDistance: true }, "member-alder");
    expect(loaded).toHaveBeenCalledOnce();
    expect(providers[0]?.matchedFacility?.approximateDistanceMiles).toBe(3);
  } finally {
    vi.doUnmock("@/src/lib/clinical-records/zcta-centroids.2026.json");
  }
});

describe("vendor capability negotiation", () => {
  const search = (headers: Record<string, string>) => POST(new Request("https://app.example.test/search", {
    method: "POST", body: JSON.stringify({ query: "Clinic" }), headers,
  })).then(response => response.json());
  const legacyHeaders: Record<string, string>[] = [{}, { "X-Clinical-Directory-Version": "2" }];
  const capable = { "X-Clinical-Directory-Version": "2", "X-Clinical-Directory-Sources": "epic-fhir,cerner-fhir" };

  it("keeps Epic-only responses for already-loaded browsers after Oracle search turns on", async () => {
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_SEARCH", "1");
    findMany.mockResolvedValue([]);
    for (const headers of legacyHeaders) {
      const body = await search(headers);
      // The shipped browser parser rejects the whole list for any other vendor.
      expect(body.providers.every((row: { sourceSystem: string }) => row.sourceSystem === "epic-fhir")).toBe(true);
      // Higher-ranked Oracle tenants cannot displace Epic rows from the twenty-result window.
      expect(body.providers).toHaveLength(Object.keys(headers).length ? 1 : 2);
    }
  });

  it("returns Oracle rows only to readers that advertise them while the flag is on", async () => {
    findMany.mockResolvedValue([]);
    const sources = async () => parseClinicalProviderSearchResponse(await search(capable)).providers.map(row => row.sourceSystem);
    expect(new Set(await sources())).toEqual(new Set(["epic-fhir"]));
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_SEARCH", "1");
    const mixed = await sources();
    expect(mixed).toHaveLength(20);
    expect(new Set(mixed)).toEqual(new Set(["cerner-fhir"]));
    expect(new Set(parseClinicalProviderSearchResponse(await search({ ...capable, "X-Clinical-Directory-Sources": "cerner-fhir, athena-fhir" }))
      .providers.map(row => row.sourceSystem))).toEqual(new Set(["cerner-fhir"]));
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_DISABLED", "1");
    expect(new Set(await sources())).toEqual(new Set(["epic-fhir"]));
  });

  it("lets the companion projection opt into every enabled vendor", async () => {
    findMany.mockResolvedValue([]);
    const companion = async () => (await (await companionSearch(new Request("https://app.example.test/search", {
      method: "POST", body: JSON.stringify({ query: "Clinic" }),
    }))).json()).providers.map((row: { id: string }) => row.id);
    expect((await companion()).every((id: string) => id.startsWith("epic-"))).toBe(true);
    vi.stubEnv("CLINICAL_RECORDS_ORACLE_SEARCH", "1");
    expect((await companion()).every((id: string) => id.startsWith("oracle-"))).toBe(true);
  });
});
