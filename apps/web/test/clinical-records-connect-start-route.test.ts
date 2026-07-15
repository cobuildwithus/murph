import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  startClinicalRecordConnection: vi.fn(),
}));

vi.mock("@/src/lib/clinical-records/control-plane", () => ({
  startClinicalRecordConnection: mocks.startClinicalRecordConnection,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

type ConnectStartRoute =
  typeof import("../app/api/clinical-records/connect-intents/start/route");

let route: ConnectStartRoute;

describe("Clinical Records connect start route", () => {
  beforeAll(async () => {
    route = await import("../app/api/clinical-records/connect-intents/start/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startClinicalRecordConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth2/authorize",
      expiresAt: "2026-07-10T12:15:00.000Z",
    });
  });

  it("passes the bearer from a bounded JSON body while keeping the request URL fixed", async () => {
    const claim = `cr_${"a".repeat(32)}`;
    const request = jsonRequest({ claim, providerDirectoryEntryId: "epic-example" });
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(request.url).toBe(
      "https://join.example.test/api/clinical-records/connect-intents/start",
    );
    expect(request.url).not.toContain(claim);
    expect(mocks.startClinicalRecordConnection).toHaveBeenCalledWith({
      claim,
      providerDirectoryEntryId: "epic-example",
      request,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
  });

  it("rejects extra fields without echoing or logging the bearer", async () => {
    const claim = `cr_${"s".repeat(32)}`;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await route.POST(jsonRequest({
      claim,
      providerDirectoryEntryId: "epic-example",
      returnTo: "/records",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CLINICAL_RECORD_CONNECT_START_REQUEST_INVALID" },
    });
    expect(mocks.startClinicalRecordConnection).not.toHaveBeenCalled();
    expect(JSON.stringify([...warning.mock.calls, ...error.mock.calls])).not.toContain(claim);
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request(
    "https://join.example.test/api/clinical-records/connect-intents/start",
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
