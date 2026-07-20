import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildHostedPulseTrialContinuationClearCookie,
  buildHostedPulseTrialContinuationCookie,
  buildHostedPulseTrialPaymentReturnUrl,
  readHostedPulseTrialContinuationRequest,
  readHostedPulseTrialContinuationToken,
  readHostedPulseTrialPaymentReturnAction,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation";

const ORIGINAL_HMAC_KEY = process.env.HOSTED_APP_SESSION_HMAC_KEY;
const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("Pulse trial continuation claim", () => {
  beforeEach(() => {
    process.env.HOSTED_APP_SESSION_HMAC_KEY = Buffer.alloc(32, 17).toString("base64url");
  });

  afterEach(() => {
    if (ORIGINAL_HMAC_KEY === undefined) {
      delete process.env.HOSTED_APP_SESSION_HMAC_KEY;
    } else {
      process.env.HOSTED_APP_SESSION_HMAC_KEY = ORIGINAL_HMAC_KEY;
    }
  });

  test.each(["start_pulse_now", "continue_pulse"] as const)(
    "issues an HttpOnly 15-minute %s cookie bound to the member and app session",
    (action) => {
      const cookie = buildHostedPulseTrialContinuationCookie({
        action,
        memberId: "member_123",
        now: NOW,
        sessionId: "hws_session_123",
      });
      const token = readCookieValue(cookie);

      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Max-Age=900");
      expect(readHostedPulseTrialContinuationToken({
        memberId: "member_123",
        now: new Date("2026-07-20T12:14:59.999Z"),
        sessionId: "hws_session_123",
        token,
      })).toBe(action);
      expect(readHostedPulseTrialContinuationToken({
        memberId: "member_other",
        now: NOW,
        sessionId: "hws_session_123",
        token,
      })).toBeNull();
      expect(readHostedPulseTrialContinuationToken({
        memberId: "member_123",
        now: NOW,
        sessionId: "hws_session_other",
        token,
      })).toBeNull();
    },
  );

  test("rejects expired, malformed, and tampered claims", () => {
    const token = readCookieValue(buildHostedPulseTrialContinuationCookie({
      action: "continue_pulse",
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
    }));

    expect(readHostedPulseTrialContinuationToken({
      memberId: "member_123",
      now: new Date("2026-07-20T12:15:00.000Z"),
      sessionId: "hws_session_123",
      token,
    })).toBeNull();
    expect(readHostedPulseTrialContinuationToken({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
      token: `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    })).toBeNull();
    expect(readHostedPulseTrialContinuationToken({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
      token: "not-a-token",
    })).toBeNull();
  });

  test("reads the claim only from the exact request cookie", () => {
    const cookie = buildHostedPulseTrialContinuationCookie({
      action: "continue_pulse",
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
    });
    const request = new Request("https://join.example.test/settings", {
      headers: {
        cookie: `other=value; ${cookie.split(";")[0]}`,
      },
    });

    expect(readHostedPulseTrialContinuationRequest({
      memberId: "member_123",
      now: NOW,
      request,
      sessionId: "hws_session_123",
    })).toBe("continue_pulse");
  });

  test.each(["start_pulse_now", "continue_pulse"] as const)(
    "builds a short-lived member-bound %s payment return without an identifier in the URL",
    (action) => {
      const returnUrl = buildHostedPulseTrialPaymentReturnUrl({
        action,
        memberId: "member_123",
        now: NOW,
        publicBaseUrl: "https://join.example.test",
      });

      expect(returnUrl).not.toContain("member_123");
      expect(readHostedPulseTrialPaymentReturnAction({
        memberId: "member_123",
        now: new Date("2026-07-20T12:29:59.999Z"),
        request: new Request(returnUrl),
      })).toBe(action);
      expect(readHostedPulseTrialPaymentReturnAction({
        memberId: "member_other",
        now: NOW,
        request: new Request(returnUrl),
      })).toBeNull();
      expect(readHostedPulseTrialPaymentReturnAction({
        memberId: "member_123",
        now: new Date("2026-07-20T12:30:00.000Z"),
        request: new Request(returnUrl),
      })).toBeNull();
    },
  );

  test("rejects a changed action and duplicate signed return parameters", () => {
    const returnUrl = new URL(buildHostedPulseTrialPaymentReturnUrl({
      action: "continue_pulse",
      memberId: "member_123",
      now: NOW,
      publicBaseUrl: "https://join.example.test",
    }));
    returnUrl.searchParams.set("action", "start_pulse_now");
    expect(readHostedPulseTrialPaymentReturnAction({
      memberId: "member_123",
      now: NOW,
      request: new Request(returnUrl),
    })).toBeNull();

    const duplicateUrl = new URL(buildHostedPulseTrialPaymentReturnUrl({
      action: "continue_pulse",
      memberId: "member_123",
      now: NOW,
      publicBaseUrl: "https://join.example.test",
    }));
    duplicateUrl.searchParams.append("expires", duplicateUrl.searchParams.get("expires") ?? "");
    expect(readHostedPulseTrialPaymentReturnAction({
      memberId: "member_123",
      now: NOW,
      request: new Request(duplicateUrl),
    })).toBeNull();
  });

  test("builds a matching clear cookie", () => {
    expect(buildHostedPulseTrialContinuationClearCookie()).toContain(
      "murph-start-pulse=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });
});

function readCookieValue(cookie: string): string {
  const pair = cookie.split(";", 1)[0];
  const separatorIndex = pair.indexOf("=");
  return decodeURIComponent(pair.slice(separatorIndex + 1));
}
