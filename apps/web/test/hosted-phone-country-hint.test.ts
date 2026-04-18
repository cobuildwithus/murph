import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));

describe("hosted phone country hint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers());
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });
  });

  it("normalizes and validates two-letter phone country codes", async () => {
    const { normalizeHostedPhoneCountryCode } = await import(
      "@/src/lib/hosted-onboarding/phone-country-hint"
    );

    expect(normalizeHostedPhoneCountryCode(" gb ")).toBe("GB");
    expect(normalizeHostedPhoneCountryCode("usa")).toBeNull();
    expect(normalizeHostedPhoneCountryCode("1")).toBeNull();
    expect(normalizeHostedPhoneCountryCode(null)).toBeNull();
  });

  it("parses the Vercel geo header snapshot", async () => {
    const {
      resolveHostedPhoneCountryCodeFromVercelHeaders,
      resolveHostedVercelGeoSnapshot,
    } = await import("@/src/lib/hosted-onboarding/phone-country-hint");

    const snapshot = resolveHostedVercelGeoSnapshot(
      new Headers({
        "x-vercel-ip-city": "Kuala%20Lumpur",
        "x-vercel-ip-country": "my",
        "x-vercel-ip-country-region": "14",
      }),
    );

    expect(snapshot).toEqual({
      city: "Kuala Lumpur",
      countryCode: "MY",
      countryRegion: "14",
    });
    expect(
      resolveHostedPhoneCountryCodeFromVercelHeaders(
        new Headers({ "x-vercel-ip-country": "gb" }),
      ),
    ).toBe("GB");
  });

  it("falls back to the persisted cookie hint when the forwarded header is absent", async () => {
    const { readHostedPhoneCountryCodeHint } = await import(
      "@/src/lib/hosted-onboarding/phone-country-hint-server"
    );

    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "ca" }),
    });

    await expect(readHostedPhoneCountryCodeHint()).resolves.toBe("CA");
  });

  it("prefers the forwarded same-request header over the cookie hint", async () => {
    const { readHostedPhoneCountryCodeHint } = await import(
      "@/src/lib/hosted-onboarding/phone-country-hint-server"
    );

    mocks.headers.mockResolvedValue(
      new Headers({
        "x-murph-phone-country-hint": "GB",
      }),
    );
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "us" }),
    });

    await expect(readHostedPhoneCountryCodeHint()).resolves.toBe("GB");
  });
});
