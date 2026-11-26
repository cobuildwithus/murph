import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import squareLogos from "@/src/lib/clinical-records/provider-logos-square.json";
import wideLogos from "@/src/lib/clinical-records/provider-logos.json";

const mocks = vi.hoisted(() => ({
  bearer: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  searchClinicalProviderDirectory: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: mocks.bearer }));
vi.mock("@/src/lib/clinical-records/provider-directory-store", () => ({
  searchClinicalProviderDirectory: mocks.searchClinicalProviderDirectory,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

type ProviderSearchRoute =
  typeof import("../app/api/clinical-records/providers/search/route");

let route: ProviderSearchRoute;

describe("Clinical Records provider search route", () => {
  beforeAll(async () => {
    route = await import("../app/api/clinical-records/providers/search/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bearer.mockResolvedValue({ member: { id: "member_clinical_1" } });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_clinical_1" },
    });
    mocks.searchClinicalProviderDirectory.mockReturnValue({
      directoryVersion: "test-v1",
      providers: [],
    });
  });

  it("searches the native directory with a body-only query and a public result projection", async () => {
    const { POST } = await import("../app/api/clinical-records/companion/providers/search/route");
    const query = "Synthetic Ridge";
    const request = new Request("https://app.example.test/api/clinical-records/companion/providers/search?query=ignored", {
      method: "POST", body: JSON.stringify({ query }), headers: { "content-type": "application/json" },
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.searchClinicalProviderDirectory.mockReturnValue({ providers: [{
      id: "epic-example", brandName: "Synthetic Ridge", facilities: [{ city: "Sample City", state: "ZZ" }],
    }] });
    expect(await (await POST(request)).json()).toEqual({ providers: [{ id: "epic-example", name: query, place: "Sample City, ZZ" }] });
    expect(mocks.bearer).toHaveBeenCalledWith(request);
    expect(mocks.assertHostedOnboardingMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.searchClinicalProviderDirectory).toHaveBeenCalledExactlyOnceWith({ query }, "member_clinical_1");
    const urlOnly = new Request(request.url, { method: "POST", body: "{}" });
    expect((await POST(urlOnly)).status).toBe(400);
    expect(mocks.searchClinicalProviderDirectory).toHaveBeenCalledOnce();
    expect(JSON.stringify([...warning.mock.calls, ...error.mock.calls])).not.toContain(query);
  });

  it("gives the app a square logo when the provider has one and the wide logo otherwise", async () => {
    const { POST } = await import("../app/api/clinical-records/companion/providers/search/route");
    const square = "epic-1001", wideOnly = "epic-1002", unknown = "epic-example";
    expect(wideLogos).toHaveProperty(square);
    expect(squareLogos).not.toHaveProperty(wideOnly);
    mocks.searchClinicalProviderDirectory.mockReturnValue({
      providers: [square, wideOnly, unknown].map(id => ({ id, brandName: "Synthetic Ridge", facilities: [] })),
    });
    const response = await POST(new Request("https://app.example.test/api/clinical-records/companion/providers/search", {
      method: "POST", body: JSON.stringify({ query: "Synthetic" }), headers: { "content-type": "application/json" },
    }));
    const { providers } = await response.json() as { providers: { logoPath?: string }[] };
    expect(providers.map(provider => provider.logoPath)).toEqual([squareLogos[square], wideLogos[wideOnly], undefined]);
    expect(squareLogos[square]).not.toBe(wideLogos[square]);
  });

  it("accepts only the bounded provider search selectors", async () => {
    const request = jsonRequest({
      city: "Atlanta",
      query: "Piedmont",
      state: "GA",
    });
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.searchClinicalProviderDirectory).toHaveBeenCalledWith({
      city: "Atlanta",
      query: "Piedmont",
      state: "GA",
    }, undefined);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
  });

  it("rejects a bearer or any other extra field without forwarding or logging it", async () => {
    const claim = `cr_${"s".repeat(32)}`;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await route.POST(jsonRequest({ claim, query: "Piedmont" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CLINICAL_RECORD_PROVIDER_SEARCH_INVALID" },
    });
    expect(mocks.searchClinicalProviderDirectory).not.toHaveBeenCalled();
    expect(JSON.stringify([...warning.mock.calls, ...error.mock.calls])).not.toContain(claim);
  });
});

describe("Clinical Records square provider logos", () => {
  it("maps directory providers to 144-pixel PNG files the app is allowed to load", () => {
    const entries = Object.entries(squareLogos);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, logoPath] of entries) {
      // Removed search brands can still have saved connections using their logo.
      expect(id).toMatch(/^epic-[a-z0-9-]+$/u);
      // The same pattern the app checks before it loads a logo.
      expect(logoPath).toMatch(/^\/clinical-provider-logos\/[0-9a-f]{24}\.png$/u);
      const file = path.join(process.cwd(), "apps/web/public", logoPath);
      expect(existsSync(file), `${logoPath} should exist under apps/web/public`).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 8).toString("hex"), `${logoPath} should be a PNG`).toBe("89504e470d0a1a0a");
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], `${logoPath} should be 144 pixels square`).toEqual([144, 144]);
    }
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request(
    "https://join.example.test/api/clinical-records/providers/search",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    },
  );
}
