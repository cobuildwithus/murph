import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LinkAccountCallbacks = {
  onError?: () => void;
  onSuccess?: (params: {
    linkedAccount: unknown;
    linkMethod: string;
    user: { linkedAccounts?: unknown };
  }) => void;
};

type UpdateEmailCallbacks = {
  onError?: () => void;
};

const mocks = vi.hoisted(() => ({
  linkAccountCallbacks: null as LinkAccountCallbacks | null,
  linkEmail: vi.fn(),
  refreshUser: vi.fn(),
  sendCode: vi.fn(),
  updateEmailCallbacks: null as UpdateEmailCallbacks | null,
  useLinkAccount: vi.fn(),
  useUpdateEmail: vi.fn(),
  useUser: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLinkAccount: mocks.useLinkAccount,
  useUpdateEmail: mocks.useUpdateEmail,
  useUser: mocks.useUser,
}));

let cleanupRender: (() => Promise<void>) | null = null;

describe("HostedEmailSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkAccountCallbacks = null;
    mocks.updateEmailCallbacks = null;
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [],
    });
    mocks.useLinkAccount.mockImplementation((callbacks: LinkAccountCallbacks) => {
      mocks.linkAccountCallbacks = callbacks;

      return {
        linkEmail: mocks.linkEmail,
      };
    });
    mocks.useUpdateEmail.mockImplementation((callbacks: UpdateEmailCallbacks) => {
      mocks.updateEmailCallbacks = callbacks;

      return {
        sendCode: mocks.sendCode,
        state: {
          status: "idle",
        },
        verifyCode: mocks.verifyCode,
      };
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
    mocks.verifyCode.mockResolvedValue({
      user: {
        linkedAccounts: [
          {
            address: "member@example.com",
            latest_verified_at: 1771977600,
            type: "email",
          },
        ],
      },
    });
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
      // input-otp schedules uncleared 0-50ms selection-sync timers that call
      // setState; drain them while the linkedom globals are still stubbed so
      // they cannot fire into a torn-down environment.
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });

  it("shows the server-provided verified email as the current email and offers a direct resync action", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "verified@example.com",
          verifiedAt: 1741194420,
        },
      }),
    );

    assert.match(markup, /verified@example\.com/);
    assert.match(markup, /id="settings-email-address"[^>]*value="verified@example\.com"/);
    assert.doesNotMatch(markup, /stale@example\.com/);
    assert.match(markup, /Save verified email/);
    assert.doesNotMatch(markup, /murph@mail\.withmurph\.ai/);
  });

  it("shows the server-provided private Murph email alias when one is ready", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "verified@example.com",
          verifiedAt: 1741194420,
        },
        murphEmailAddress: "murph+u2-private-alias@mail.example.test",
      }),
    );

    assert.match(markup, /href="mailto:murph\+u2-private-alias@mail\.example\.test"/);
    assert.match(markup, /Email murph\+u2-private-alias@mail\.example\.test/);
  });

  it("does not use Privy client user state as the displayed email authority", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            address: "privy@example.com",
            latest_verified_at: 1771977600,
            type: "email",
          },
        ],
      },
    });
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "server@example.com",
          verifiedAt: 1741194420,
        },
      }),
    );

    assert.match(markup, /server@example\.com/);
    assert.doesNotMatch(markup, /privy@example\.com/);
  });

  it("uses Privy's email link flow when the hosted account has no email yet", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link email"),
    );
    expect(linkButton).toBeTruthy();
    const contactLink = container.querySelector('a[href="mailto:murph@mail.withmurph.ai"]');
    expect(contactLink).toBeNull();
    expect(container.querySelector('input[id="settings-email-address"]')).toBeNull();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.linkEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendCode).not.toHaveBeenCalled();
    expect(container.querySelector("input[data-input-otp]")).toBeNull();
    expect(container.textContent).not.toContain("We sent a code to");
  });

  it("prefills an unverified server-provided email and lets the member send a verification code", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "payer@example.com",
          verifiedAt: null,
        },
      }),
    );
    cleanupRender = cleanup;

    const input = container.querySelector<HTMLInputElement>('input[id="settings-email-address"]');
    expect(input?.value).toBe("payer@example.com");
    expect(container.textContent).toContain("Unverified");

    const sendCodeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );
    expect(sendCodeButton).toBeTruthy();

    await act(async () => {
      sendCodeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.sendCode).toHaveBeenCalledWith({
      newEmailAddress: "payer@example.com",
    });
    expect(mocks.linkEmail).not.toHaveBeenCalled();
  });

  it("syncs the verified email returned by Privy's link flow", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const onSynced = vi.fn();
    const linkedUser = {
      linkedAccounts: [
        {
          address: "linked@example.com",
          latest_verified_at: 1771977600,
          type: "email",
        },
      ],
    };
    mocks.refreshUser.mockResolvedValueOnce(linkedUser);
    const syncFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      emailAddress: "linked@example.com",
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

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: null,
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          address: "linked@example.com",
          latest_verified_at: 1771977600,
          type: "email",
        },
        linkMethod: "email",
        user: linkedUser,
      });
    });

    await vi.waitFor(() => {
      expect(syncFetch).toHaveBeenCalledWith(
        "/api/settings/email/sync",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    expect(container.textContent).toContain("Email verified");
    expect(onSynced).toHaveBeenCalledWith({
      emailAddress: "linked@example.com",
      runTriggered: true,
      verifiedAt: "2026-04-25T00:00:00.000Z",
    });
  });

  it("prefers Privy's email link payload over a stale refreshed email", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const linkedUser = {
      linkedAccounts: [
        {
          address: "linked@example.com",
          latest_verified_at: 1771977600,
          type: "email",
        },
      ],
    };
    mocks.refreshUser.mockResolvedValueOnce({
      linkedAccounts: [
        {
          address: "old@example.com",
          latest_verified_at: 1771891200,
          type: "email",
        },
      ],
    });
    const syncFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      emailAddress: "linked@example.com",
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

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link email"),
    );

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          address: "linked@example.com",
          latest_verified_at: 1771977600,
          type: "email",
        },
        linkMethod: "email",
        user: linkedUser,
      });
    });

    await vi.waitFor(() => {
      expect(syncFetch).toHaveBeenCalledWith(
        "/api/settings/email/sync",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    expect(JSON.parse(String(syncFetch.mock.calls[0]?.[1]?.body))).toEqual({
      expectedEmailAddress: "linked@example.com",
    });
  });

  it("sends an update-email code and verifies it from the inline code step", async () => {
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
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );
    expect(emailInput).toBeTruthy();
    expect(sendButton).toBeTruthy();

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, " member@example.com ");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.linkEmail).not.toHaveBeenCalled();
    expect(mocks.sendCode).toHaveBeenCalledWith({
      newEmailAddress: "member@example.com",
    });
    expect(container.textContent).toContain("We sent a code to");
    expect(container.querySelector('input[id="settings-email-address"]')).toBeNull();

    // The linkedom harness cannot drive React's synthetic onChange, so the
    // InputOTP auto-submit (onComplete) path cannot fire here; the verify
    // button exercises the same onSubmit callback, reading the code ref.
    const codeInput = container.querySelector(
      "input[data-input-otp]",
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

    expect(mocks.verifyCode).toHaveBeenCalledTimes(1);
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

  it("does not open the verification prompt when Privy reports an update-email send error", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    mocks.sendCode.mockImplementationOnce(async () => {
      mocks.updateEmailCallbacks?.onError?.();
    });

    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("We could not send a verification code to that email address.");
    expect(container.textContent).not.toContain("We sent a code to");
    expect(container.querySelector("input[data-input-otp]")).toBeNull();
  });

  it("does not sync the hosted email route when Privy reports an update-email verify error", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    mocks.verifyCode.mockImplementationOnce(async () => {
      mocks.updateEmailCallbacks?.onError?.();
      return undefined;
    });
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
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const codeInput = container.querySelector(
      "input[data-input-otp]",
    ) as HTMLInputElement | null;
    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Verify email"),
    );
    expect(codeInput).toBeTruthy();

    await act(async () => {
      if (codeInput) {
        setInputValue(window, codeInput, "123456");
      }
      verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.verifyCode).toHaveBeenCalledTimes(1);
    expect(syncFetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("We could not verify that code.");
  });

  it("rejects an empty code without calling Privy and trims whitespace from the inline code input", async () => {
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
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const codeInput = container.querySelector(
      "input[data-input-otp]",
    ) as HTMLInputElement | null;
    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Verify email"),
    );
    expect(codeInput).toBeTruthy();
    expect(verifyButton).toBeTruthy();

    await act(async () => {
      verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.verifyCode).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter the verification code we emailed you.");
    expect(container.querySelector("input[data-input-otp]")).toBeTruthy();

    await act(async () => {
      if (codeInput) {
        setInputValue(window, codeInput, "  123456  ");
      }
      verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.verifyCode).toHaveBeenCalledTimes(1);
    expect(mocks.verifyCode).toHaveBeenCalledWith({
      code: "123456",
    });
  });

  it("disables the inline code step actions and shows the verifying label while the code is submitting", async () => {
    let updateEmailStatus: "idle" | "submitting-code" = "idle";
    mocks.useUpdateEmail.mockImplementation((callbacks: UpdateEmailCallbacks) => {
      mocks.updateEmailCallbacks = callbacks;

      return {
        sendCode: mocks.sendCode,
        state: {
          status: updateEmailStatus,
        },
        verifyCode: mocks.verifyCode,
      };
    });
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Verify email"),
    );
    expect(verifyButton).toBeTruthy();
    expect(verifyButton?.hasAttribute("disabled")).toBe(false);

    // Flip the mocked Privy hook into the submitting state, then trigger a
    // re-render through the empty-code validation path (the harness cannot
    // drive React onChange, so a state-setting click is the re-render seam).
    updateEmailStatus = "submitting-code";

    await act(async () => {
      verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Verifying...");
    expect(container.textContent).not.toContain("Verify email");
    const pendingVerifyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Verifying..."),
    );
    const resendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Resend code"),
    );
    const useAnotherEmailButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Use another email"),
    );
    expect(pendingVerifyButton?.hasAttribute("disabled")).toBe(true);
    expect(resendButton?.hasAttribute("disabled")).toBe(true);
    expect(useAnotherEmailButton?.hasAttribute("disabled")).toBe(true);
    expect(
      (container.querySelector("input[data-input-otp]") as HTMLInputElement | null)
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("resends the code to the pending email from the code step", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
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
      resendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.sendCode).toHaveBeenCalledTimes(2);
    expect(mocks.sendCode).toHaveBeenLastCalledWith({
      newEmailAddress: "member@example.com",
    });
    expect(container.querySelector("input[data-input-otp]")).toBeTruthy();
    expect(container.textContent).toContain("We sent a code to member@example.com");
  });

  it("returns to email entry when the member chooses to use another email", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector(
      'input[id="settings-email-address"]',
    ) as HTMLInputElement | null;
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.querySelector("input[data-input-otp]")).toBeTruthy();

    const useAnotherEmailButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Use another email"),
    );
    expect(useAnotherEmailButton).toBeTruthy();

    await act(async () => {
      useAnotherEmailButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.querySelector("input[data-input-otp]")).toBeNull();
    expect(container.querySelector('input[id="settings-email-address"]')).toBeTruthy();
    expect(mocks.sendCode).toHaveBeenCalledTimes(1);
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
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}
