import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  searchClinicalProviderDirectory: vi.fn(),
}));

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
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_clinical_1" },
    });
    mocks.searchClinicalProviderDirectory.mockReturnValue({
      directoryVersion: "test-v1",
      providers: [],
    });
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
    });
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
