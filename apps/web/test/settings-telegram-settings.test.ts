import { act, createElement, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

type LinkAccountCallbacks = {
  onError?: (error: unknown, details?: { linkMethod?: string }) => void;
  onSuccess?: (params: {
    linkedAccount: unknown;
    linkMethod: string;
    user: { linkedAccounts?: unknown };
  }) => void;
};

const mocks = vi.hoisted(() => ({
  linkAccountCallbacks: null as LinkAccountCallbacks | null,
  linkTelegram: vi.fn(),
  refreshUser: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  useLinkAccount: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  useLinkAccount: mocks.useLinkAccount,
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {
    readonly code: string | null;

    constructor(input: { code: string | null; message: string }) {
      super(input.message);
      this.code = input.code;
    }
  },
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

let cleanupRender: (() => Promise<void>) | null = null;

type TelegramSyncPayload = {
  botLink: string;
  runTriggered: boolean;
  telegramUserId: string;
  telegramUsername: string;
};

function createDeferredTelegramSync() {
  let resolveSync: (value: TelegramSyncPayload) => void = () => {};
  const promise = new Promise<TelegramSyncPayload>((resolve) => {
    resolveSync = resolve;
  });

  return {
    promise,
    resolveSync,
  };
}

describe("ConnectTelegram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkAccountCallbacks = null;
    mocks.linkTelegram.mockReturnValue(undefined);
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [],
    });
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: "murph_user",
    });
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      ready: true,
    });
    mocks.useLinkAccount.mockImplementation((callbacks: LinkAccountCallbacks) => {
      mocks.linkAccountCallbacks = callbacks;

      return {
        linkTelegram: mocks.linkTelegram,
      };
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 12345,
            type: "telegram",
            username: "murph_user",
          },
        ],
      },
    });
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("syncs an existing server-provided Telegram account in the background without a manual save button", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    const backgroundSync = createDeferredTelegramSync();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(backgroundSync.promise);

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "12345",
          username: "murph_user",
        },
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("@murph_user");
    expect(container.textContent).toContain("Change");
    const contactLink = container.querySelector('a[href="https://t.me/withmurph_bot"]');
    expect(contactLink?.textContent).toContain("Message @withmurph_bot");
    expect(container.textContent).not.toContain("Save connection");

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "12345",
        },
        url: "/api/settings/telegram/sync",
      });
    });

    const changeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Change"),
    );
    expect(changeButton?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Finishing Telegram sync");
    expect(container.textContent).not.toContain("Telegram updated");

    await act(async () => {
      backgroundSync.resolveSync({
        botLink: "https://t.me/murph_bot?start=connect",
        runTriggered: true,
        telegramUserId: "12345",
        telegramUsername: "murph_user",
      });
      await backgroundSync.promise;
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Open bot");
    });
  });

  it("renders the unconnected Telegram state from the server snapshot instead of Privy client user", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 12345,
            type: "telegram",
            username: "murph_user",
          },
        ],
      },
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Connect Telegram");
    expect(container.textContent).not.toContain("@murph_user");
    expect(container.textContent).not.toContain("Message @withmurph_bot");
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  });

  it("maps Privy Telegram link failures to safe user-facing copy", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Connect Telegram"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.(
        "linked_to_another_user",
        { linkMethod: "telegram" },
      );
    });

    expect(container.textContent).toContain("That Telegram account is already linked to a different Murph account.");
    expect(container.textContent).toContain("Contact support");
  });

  it("uses a sanitized initial Telegram account when Privy user state has not loaded", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: null,
    });
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "telegram-test-user",
      telegramUsername: "murph_test",
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "telegram-test-user",
          username: "murph_test",
        },
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("@murph_test");
    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "telegram-test-user",
        },
        url: "/api/settings/telegram/sync",
      });
    });
  });

  it("shows an email support action when Telegram sync reports an account conflict", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new Error("This verified session conflicts with an existing Murph account. Contact support so we can merge it safely."),
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "telegram-test-conflict-user",
          username: "murph_test_conflict",
        },
      }),
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Unable to update Telegram");
      expect(container.textContent).toContain("Email support");
    });

    const supportLink = container.querySelector<HTMLAnchorElement>(
      'a[href^="mailto:support@withmurph.ai"]',
    );

    expect(supportLink?.textContent).toContain("Email support");
    expect(supportLink?.href).toContain("subject=Murph+Telegram+account+support");
    expect(supportLink?.href).toContain("Telegram+setup+or+account+support");
  });

  it("keeps a newer relink result when an older background sync resolves later", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    const backgroundSync = createDeferredTelegramSync();
    const relinkSync = createDeferredTelegramSync();
    mocks.requestHostedOnboardingJson
      .mockReturnValueOnce(backgroundSync.promise)
      .mockReturnValueOnce(relinkSync.promise);
    mocks.refreshUser.mockResolvedValueOnce({
      linkedAccounts: [
        {
          id: 67890,
          type: "telegram",
          username: "new_user",
        },
      ],
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "12345",
          username: "murph_user",
        },
      }),
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "12345",
        },
        url: "/api/settings/telegram/sync",
      });
    });

    const changeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Change"),
    );
    expect(changeButton).toBeTruthy();

    await act(async () => {
      changeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.linkTelegram).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          id: 67890,
          type: "telegram",
          username: "new_user",
        },
        linkMethod: "telegram",
        user: {
          linkedAccounts: [
            {
              id: 67890,
              type: "telegram",
              username: "new_user",
            },
          ],
        },
      });
    });

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "67890",
        },
        url: "/api/settings/telegram/sync",
      });
    });

    await act(async () => {
      relinkSync.resolveSync({
        botLink: "https://t.me/murph_bot?start=connect",
        runTriggered: true,
        telegramUserId: "67890",
        telegramUsername: "new_user",
      });
      await relinkSync.promise;
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("@new_user");
    });

    await act(async () => {
      backgroundSync.resolveSync({
        botLink: "https://t.me/murph_bot?start=connect",
        runTriggered: true,
        telegramUserId: "12345",
        telegramUsername: "murph_user",
      });
      await backgroundSync.promise;
    });

    expect(container.textContent).toContain("@new_user");
    expect(container.textContent).not.toContain("@murph_user");
  });

  it("syncs manual Telegram link from the Privy success payload when refreshUser is stale", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    mocks.refreshUser.mockResolvedValueOnce({
      linkedAccounts: [],
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Connect Telegram"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          id: 67890,
          type: "telegram",
          username: "new_user",
        },
        linkMethod: "telegram",
        user: {
          linkedAccounts: [
            {
              id: 67890,
              type: "telegram",
              username: "new_user",
            },
          ],
        },
      });
    });

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "67890",
        },
        url: "/api/settings/telegram/sync",
      });
    });
    expect(container.textContent).not.toContain("account details aren't available yet");
  });
});

