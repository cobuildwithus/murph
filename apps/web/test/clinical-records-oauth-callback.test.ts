import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";

const mocks = vi.hoisted(() => ({
  finishClinicalRecordAuthorization: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/clinical-records/control-plane", () => ({
  finishClinicalRecordAuthorization: mocks.finishClinicalRecordAuthorization,
}));
vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

type CallbackRoute = typeof import("../app/api/clinical-records/oauth/callback/route");
let route: CallbackRoute;

describe("Clinical Records OAuth callback", () => {
  beforeAll(async () => {
    route = await import("../app/api/clinical-records/oauth/callback/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://join.example.test");
  });

  it("redirects a provider denial with only secret-safe diagnostic fields", async () => {
    mocks.finishClinicalRecordAuthorization.mockRejectedValue(clinicalRecordsError({
      code: "CLINICAL_RECORD_AUTHORIZATION_DECLINED",
      httpStatus: 400,
      message: "Provider declined authorization.",
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await route.GET(new Request(
      "https://join.example.test/api/clinical-records/oauth/callback?state=secret-state&code=secret-code&error=access_denied",
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://join.example.test/records?clinicalRecords=declined",
    );
    expect(warning).toHaveBeenCalledWith("Clinical Records OAuth callback failed.", {
      code: "CLINICAL_RECORD_AUTHORIZATION_DECLINED",
      errorType: "clinical-records",
      providerDenied: true,
      providerError: true,
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-state");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-code");
  });

  it("maps an unknown callback failure to a generic marker and diagnostic", async () => {
    mocks.finishClinicalRecordAuthorization.mockRejectedValue(new Error("sensitive provider body"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await route.GET(new Request(
      "https://join.example.test/api/clinical-records/oauth/callback?state=secret-state&code=secret-code",
    ));

    expect(response.headers.get("location")).toBe(
      "https://join.example.test/records?clinicalRecords=failed",
    );
    expect(warning).toHaveBeenCalledWith("Clinical Records OAuth callback failed.", {
      code: "UNEXPECTED",
      errorType: "unexpected",
      providerDenied: false,
      providerError: false,
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive provider body");
  });

  it("does not describe a provider outage as a patient denial", async () => {
    mocks.finishClinicalRecordAuthorization.mockRejectedValue(new Error("provider unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await route.GET(new Request(
      "https://join.example.test/api/clinical-records/oauth/callback?state=safe-state&error=temporarily_unavailable",
    ));

    expect(mocks.finishClinicalRecordAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      providerDenied: false,
      providerError: true,
    }));
    expect(response.headers.get("location")).toBe(
      "https://join.example.test/records?clinicalRecords=failed",
    );
  });
});
