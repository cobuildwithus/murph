import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LinkAccountCallbacks = {
  onError?: (error?: string) => void;
  onSuccess?: (params: {
    linkedAccount: unknown;
    linkMethod: string;
    user: { linkedAccounts?: unknown; linked_accounts?: unknown };
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
  usePrivy: vi.fn(),
  useUpdateEmail: vi.fn(),
  useUser: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLinkAccount: mocks.useLinkAccount,
  usePrivy: mocks.usePrivy,
  useUpdateEmail: mocks.useUpdateEmail,
  useUser: mocks.useUser,
}));

let cleanupRender: (() => Promise<void>) | null = null;

describe("HostedEmailSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkAccountCallbacks = null;
    mocks.updateEmailCallbacks = null;
    mocks.refreshUser.mockReset().mockResolvedValue({
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
    mocks.usePrivy.mockReturnValue({
      ready: true,
    });
    // Privy's headless update-email flow requires an email on the Privy user;
    // the default mock mirrors that so the inline send-code path is exercised.
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: { address: "old@example.com" },
        linkedAccounts: [],
      },
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

    assert.match(markup, /href="mailto:murph\+u2-private-alias@mail\.example\.test\?subject=Hey%20Murph"/);
    assert.match(markup, /Email Murph at murph\+u2-private-alias@mail\.example\.test/);
    assert.match(markup, /Email Murph</);
    assert.doesNotMatch(markup, /Email murph\+u2-private-alias/);
  });

  it("offers a webmail chooser for the Murph email alias when the member uses a known webmail provider", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const markup = renderToStaticMarkup(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "member@gmail.com",
          verifiedAt: 1741194420,
        },
        murphEmailAddress: "murph+u2-private-alias@mail.example.test",
      }),
    );

    // A webmail member gets a chooser button instead of a direct mailto link.
    assert.match(markup, /aria-haspopup="dialog"[^>]*>Email Murph</);
    assert.doesNotMatch(markup, /<a[^>]*href="mailto:[^"]*"[^>]*>Email Murph</);
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

  it("does not open the email link flow when the pre-link provider refresh fails", async () => {
    mocks.refreshUser.mockRejectedValueOnce(new Error("provider unavailable"));
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
    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "Murph could not confirm your current email links. Wait a moment and try again.",
      );
    });
    expect(mocks.linkEmail).not.toHaveBeenCalled();
  });

  it("recovers a provider-linked email after reload without trusting the billing hint", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: { address: "server-verified@example.com" },
        linkedAccounts: [],
      },
    });
    const syncFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      emailAddress: "server-verified@example.com",
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
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "payer-hint@example.com",
          verifiedAt: null,
        },
        privyEmailLinked: true,
      }),
    );
    cleanupRender = cleanup;

    const recoverButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Save linked email"),
    );
    expect(recoverButton).toBeTruthy();

    await act(async () => {
      recoverButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("server-verified@example.com");
    });
    expect(syncFetch).toHaveBeenCalledWith(
      "/api/settings/email/sync",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    expect(mocks.linkEmail).not.toHaveBeenCalled();
    expect(mocks.sendCode).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("payer-hint@example.com");
  });

  it("recovers a changed provider email after reload instead of requiring another code", async () => {
    const syncFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      emailAddress: "replacement@example.com",
      ok: true,
      runTriggered: true,
      verifiedAt: "2026-07-12T00:00:00.000Z",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", syncFetch);
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        changeFlow: true,
        initialEmail: {
          address: "canonical@example.com",
          verifiedAt: 1771891200,
        },
        privyEmailLinked: true,
        privyEmailSyncRequired: true,
      }),
    );
    cleanupRender = cleanup;

    const recoverButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Save linked email"),
    );
    expect(recoverButton).toBeTruthy();
    expect(container.querySelector('input[id="settings-email-address"]')).toBeNull();

    await act(async () => {
      recoverButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("replacement@example.com");
    });
    expect(syncFetch).toHaveBeenCalledWith(
      "/api/settings/email/sync",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    expect(mocks.sendCode).not.toHaveBeenCalled();
    expect(mocks.verifyCode).not.toHaveBeenCalled();
  });

  describe("HostedEmailPrivyLinkHandOff", () => {
    it("opens Privy's link modal once the client is ready without rendering Murph chrome", async () => {
      mocks.useUser.mockReturnValue({
        refreshUser: mocks.refreshUser,
        user: {
          linkedAccounts: [],
        },
      });
      const onAborted = vi.fn();
      const { HostedEmailPrivyLinkHandOff } = await import(
        "@/src/components/settings/hosted-email-privy-link-hand-off"
      );

      const { cleanup, container } = await renderClientComponent(
        createElement(HostedEmailPrivyLinkHandOff, {
          onAborted,
          onSynced: vi.fn(),
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      expect(mocks.linkEmail).toHaveBeenCalledTimes(1);
      expect(mocks.sendCode).not.toHaveBeenCalled();
      // Privy's modal is the only visible surface while it is open.
      expect(container.textContent).toBe("");
      expect(onAborted).not.toHaveBeenCalled();
    });

    it("shows a spinner instead of opening the modal while the Privy client boots", async () => {
      mocks.usePrivy.mockReturnValue({
        ready: false,
      });
      mocks.useUser.mockReturnValue({
        refreshUser: mocks.refreshUser,
        user: null,
      });
      const { HostedEmailPrivyLinkHandOff } = await import(
        "@/src/components/settings/hosted-email-privy-link-hand-off"
      );

      const { cleanup, container } = await renderClientComponent(
        createElement(HostedEmailPrivyLinkHandOff, {
          onAborted: vi.fn(),
          onSynced: vi.fn(),
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      expect(mocks.linkEmail).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Opening secure window");
    });

    it("closes for app reauth instead of opening Privy's modal when the client user is absent", async () => {
      mocks.useUser.mockReturnValue({
        refreshUser: mocks.refreshUser,
        user: null,
      });
      const onAborted = vi.fn();
      const { HostedEmailPrivyLinkHandOff } = await import(
        "@/src/components/settings/hosted-email-privy-link-hand-off"
      );

      const { cleanup } = await renderClientComponent(
        createElement(HostedEmailPrivyLinkHandOff, {
          onAborted,
          onSynced: vi.fn(),
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      await vi.waitFor(() => {
        expect(onAborted).toHaveBeenCalledTimes(1);
      });
      expect(mocks.linkEmail).not.toHaveBeenCalled();
      expect(mocks.sendCode).not.toHaveBeenCalled();
    });

    it("closes the flow when the member dismisses Privy's modal", async () => {
      mocks.useUser.mockReturnValue({
        refreshUser: mocks.refreshUser,
        user: {
          linkedAccounts: [],
        },
      });
      const onAborted = vi.fn();
      const { HostedEmailPrivyLinkHandOff } = await import(
        "@/src/components/settings/hosted-email-privy-link-hand-off"
      );

      const { cleanup } = await renderClientComponent(
        createElement(HostedEmailPrivyLinkHandOff, {
          onAborted,
          onSynced: vi.fn(),
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      await act(async () => {
        mocks.linkAccountCallbacks?.onError?.("exited_link_flow");
      });

      expect(onAborted).toHaveBeenCalledTimes(1);
    });

    it("waits for canonical saving before completing the Privy link handoff", async () => {
      mocks.useUser.mockReturnValue({
        refreshUser: mocks.refreshUser,
        user: {
          email: null,
          linkedAccounts: [
            {
              phoneNumber: "+15555550100",
              type: "phone",
            },
          ],
        },
      });
      const syncFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
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
      const onAborted = vi.fn();
      const onSynced = vi.fn();
      const { HostedEmailPrivyLinkHandOff } = await import(
        "@/src/components/settings/hosted-email-privy-link-hand-off"
      );

      const { cleanup, container } = await renderClientComponent(
        createElement(HostedEmailPrivyLinkHandOff, {
          onAborted,
          onSynced,
        }),
        { requireButton: false },
      );
      cleanupRender = cleanup;

      await vi.waitFor(() => {
        expect(mocks.linkEmail).toHaveBeenCalledTimes(1);
        expect(container.textContent).toBe("");
      });

      await act(async () => {
        mocks.linkAccountCallbacks?.onSuccess?.({
          linkedAccount: {
            address: "linked@example.com",
            latestVerifiedAt: 1771977600,
            type: "email",
          },
          linkMethod: "email",
          user: {
            linkedAccounts: [
              {
                phoneNumber: "+15555550100",
                type: "phone",
              },
            ],
          },
        });
      });

      await vi.waitFor(() => {
        expect(onSynced).toHaveBeenCalledTimes(1);
      });
      expect(onAborted).not.toHaveBeenCalled();
      expect(mocks.linkEmail).toHaveBeenCalledTimes(1);
      expect(syncFetch).toHaveBeenCalledTimes(1);
    });
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

  it("asks the browser to sign in before verifying a server-provided email when the Privy client user is absent", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
    const onClientAuthRequired = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "payer@example.com",
          verifiedAt: null,
        },
        onClientAuthRequired,
      }),
    );
    cleanupRender = cleanup;

    const sendCodeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open secure email setup"),
    );
    expect(sendCodeButton).toBeTruthy();

    await act(async () => {
      sendCodeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(onClientAuthRequired).toHaveBeenCalledTimes(1);
    expect(mocks.sendCode).not.toHaveBeenCalled();
    expect(mocks.linkEmail).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sign in on this device to manage email.");
  });

  it("asks the browser to sign in before opening Privy's link-email modal", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
    const onClientAuthRequired = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: null,
        onClientAuthRequired,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link email"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(onClientAuthRequired).toHaveBeenCalledTimes(1);
    expect(mocks.linkEmail).not.toHaveBeenCalled();
    expect(mocks.sendCode).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sign in on this device to manage email.");
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
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Email verified");
      expect(onSynced).toHaveBeenCalledWith({
        emailAddress: "linked@example.com",
        runTriggered: true,
        verifiedAt: "2026-04-25T00:00:00.000Z",
      });
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
    mocks.refreshUser.mockResolvedValue({
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
    const onSynced = vi.fn();

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: null,
        onSynced,
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
    await vi.waitFor(() => {
      expect(onSynced).toHaveBeenCalledTimes(1);
    });
  });

  it("syncs the newly linked client account when callback users are still phone-only", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: null,
        linkedAccounts: [
          {
            phone_number: "+15555550100",
            type: "phone",
          },
        ],
      },
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
    const onSynced = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "payer-hint@example.com",
          verifiedAt: null,
        },
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    const sendCodeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open secure email setup"),
    );

    await act(async () => {
      sendCodeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(mocks.linkEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          address: "linked@example.com",
          latestVerifiedAt: 1771977600,
          type: "email",
        },
        linkMethod: "email",
        user: {
          linkedAccounts: [
            {
              phoneNumber: "+15555550100",
              type: "phone",
            },
          ],
        },
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
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Email linked: payer-hint@example.com");
      expect(container.textContent).not.toContain("payer-hint@example.com");
      expect(container.querySelector('input[id="settings-email-address"]')).toBeNull();
      expect(container.textContent).toContain("linked@example.com");
      expect(onSynced).toHaveBeenCalledTimes(1);
    });
  });

  it("does not promote a pre-existing verified email from an addressless link callback", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: null,
        linkedAccounts: [],
      },
    });
    mocks.refreshUser
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            address: "pre-existing@example.com",
            latestVerifiedAt: 1771977500,
            type: "email",
          },
        ],
      })
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            address: "pre-existing@example.com",
            latestVerifiedAt: 1771977500,
            type: "email",
          },
        ],
      })
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            address: "pre-existing@example.com",
            latestVerifiedAt: 1771977500,
            type: "email",
          },
          {
            address: "newer-client-value@example.com",
            latestVerifiedAt: 1771977600,
            type: "email",
          },
        ],
      });
    const syncFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        emailAddress: "newer-client-value@example.com",
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
    const onSynced = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "payer-hint@example.com",
          verifiedAt: null,
        },
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    const setupButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open secure email setup"),
    );
    await act(async () => {
      setupButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          type: "email",
        },
        linkMethod: "email",
        user: {
          linkedAccounts: [
            {
              address: "pre-existing@example.com",
              latestVerifiedAt: 1771977500,
              type: "email",
            },
          ],
        },
      });
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Try saving again");
    });
    expect(syncFetch).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Try saving again"),
    );
    await act(async () => {
      retryButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Email linked: payer-hint@example.com");
      expect(container.textContent).not.toContain("payer-hint@example.com");
      expect(container.textContent).not.toContain("pre-existing@example.com");
      expect(container.textContent).toContain("newer-client-value@example.com");
      expect(onSynced).toHaveBeenCalledWith({
        emailAddress: "newer-client-value@example.com",
        runTriggered: true,
        verifiedAt: "2026-04-25T00:00:00.000Z",
      });
    });
    expect(syncFetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { expectedEmailAddress: "newer-client-value@example.com" },
    ]);
  });

  it("fails closed when an addressless link reveals multiple new verified emails", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: null,
        linkedAccounts: [],
      },
    });
    mocks.refreshUser
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            address: "pre-existing@example.com",
            latestVerifiedAt: 1771977500,
            type: "email",
          },
        ],
      })
      .mockResolvedValue({
        linkedAccounts: [
          {
            address: "pre-existing@example.com",
            latestVerifiedAt: 1771977500,
            type: "email",
          },
          {
            address: "first-new@example.com",
            latestVerifiedAt: 1771977600,
            type: "email",
          },
          {
            address: "second-new@example.com",
            latestVerifiedAt: 1771977700,
            type: "email",
          },
        ],
      });
    const syncFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", syncFetch);
    const onSynced = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: null,
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    const setupButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link email"),
    );
    await act(async () => {
      setupButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(mocks.linkEmail).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: { type: "email" },
        linkMethod: "email",
        user: { linkedAccounts: [] },
      });
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Try saving again");
    });
    expect(syncFetch).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();
  });

  it("uses Privy's address entry when the link callback omits the email", async () => {
    let resolveInitialRefresh: ((value: {
      linkedAccounts: Array<{
        address: string;
        latestVerifiedAt: number;
        type: string;
      }>;
    }) => void) | null = null;
    const initialRefresh = new Promise<{
      linkedAccounts: Array<{
        address: string;
        latestVerifiedAt: number;
        type: string;
      }>;
    }>((resolve) => {
      resolveInitialRefresh = resolve;
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: null,
        linkedAccounts: [
          {
            phoneNumber: "+15555550100",
            type: "phone",
          },
        ],
      },
    });
    mocks.refreshUser
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            phoneNumber: "+15555550100",
            type: "phone",
          },
        ],
      })
      .mockReturnValueOnce(initialRefresh)
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            address: "replacement@example.com",
            latestVerifiedAt: 1771977600,
            type: "email",
          },
        ],
      });
    const notReadyResponse = () => new Response(JSON.stringify({
      error: {
        code: "PRIVY_EMAIL_NOT_READY",
        message: "The replacement email has not reached the server yet.",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 409,
    });
    const syncFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(notReadyResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        emailAddress: "replacement@example.com",
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
    const onSynced = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        changeFlow: true,
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    expect(container.querySelector('input[id="settings-email-address"]')).toBeNull();
    const sendCodeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open secure email setup"),
    );

    await act(async () => {
      sendCodeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(mocks.linkEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: { type: "email" },
        linkMethod: "email",
        user: { linkedAccounts: [] },
      });
    });

    await vi.waitFor(() => {
      expect(mocks.refreshUser).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      const resolvingButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Open secure email setup"),
      );
      expect(resolvingButton?.hasAttribute("disabled")).toBe(true);
    });

    await act(async () => {
      resolveInitialRefresh?.({
        linkedAccounts: [
          {
            address: "old@example.com",
            latestVerifiedAt: 1771891200,
            type: "email",
          },
        ],
      });
      await initialRefresh;
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Try saving again");
    });
    expect(syncFetch).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Try saving again"),
    );
    await act(async () => {
      retryButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(onSynced).toHaveBeenCalledTimes(1);
    });
    expect(syncFetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { expectedEmailAddress: "replacement@example.com" },
      { expectedEmailAddress: "replacement@example.com" },
    ]);
  });

  it("retries a failed canonical sync without reopening Privy's link flow", async () => {
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        email: null,
        linkedAccounts: [],
      },
    });
    const linkedUser = {
      linkedAccounts: [
        {
          address: "linked@example.com",
          type: "email",
        },
      ],
    };
    mocks.refreshUser.mockResolvedValue({ linkedAccounts: [] });
    const syncFetch = vi.fn<typeof fetch>()
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
    const onSynced = vi.fn();
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    const { cleanup, container } = await renderClientComponent(
      createElement(HostedEmailSettings, {
        authenticated: true,
        initialEmail: {
          address: "payer-hint@example.com",
          verifiedAt: null,
        },
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    const sendCodeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open secure email setup"),
    );
    await act(async () => {
      sendCodeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          address: "linked@example.com",
          type: "email",
        },
        linkMethod: "email",
        user: linkedUser,
      });
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Hosted sync unavailable right now.");
    });
    expect(container.textContent).not.toContain("Email linked");
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Try saving again"),
    );
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(onSynced).toHaveBeenCalledTimes(1);
    });
    expect(syncFetch).toHaveBeenCalledTimes(2);
    expect(mocks.linkEmail).toHaveBeenCalledTimes(1);
  });

  it("sends an update-email code and verifies it from the inline code step", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    mocks.verifyCode.mockResolvedValueOnce({
      user: {
        linkedAccounts: [
          {
            address: "old@example.com",
            latestVerifiedAt: 1771891200,
            type: "email",
          },
        ],
      },
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
    expect(JSON.parse(String(syncFetch.mock.calls[0]?.[1]?.body))).toEqual({
      expectedEmailAddress: "member@example.com",
    });
  });

  it("retries the OTP target after canonical saving fails without requiring another code", async () => {
    const { HostedEmailSettings } = await import("@/src/components/settings/hosted-email-settings");
    mocks.verifyCode.mockResolvedValueOnce({
      user: {
        linkedAccounts: [
          {
            address: "old@example.com",
            latestVerifiedAt: 1771891200,
            type: "email",
          },
        ],
      },
    });
    const syncFetch = vi.fn<typeof fetch>()
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
        changeFlow: true,
        initialEmail: {
          address: "old@example.com",
          verifiedAt: 1771891200,
        },
      }),
    );
    cleanupRender = cleanup;

    const emailInput = container.querySelector<HTMLInputElement>(
      'input[id="settings-email-address"]',
    );
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Send verification code"),
    );

    await act(async () => {
      if (emailInput) {
        setInputValue(window, emailInput, "member@example.com");
      }
      sendButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const codeInput = container.querySelector<HTMLInputElement>("input[data-input-otp]");
    const verifyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Verify email"),
    );

    await act(async () => {
      if (codeInput) {
        setInputValue(window, codeInput, "123456");
      }
      verifyButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Hosted sync unavailable right now.");
    });
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Try saving again"),
    );
    expect(retryButton).toBeTruthy();
    expect(container.querySelector('input[id="settings-email-address"]')).toBeNull();

    await act(async () => {
      retryButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Email verified and connected: member@example.com");
    });
    expect(mocks.verifyCode).toHaveBeenCalledTimes(1);
    expect(syncFetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { expectedEmailAddress: "member@example.com" },
      { expectedEmailAddress: "member@example.com" },
    ]);
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
  it("keeps addressless provider-propagation retries server-resolved", async () => {
    const { syncHostedEmailConnectionWithRetry } = await import(
      "@/src/components/settings/hosted-email-settings-helpers"
    );
    const notReadyResponse = () => new Response(JSON.stringify({
      error: {
        code: "PRIVY_EMAIL_NOT_READY",
        message: "Verified email has not reached the server yet.",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 409,
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(notReadyResponse())
      .mockResolvedValueOnce(notReadyResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        emailAddress: "server-verified@example.com",
        ok: true,
        runTriggered: true,
        verifiedAt: "2026-04-25T00:00:00.000Z",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    await expect(syncHostedEmailConnectionWithRetry(null, {
      fetchImpl,
      sleepImpl,
    })).resolves.toEqual({
      emailAddress: "server-verified@example.com",
      runTriggered: true,
      verifiedAt: "2026-04-25T00:00:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map((call) => call[1]?.body)).toEqual([
      "{}",
      "{}",
      "{}",
    ]);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("reports no terminal success after a sync failure and supports a direct resync without another OTP flow", async () => {
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
      expectedEmailAddress: "verified@example.com",
      fetchImpl,
      mode: "verify",
    });
    const secondAttempt = await syncHostedVerifiedEmailAddress({
      expectedEmailAddress: "verified@example.com",
      fetchImpl,
      mode: "resync",
    });

    expect(firstAttempt).toEqual({
      errorMessage: "Hosted sync unavailable right now.",
      successMessage: null,
      syncResult: null,
    });
    expect(secondAttempt).toEqual({
      errorMessage: null,
      successMessage: "Email connected: verified@example.com",
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
