import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";

const mocks = vi.hoisted(() => ({
  readClinicalCallbackAppReturn: vi.fn(),
  finishClinicalRecordAuthorization: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/clinical-records/control-plane", () => ({
  readClinicalCallbackAppReturn: mocks.readClinicalCallbackAppReturn,
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

  it.each(["code", "error"])("forwards only the bounded %s and state to the stored app", async field => {
    mocks.readClinicalCallbackAppReturn.mockResolvedValueOnce("ios-dev");
    const state = `crs_${"c".repeat(43)}`;
    const value = field === "error" ? "access_denied" : "+".repeat(8192);
    const params = new URLSearchParams({ state, code: "ignored-on-denial", [field]: value, detail: "unused" });
    const response = await route.GET(new Request(`https://join.example.test/callback?${params}`));
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get("location")!);
    expect(url.pathname).toBe("/api/device-sync/companion/connect-return/ios-dev");
    expect(Object.fromEntries(url.searchParams)).toEqual({ state, [field]: value });
    expect(mocks.finishClinicalRecordAuthorization).not.toHaveBeenCalled();
  });

  it("fails explicitly when an app authorization code exceeds the clinical limit", async () => {
    mocks.readClinicalCallbackAppReturn.mockResolvedValueOnce("ios");
    const response = await route.GET(new Request(`https://join.example.test/callback?state=crs_${"c".repeat(43)}&code=${"x".repeat(8193)}`));
    expect(response.status).toBe(400);
    expect(response.headers.has("location")).toBe(false);
    expect(mocks.finishClinicalRecordAuthorization).not.toHaveBeenCalled();
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
