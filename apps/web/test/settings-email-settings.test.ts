import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendCode: vi.fn(),
  useUpdateEmail: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUpdateEmail: mocks.useUpdateEmail,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog(input: { children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
    return React.createElement("div", {
      "data-dialog-open": String(input.open ?? false),
    }, input.children);
  },
  DialogContent(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("div", {
      ...input,
      "data-show-close-button": String(input.showCloseButton ?? true),
    }, input.children);
  },
  DialogDescription(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("p", input, input.children);
  },
  DialogHeader(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("div", input, input.children);
  },
  DialogTitle(input: Record<string, unknown> & { children?: React.ReactNode }) {
    return React.createElement("h2", input, input.children);
  },
}));

describe("HostedEmailSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        authenticated: true,
        initialLinkedAccounts: [
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
      }),
    );

    assert.match(markup, /Connected as verified@example\.com\./);
    assert.match(markup, /verified@example\.com/);
    assert.match(markup, /id="settings-email-address"[^>]*value="verified@example\.com"/);
    assert.doesNotMatch(markup, /Connected as stale@example\.com\./);
    assert.match(markup, /Save verified email/);
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
