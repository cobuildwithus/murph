import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

import { POST } from "../app/api/clinical-records/providers/search/route";
import { parseClinicalProviderSearchResponse } from "@/src/lib/clinical-records/client-contracts";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ clinicalRecordConnection: { findMany } }) }));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({ assertHostedOnboardingMutationOrigin: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: async () => ({ member: { id: "member-alder" } }),
}));
vi.mock("@/src/lib/clinical-records/provider-directory.v2.json", async () => {
  const { EPIC_ACQUISITION_POLICY, EPIC_ACQUISITION_POLICY_ID } = await import("@/src/lib/clinical-records/epic-policy");
  return { default: {
    schema: "murph.clinical-provider-directory.v2", version: "sample", sourceBundleSha256: "0".repeat(64),
    generatedAt: "2026-07-10T00:00:00.000Z", policies: [EPIC_ACQUISITION_POLICY],
    entries: ["Alder", "Birch"].map(brandName => ({
      aliases: [], brandName, id: "epic-" + brandName.toLowerCase(), policyId: EPIC_ACQUISITION_POLICY_ID,
      clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID", fhirBaseUrl: "https://portal.example.test/r4",
      locations: [[brandName + " Clinic", "Cove", "ME", null, ["12 Pine Road"], [], "urn:sample:" + brandName]],
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
