import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  linkTelegram: vi.fn(),
  refreshUser: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
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
    mocks.linkTelegram.mockResolvedValue(undefined);
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
      linkTelegram: mocks.linkTelegram,
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

  it("syncs an existing linked Telegram account in the background without a manual save button", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    const backgroundSync = createDeferredTelegramSync();
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(backgroundSync.promise);

    const { cleanup, container } = await renderClientComponent(
      createElement(ConnectTelegram, {
        authenticated: true,
        initialTelegramAccount: null,
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

  it("renders the unconnected Telegram state with the same compact link row", async () => {
    const { ConnectTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings"
    );
    mocks.useUser.mockReturnValue({
      refreshUser: mocks.refreshUser,
      user: {
        linkedAccounts: [],
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
    expect(container.textContent).not.toContain("Message @withmurph_bot");
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
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
          firstName: null,
          lastName: null,
          photoUrl: null,
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
        initialTelegramAccount: null,
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
});
