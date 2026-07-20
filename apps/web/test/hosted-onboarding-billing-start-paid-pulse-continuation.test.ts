import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildHostedStartPaidPulseContinuationClearCookie,
  buildHostedStartPaidPulseContinuationCookie,
  hasHostedStartPaidPulseContinuationRequest,
  verifyHostedStartPaidPulseContinuationToken,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-continuation";

const ORIGINAL_HMAC_KEY = process.env.HOSTED_APP_SESSION_HMAC_KEY;
const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("Start Pulse continuation claim", () => {
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

  test("issues an HttpOnly 15-minute cookie bound to the member and app session", () => {
    const cookie = buildHostedStartPaidPulseContinuationCookie({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
    });
    const token = readCookieValue(cookie);

    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=900");
    expect(verifyHostedStartPaidPulseContinuationToken({
      memberId: "member_123",
      now: new Date("2026-07-20T12:14:59.999Z"),
      sessionId: "hws_session_123",
      token,
    })).toBe(true);
    expect(verifyHostedStartPaidPulseContinuationToken({
      memberId: "member_other",
      now: NOW,
      sessionId: "hws_session_123",
      token,
    })).toBe(false);
    expect(verifyHostedStartPaidPulseContinuationToken({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_other",
      token,
    })).toBe(false);
  });

  test("rejects expired, malformed, and tampered claims", () => {
    const token = readCookieValue(buildHostedStartPaidPulseContinuationCookie({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
    }));

    expect(verifyHostedStartPaidPulseContinuationToken({
      memberId: "member_123",
      now: new Date("2026-07-20T12:15:00.000Z"),
      sessionId: "hws_session_123",
      token,
    })).toBe(false);
    expect(verifyHostedStartPaidPulseContinuationToken({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
      token: `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    })).toBe(false);
    expect(verifyHostedStartPaidPulseContinuationToken({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
      token: "not-a-token",
    })).toBe(false);
  });

  test("reads the claim only from the exact request cookie", () => {
    const cookie = buildHostedStartPaidPulseContinuationCookie({
      memberId: "member_123",
      now: NOW,
      sessionId: "hws_session_123",
    });
    const request = new Request("https://join.example.test/settings", {
      headers: {
        cookie: `other=value; ${cookie.split(";")[0]}`,
      },
    });

    expect(hasHostedStartPaidPulseContinuationRequest({
      memberId: "member_123",
      now: NOW,
      request,
      sessionId: "hws_session_123",
    })).toBe(true);
  });

  test("builds a matching clear cookie", () => {
    expect(buildHostedStartPaidPulseContinuationClearCookie()).toContain(
      "murph-start-pulse=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });
});

function readCookieValue(cookie: string): string {
  const pair = cookie.split(";", 1)[0];
  const separatorIndex = pair.indexOf("=");
  return decodeURIComponent(pair.slice(separatorIndex + 1));
}
