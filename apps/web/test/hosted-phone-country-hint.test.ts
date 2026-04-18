import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

describe("hosted phone country hint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers());
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

  it("reads the hosted phone country code directly from the Vercel country header", async () => {
    const { readHostedPhoneCountryCodeFromHeaders } = await import(
      "@/src/lib/hosted-onboarding/phone-country-hint"
    );

    expect(
      readHostedPhoneCountryCodeFromHeaders(
        new Headers({ "x-vercel-ip-country": "gb" }),
      ),
    ).toBe("GB");
    expect(
      readHostedPhoneCountryCodeFromHeaders(
        new Headers({ "x-vercel-ip-country": "usa" }),
      ),
    ).toBeNull();
  });

  it("reads the server-side country hint from the current request headers", async () => {
    const { readHostedPhoneCountryCodeHint } = await import(
      "@/src/lib/hosted-onboarding/phone-country-hint-server"
    );

    mocks.headers.mockResolvedValue(
      new Headers({
        "x-vercel-ip-country": "ca",
      }),
    );

    await expect(readHostedPhoneCountryCodeHint()).resolves.toBe("CA");
  });

  it("returns null when the Vercel country header is absent", async () => {
    const { readHostedPhoneCountryCodeHint } = await import(
      "@/src/lib/hosted-onboarding/phone-country-hint-server"
    );

    await expect(readHostedPhoneCountryCodeHint()).resolves.toBeNull();
  });
});