describe("HostedTelegramCardSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkAccountCallbacks = null;
    mocks.linkTelegram.mockReturnValue(undefined);
    mocks.refreshUser.mockResolvedValue({
      linkedAccounts: [
        {
          id: 67890,
          type: "telegram",
          username: "new_user",
        },
      ],
    });
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "67890",
      telegramUsername: "new_user",
    });
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      ready: true,
    });
    mocks.useLinkAccount.mockImplementation((callbacks: LinkAccountCallbacks) => {
      mocks.linkAccountCallbacks = callbacks;

      return {
        linkTelegram: mocks.linkTelegram,
      };
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [],
      },
    });
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
  });

  it("renders card display from the server snapshot instead of Privy client user", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 67890,
            type: "telegram",
            username: "new_user",
          },
        ],
      },
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Link Telegram");
    expect(container.textContent).not.toContain("@new_user");
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  });

  it("renders the server-seeded username for a server-bound Telegram account", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: "sample_user",
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 12345,
            type: "telegram",
            username: "client_user",
          },
        ],
      },
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "12345",
          username: "sample_user",
        },
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("@sample_user");
    expect(container.textContent).not.toContain("@client_user");
    expect(container.textContent).not.toContain("Telegram user 12345");
  });

  it("does not render a client-only Privy username for a server-bound Telegram account", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: null,
    });
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 12345,
            type: "telegram",
            username: "sample_user",
          },
        ],
      },
    });
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: null,
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "12345",
          username: null,
        },
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Connected");
    expect(container.textContent).not.toContain("@sample_user");
    expect(container.textContent).not.toContain("Telegram user 12345");
  });

  it("notifies its parent after a manual Telegram link sync succeeds", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    const onSynced = vi.fn();

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: null,
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link Telegram"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.linkTelegram).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

    await act(async () => {
      mocks.linkAccountCallbacks?.onSuccess?.({
        linkedAccount: {
          id: 67890,
          type: "telegram",
          username: "new_user",
        },
        linkMethod: "telegram",
        user: {
          linkedAccounts: [
            {
              id: 67890,
              type: "telegram",
              username: "new_user",
            },
          ],
        },
      });
    });

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "67890",
        },
        url: "/api/settings/telegram/sync",
      });
    });
    expect(onSynced).toHaveBeenCalledWith({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "67890",
      telegramUsername: "new_user",
    });
  });

  it("does not auto-link Telegram before Privy is ready", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    mocks.usePrivy.mockReturnValue({
      authenticated: false,
      ready: false,
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        autoLink: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link Telegram"),
    );
    expect(linkButton).toBeTruthy();

    expect(mocks.linkTelegram).not.toHaveBeenCalled();
    expect(linkButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Preparing Telegram linking");
  });

  it("keeps the manual Telegram link button inert before Privy is ready", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    mocks.usePrivy.mockReturnValue({
      authenticated: false,
      ready: false,
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link Telegram"),
    );

    expect(linkButton?.disabled).toBe(true);
    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(mocks.linkTelegram).not.toHaveBeenCalled();
  });

  it("auto-links Telegram once Privy becomes ready and authenticated", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    const privyState = {
      authenticated: false,
      ready: false,
    };
    let forceRender: (() => void) | null = null;
    function PrivyReadyHarness() {
      const [, setRenderCount] = useState(0);

      useEffect(() => {
        forceRender = () => setRenderCount((value) => value + 1);
        return () => {
          forceRender = null;
        };
      }, []);

      return createElement(HostedTelegramCardSettings, {
        authenticated: true,
        autoLink: true,
        initialTelegramAccount: null,
      });
    }
    mocks.usePrivy.mockImplementation(() => privyState);

    const { cleanup, container } = await renderClientComponent(createElement(PrivyReadyHarness));
    cleanupRender = cleanup;

    expect(mocks.linkTelegram).not.toHaveBeenCalled();

    await act(async () => {
      privyState.authenticated = true;
      privyState.ready = true;
      forceRender?.();
    });

    await vi.waitFor(() => {
      expect(mocks.linkTelegram).toHaveBeenCalledTimes(1);
    });
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Opening Telegram");
  });

  it("syncs an existing Privy Telegram account during auto-link instead of relinking", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    const onSynced = vi.fn();
    const autoLinkSync = createDeferredTelegramSync();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(autoLinkSync.promise);
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 67890,
            type: "telegram",
            username: "new_user",
          },
        ],
      },
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        autoLink: true,
        initialTelegramAccount: null,
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    expect(container.textContent).toContain("Link Telegram");
    expect(container.textContent).not.toContain("@new_user");

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "67890",
        },
        url: "/api/settings/telegram/sync",
      });
    });

    expect(mocks.linkTelegram).not.toHaveBeenCalled();

    await act(async () => {
      autoLinkSync.resolveSync({
        botLink: "https://t.me/murph_bot?start=connect",
        runTriggered: true,
        telegramUserId: "67890",
        telegramUsername: "new_user",
      });
      await autoLinkSync.promise;
    });

    expect(onSynced).toHaveBeenCalledWith({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "67890",
      telegramUsername: "new_user",
    });
  });

  it("syncs an existing Privy Telegram account from the manual retry button", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    const onSynced = vi.fn();
    const manualSync = createDeferredTelegramSync();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(manualSync.promise);
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 67890,
            type: "telegram",
            username: "new_user",
          },
        ],
      },
    });

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: null,
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link Telegram"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "67890",
        },
        url: "/api/settings/telegram/sync",
      });
    });
    expect(mocks.linkTelegram).not.toHaveBeenCalled();

    await act(async () => {
      manualSync.resolveSync({
        botLink: "https://t.me/murph_bot?start=connect",
        runTriggered: true,
        telegramUserId: "67890",
        telegramUsername: "new_user",
      });
      await manualSync.promise;
    });

    expect(onSynced).toHaveBeenCalledWith({
      botLink: "https://t.me/murph_bot?start=connect",
      runTriggered: true,
      telegramUserId: "67890",
      telegramUsername: "new_user",
    });
  });

  it("does not consume auto-link when Privy Telegram arrives before the scheduled link starts", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    const onSynced = vi.fn();
    const autoLinkSync = createDeferredTelegramSync();
    const privyUserState: { linkedAccounts: unknown[] } = {
      linkedAccounts: [],
    };
    let forceRender: (() => void) | null = null;

    vi.useFakeTimers();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(autoLinkSync.promise);
    mocks.useUser.mockImplementation(() => ({
      refreshUser: mocks.refreshUser,
      user: privyUserState,
    }));

    function PrivyUserArrivalHarness() {
      const [, setRenderCount] = useState(0);

      useEffect(() => {
        forceRender = () => setRenderCount((value) => value + 1);
        return () => {
          forceRender = null;
        };
      }, []);

      return createElement(HostedTelegramCardSettings, {
        authenticated: true,
        autoLink: true,
        initialTelegramAccount: null,
        onSynced,
      });
    }

    try {
      const { cleanup } = await renderClientComponent(createElement(PrivyUserArrivalHarness));
      cleanupRender = cleanup;

      expect(mocks.linkTelegram).not.toHaveBeenCalled();

      await act(async () => {
        privyUserState.linkedAccounts = [
          {
            id: 67890,
            type: "telegram",
            username: "new_user",
          },
        ];
        forceRender?.();
      });

      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      await vi.waitFor(() => {
        expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
          payload: {
            expectedTelegramUserId: "67890",
          },
          url: "/api/settings/telegram/sync",
        });
      });
      expect(mocks.linkTelegram).not.toHaveBeenCalled();

      await act(async () => {
        autoLinkSync.resolveSync({
          botLink: "https://t.me/murph_bot?start=connect",
          runTriggered: true,
          telegramUserId: "67890",
          telegramUsername: "new_user",
        });
        await autoLinkSync.promise;
      });

      expect(onSynced).toHaveBeenCalledWith({
        botLink: "https://t.me/murph_bot?start=connect",
        runTriggered: true,
        telegramUserId: "67890",
        telegramUsername: "new_user",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not render arbitrary Privy Telegram link failure text from the settings card callback", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: null,
      }),
    );
    cleanupRender = cleanup;

    const linkButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Link Telegram"),
    );
    expect(linkButton).toBeTruthy();

    await act(async () => {
      linkButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await act(async () => {
      mocks.linkAccountCallbacks?.onError?.(
        new Error("Sensitive provider detail for <PRIVY_APP_ID> and redirect <CALLBACK_URL>"),
        { linkMethod: "telegram" },
      );
    });

    expect(container.textContent).toContain("Could not link Telegram right now.");
    expect(container.textContent).not.toContain("Sensitive provider detail");
    expect(container.textContent).not.toContain("<PRIVY_APP_ID>");
  });

  it("does not notify its parent for quiet background Telegram resync", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    const onSynced = vi.fn();
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [
          {
            id: 67890,
            type: "telegram",
            username: "new_user",
          },
        ],
      },
    });

    const { cleanup } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "67890",
          username: "new_user",
        },
        onSynced,
      }),
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
        payload: {
          expectedTelegramUserId: "67890",
        },
        url: "/api/settings/telegram/sync",
      });
    });
    expect(onSynced).not.toHaveBeenCalled();
  });

  it("shows an email support action when the settings Telegram card reports a support error", async () => {
    const { HostedTelegramCardSettings } = await import(
      "@/src/components/settings/hosted-telegram-card-settings"
    );
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new Error("That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely."),
    );

    const { cleanup, container } = await renderClientComponent(
      createElement(HostedTelegramCardSettings, {
        authenticated: true,
        initialTelegramAccount: {
          telegramUserId: "telegram-test-settings-conflict-user",
          username: "murph_test_settings_conflict",
        },
      }),
    );
    cleanupRender = cleanup;

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Contact support");
      expect(container.textContent).toContain("Email support");
    });

    const supportLink = container.querySelector<HTMLAnchorElement>(
      'a[href^="mailto:support@withmurph.ai"]',
    );

    expect(supportLink?.textContent).toContain("Email support");
    expect(supportLink?.href).toContain("subject=Murph+Telegram+account+support");
    expect(supportLink?.href).toContain("Telegram+setup+or+account+support");
  });
});
