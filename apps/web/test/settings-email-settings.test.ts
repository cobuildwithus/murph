import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshUser: vi.fn(),
  sendCode: vi.fn(),
  usePrivy: vi.fn(),
  useUpdateEmail: vi.fn(),
  useUser: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
  useUpdateEmail: mocks.useUpdateEmail,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider(input: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, input.children);
  },
}));

vi.mock("@radix-ui/react-dialog", () => ({
  Close(input: { asChild?: boolean; children: React.ReactNode }) {
    return input.asChild ? input.children : React.createElement("div", null, input.children);
  },
  Content(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("div", input, input.children);
  },
  Description(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("p", input, input.children);
  },
  Overlay(input: Record<string, unknown>) {
    return React.createElement("div", input);
  },
  Portal(input: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, input.children);
  },
  Root(input: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, input.children);
  },
  Title(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("h2", input, input.children);
  },
}));

describe("HostedEmailSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      logout: vi.fn(),
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        id: "did:privy:user_123",
        linkedAccounts: [
          {
            address: "stale@example.com",
            type: "email",
          },
          {
            address: "verified@example.com",
            latest_verified_at: 1741194420,
            type: "email",
          },
        ],
      },
    });
    mocks.useUpdateEmail.mockReturnValue({
      sendCode: mocks.sendCode,
      state: {
        status: "idle",
      },
      verifyCode: mocks.verifyCode,
    });
  });

  it("shows the best verified email account as the current email and offers a direct resync action", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const markup = renderToStaticMarkup(
      React.createElement(HostedEmailSettings, {
        expectedPrivyUserId: "did:privy:user_123",
        privyAppId: "cm_app_123",
      }),
    );

    assert.match(markup, /Current verified email/);
    assert.match(markup, /verified@example\.com/);
    assert.doesNotMatch(markup, /Current email<\/strong><p class="mt-1">stale@example\.com/);
    assert.match(markup, /Sync current verified email/);
  });
});

describe("hosted email settings sync helpers", () => {
  it("keeps the verified email visible after a sync failure and supports a direct resync without another OTP flow", async () => {
    const { syncHostedVerifiedEmailAddress } = await import(
      "@/src/components/settings/hosted-email-settings-helpers"
    );
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "HOSTED_SYNC_UNAVAILABLE",
          message: "Hosted sync unavailable right now.",
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 503,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        emailAddress: "verified@example.com",
        ok: true,
        runTriggered: true,
        verifiedAt: "2026-03-28T12:00:00.000Z",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));

    const firstAttempt = await syncHostedVerifiedEmailAddress({
      fetchImpl,
      mode: "verify",
      verifiedEmailAddress: "verified@example.com",
    });
    const secondAttempt = await syncHostedVerifiedEmailAddress({
      fetchImpl,
      mode: "resync",
      verifiedEmailAddress: "verified@example.com",
    });

    expect(firstAttempt).toEqual({
      errorMessage: "Hosted sync unavailable right now.",
      successMessage: "Email verified: verified@example.com",
      syncResult: null,
    });
    expect(secondAttempt).toEqual({
      errorMessage: null,
      successMessage: "Hosted email synced: verified@example.com",
      syncResult: {
        emailAddress: "verified@example.com",
        runTriggered: true,
        verifiedAt: "2026-03-28T12:00:00.000Z",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      expectedEmailAddress: "verified@example.com",
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      expectedEmailAddress: "verified@example.com",
    });
  });
});
