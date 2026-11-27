import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

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
  return { default: {
    schema: "murph.clinical-provider-directory.v2", version: "sample", sourceBundleSha256: "0".repeat(64),
    generatedAt: "2026-07-10T00:00:00.000Z", policies: [EPIC_ACQUISITION_POLICY],
    entries: ["Alder", "Birch"].map(brandName => ({
      aliases: [], brandName, id: "epic-" + brandName.toLowerCase(), policyId: EPIC_ACQUISITION_POLICY_ID,
      clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID", fhirBaseUrl: "https://portal.example.test/r4",
      locations: [[brandName + " Clinic", "Cove", "ME", null, ["12 Pine Road"], [], [44.1, -70.2]]],
    })),
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
