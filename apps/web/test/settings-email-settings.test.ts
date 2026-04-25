import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  sendCode: vi.fn(),
  useUpdateEmail: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useUpdateEmail: mocks.useUpdateEmail,
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog(input: { children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
    return createElement("div", {
      "data-dialog-open": String(input.open ?? false),
    }, input.children);
  },
  DialogContent(input: Record<string, unknown> & { children?: ReactNode }) {
    return createElement("div", {
      ...input,
      "data-show-close-button": String(input.showCloseButton ?? true),
    }, input.children);
  },
  DialogDescription(input: Record<string, unknown> & { children?: ReactNode }) {
    return createElement("p", input, input.children);
  },
  DialogHeader(input: Record<string, unknown> & { children?: ReactNode }) {
    return createElement("div", input, input.children);
  },
  DialogTitle(input: Record<string, unknown> & { children?: ReactNode }) {
    return createElement("h2", input, input.children);
  },
}));

let cleanupRender: (() => Promise<void>) | null = null;

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

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("shows the best verified email account as the current email and offers a direct resync action", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedEmailSettings, {
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

  it("sends and verifies update-email codes from the live settings inputs", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const syncFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      emailAddress: "member@example.com",
      ok: true,
      runTriggered: true,
      verifiedAt: "2026-04-25T00:00:00.000Z",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", syncFetch);

    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialLinkedAccounts: [],
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send code"),
    );
    expect(emailInput).toBeTruthy();
    expect(sendButton).toBeTruthy();

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, " member@example.com ");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.sendCode).toHaveBeenCalledWith({
      newEmailAddress: "member@example.com",
    });
    expect(container.textContent).toContain("We sent a verification code to");

    const codeInput = container.querySelector(
      'input[id="settings-email-code"]',
    ) as HTMLInputElement | null;
    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Verify email"),
    );
    expect(codeInput).toBeTruthy();
    expect(verifyButton).toBeTruthy();

    await act(async () => {
      if (codeInput) {
        setInputValue(window, codeInput, "123456");
      }
      verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.verifyCode).toHaveBeenCalledWith({
      code: "123456",
    });
    expect(syncFetch).toHaveBeenCalledWith(
      "/api/settings/email/sync",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("does not resend to a stale pending email after the visible email input is cleared", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialLinkedAccounts: [],
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send code"),
    );
    expect(emailInput).toBeTruthy();
    expect(sendButton).toBeTruthy();

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const resendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Resend code"),
    );
    expect(resendButton).toBeTruthy();

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, " ");
      }
      resendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.sendCode).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Enter a valid email address before we send a code.");
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

function setInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const prototype = window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
