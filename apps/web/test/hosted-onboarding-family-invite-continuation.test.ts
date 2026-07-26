import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildHostedFamilyInviteContinuationClearCookie,
  buildHostedFamilyInviteContinuationCookie,
  readHostedFamilyInviteContinuationToken,
} from "@/src/lib/hosted-onboarding/family-invite-continuation";

const ORIGINAL_HMAC_KEY = process.env.HOSTED_APP_SESSION_HMAC_KEY;
const NOW = new Date("2026-07-26T12:00:00.000Z");
const CONTINUATION = {
  paymentUrl: "https://invoice.stripe.com/i/in_family_capacity",
  payload: {
    addSeatIfNeeded: true,
    planCode: "edge",
    targetEmail: "family.member@example.test",
    targetLabel: "Parent",
  },
} as const;

describe("Family invite payment continuation", () => {
  beforeEach(() => {
    process.env.HOSTED_APP_SESSION_HMAC_KEY =
      Buffer.alloc(32, 29).toString("base64url");
  });

  afterEach(() => {
    if (ORIGINAL_HMAC_KEY === undefined) {
      delete process.env.HOSTED_APP_SESSION_HMAC_KEY;
    } else {
      process.env.HOSTED_APP_SESSION_HMAC_KEY = ORIGINAL_HMAC_KEY;
    }
  });

  test("encrypts a 30-minute HttpOnly continuation bound to the owner session and group", () => {
    const cookie = buildHostedFamilyInviteContinuationCookie({
      continuation: CONTINUATION,
      groupId: "group_123",
      memberId: "member_123",
      now: NOW,
      sessionId: "session_123",
    });
    const token = readCookieValue(cookie);

    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=1800");
    expect(token).not.toContain("family.member");
    expect(token).not.toContain("Parent");
    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_123",
      memberId: "member_123",
      now: new Date("2026-07-26T12:29:59.999Z"),
      sessionId: "session_123",
      token,
    })).toEqual(CONTINUATION);
    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_other",
      memberId: "member_123",
      now: NOW,
      sessionId: "session_123",
      token,
    })).toBeNull();
    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_123",
      memberId: "member_other",
      now: NOW,
      sessionId: "session_123",
      token,
    })).toBeNull();
    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_123",
      memberId: "member_123",
      now: NOW,
      sessionId: "session_other",
      token,
    })).toBeNull();
  });

  test("rejects expired, malformed, and tampered continuations", () => {
    const token = readCookieValue(
      buildHostedFamilyInviteContinuationCookie({
        continuation: CONTINUATION,
        groupId: "group_123",
        memberId: "member_123",
        now: NOW,
        sessionId: "session_123",
      }),
    );

    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_123",
      memberId: "member_123",
      now: new Date("2026-07-26T12:30:00.000Z"),
      sessionId: "session_123",
      token,
    })).toBeNull();
    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_123",
      memberId: "member_123",
      now: NOW,
      sessionId: "session_123",
      token: `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    })).toBeNull();
    expect(readHostedFamilyInviteContinuationToken({
      groupId: "group_123",
      memberId: "member_123",
      now: NOW,
      sessionId: "session_123",
      token: "not-a-token",
    })).toBeNull();
  });

  test("rejects non-Stripe payment destinations before issuing a cookie", () => {
    expect(() =>
      buildHostedFamilyInviteContinuationCookie({
        continuation: {
          ...CONTINUATION,
          paymentUrl: "https://example.test/not-stripe",
        },
        groupId: "group_123",
        memberId: "member_123",
        now: NOW,
        sessionId: "session_123",
      })
    ).toThrow("Family invite continuation is invalid.");
  });

  test("builds a matching clear cookie", () => {
    expect(buildHostedFamilyInviteContinuationClearCookie()).toContain(
      "Max-Age=0",
    );
  });
});

function readCookieValue(cookie: string): string {
  const value = cookie.split(";")[0]?.split("=").slice(1).join("=");
  if (!value) {
    throw new Error("Cookie value was missing.");
  }
  return decodeURIComponent(value);
}
