import { describe, expect, it } from "vitest";

import {
  buildHostedSignupNotificationContext,
  encodeHostedSignupNotificationContext,
  formatHostedSignupLocation,
  formatHostedSignupSurface,
  parseHostedSignupNotificationContext,
} from "@/src/lib/hosted-onboarding/signup-notification-context";

describe("hosted signup notification context", () => {
  it("captures bounded Vercel location context and the validated local time zone", () => {
    const context = buildHostedSignupNotificationContext({
      headers: new Headers({
        "x-vercel-ip-city": "S%C3%A3o%20Paulo",
        "x-vercel-ip-country": "br",
        "x-vercel-ip-country-region": "sp",
      }),
      occurredAt: new Date("2026-08-21T00:07:00.000Z"),
      surface: "website",
      timeZone: "America/Sao_Paulo",
    });

    expect(context).toEqual({
      schema: "murph.hosted-signup-notification-context.v1",
      occurredAt: "2026-08-21T00:07:00.000Z",
      surface: "website",
      timeZone: "America/Sao_Paulo",
      location: {
        city: "São Paulo",
        country: "BR",
        countryRegion: "SP",
      },
    });
    expect(parseHostedSignupNotificationContext(
      encodeHostedSignupNotificationContext(context),
    )).toEqual(context);
  });

  it("drops malformed advisory headers instead of retaining them", () => {
    const context = buildHostedSignupNotificationContext({
      headers: new Headers({
        "x-vercel-ip-city": "%E0%A4%A",
        "x-vercel-ip-country": "United States",
        "x-vercel-ip-country-region": "too-long",
      }),
      occurredAt: new Date("2026-08-21T00:07:00.000Z"),
      surface: "mobile_app",
      timeZone: "not/a-time-zone",
    });

    expect(context).toEqual({
      schema: "murph.hosted-signup-notification-context.v1",
      occurredAt: "2026-08-21T00:07:00.000Z",
      surface: "mobile_app",
    });
  });

  it("decodes a percent sign exactly once", () => {
    const context = buildHostedSignupNotificationContext({
      headers: new Headers({
        "x-vercel-ip-city": "100%25%20Mile%20House",
      }),
      occurredAt: new Date("2026-08-21T00:07:00.000Z"),
      surface: "website",
    });

    expect(parseHostedSignupNotificationContext(
      encodeHostedSignupNotificationContext(context),
    ).location?.city).toBe("100% Mile House");
  });

  it("rejects unversioned, expanded, or malformed persisted shapes", () => {
    expect(() => parseHostedSignupNotificationContext({
      schema: "murph.hosted-signup-notification-context.v1",
      occurredAt: "2026-08-21T00:07:00.000Z",
      surface: "website",
      ipAddress: "192.0.2.1",
    })).toThrow("Hosted signup notification context is invalid.");
    expect(() => parseHostedSignupNotificationContext({
      schema: "murph.hosted-signup-notification-context.v1",
      occurredAt: "yesterday",
      surface: "website",
    })).toThrow("Hosted signup notification timestamp is invalid.");
    expect(() => parseHostedSignupNotificationContext({
      schema: "murph.hosted-signup-notification-context.v1",
      occurredAt: "2026-08-21T00:07:00.000Z",
      surface: "desktop_app",
    })).toThrow("Hosted signup notification surface is invalid.");
  });

  it("formats the closed surface and location vocabulary", () => {
    expect(formatHostedSignupSurface("imessage")).toBe("iMessage");
    expect(formatHostedSignupSurface("mobile_app")).toBe("Mobile app");
    expect(formatHostedSignupLocation({
      city: "Atlanta",
      country: "US",
      countryRegion: "GA",
    })).toBe("Atlanta, GA, US");
    expect(formatHostedSignupLocation(undefined)).toBeNull();
  });
});
