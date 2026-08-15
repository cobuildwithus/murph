import { describe, expect, it, vi } from "vitest";

import {
  completeExternalJunctionAuthorizationForTest,
  completeHostedLocalJunctionAuthorizationForTest,
  readHostedLocalJunctionBrowserConfigForTest,
} from "../scripts/run-hosted-local-junction-wearable-browser";

function createConfig(environment: Record<string, string | undefined> = {}) {
  return readHostedLocalJunctionBrowserConfigForTest({
    CI: "true",
    NODE_ENV: "test",
    MURPH_E2E_CONNECT_URL:
      "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=whoop",
    MURPH_E2E_HOSTED_SESSION_COOKIE: "opaque-session",
    MURPH_E2E_PROVIDER_EMAIL: "browser-canary@example.invalid",
    MURPH_E2E_PROVIDER_HEADLESS: "0",
    MURPH_E2E_PROVIDER_PASSWORD: "opaque-password",
    MURPH_E2E_PROVIDER_SOURCE: "whoop",
    MURPH_E2E_PROVIDER_TIMEOUT_MS: "30000",
    MURPH_E2E_WEB_BASE_URL: "https://app.example.test",
    ...environment,
  });
}

function emptyLocator() {
  return {
    count: vi.fn(async () => 0),
    evaluateAll: vi.fn(async () => false),
    nth: vi.fn(),
  };
}

function actionLocator(click: () => void) {
  const action = {
    click: vi.fn(async () => {
      click();
    }),
    elementHandle: vi.fn(async () => ({ dispose: vi.fn(async () => undefined) })),
    getAttribute: vi.fn(async () => null),
    innerText: vi.fn(async () => "Continue"),
    isEnabled: vi.fn(async () => true),
    isVisible: vi.fn(async () => true),
  };
  return {
    count: vi.fn(async () => 1),
    nth: vi.fn(() => action),
  };
}

describe("hosted-local Junction wearable browser authorization", () => {
  it("fails a continuous external challenge after the bounded grace period", async () => {
    let now = 0;
    const page = {
      frames: () => [{ url: () => "https://challenges.cloudflare.com/frame" }],
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).rejects.toThrow(
      "WHOOP authorization was blocked by an external provider challenge.",
    );
    expect(now).toBe(15_000);
  });

  it("keeps one blocked window across alternating challenge and no-action polls", async () => {
    let now = 0;
    const page = {
      frames: () => now % 2_000 === 0
        ? [{ url: () => "https://challenges.cloudflare.com/frame" }]
        : [{ url: () => "https://id.whoop.com/sign-in" }],
      getByRole: vi.fn(() => emptyLocator()),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).rejects.toThrow(
      "WHOOP authorization was blocked by an external provider challenge.",
    );
    expect(now).toBe(15_000);
  });

  it("resets the blocked window only after an automated action is clicked", async () => {
    let actionClicked = false;
    let atMurph = false;
    let challengeWaitsAfterClick = 0;
    let now = 0;
    const page = {
      frames: () => !actionClicked && now === 14_000
        ? [{ url: () => "https://id.whoop.com/sign-in" }]
        : [{ url: () => "https://challenges.cloudflare.com/frame" }],
      getByRole: vi.fn((role: string, options?: { name?: RegExp }) => {
        if (
          role === "button"
          && !actionClicked
          && now === 14_000
          && options?.name?.test("Continue")
        ) {
          return actionLocator(() => {
            actionClicked = true;
          });
        }
        return emptyLocator();
      }),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
        if (actionClicked && duration === 1_000) {
          challengeWaitsAfterClick += 1;
          if (challengeWaitsAfterClick === 14) {
            atMurph = true;
          }
        }
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      createConfig(),
      () => now,
    )).resolves.toBeUndefined();
    expect(actionClicked).toBe(true);
    expect(now).toBe(28_750);
  });

  it.each(["true", " TRUE ", "1"])(
    "keeps headed CI=%j automated and bounds a provider page with no action",
    async (ci) => {
    let now = 0;
    const config = createConfig({ CI: ci });
    const page = {
      evaluate: vi.fn(async () => "complete"),
      frames: () => [{ url: () => "https://id.whoop.com/sign-in" }],
      getByRole: vi.fn(() => emptyLocator()),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async (duration: number) => {
        now += duration;
      }),
    };

    expect(config.manualAuthorizationAllowed).toBe(false);
    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => now,
    )).rejects.toThrow(
      /WHOOP did not expose an automated authorization action\..*Authorization surface: .*"readyState":"complete"/u,
    );
    expect(now).toBe(15_000);
    },
  );

  it("always disables manual completion in headless mode", () => {
    expect(createConfig({
      CI: undefined,
      MURPH_E2E_PROVIDER_HEADLESS: "1",
    }).manualAuthorizationAllowed).toBe(false);
  });

  it("uses stable Chrome only for automated headed CI authorization", () => {
    expect(createConfig().browserChannel).toBe("chrome");
    expect(createConfig({ CI: undefined }).browserChannel).toBeUndefined();
    expect(createConfig({
      MURPH_E2E_PROVIDER_HEADLESS: "1",
    }).browserChannel).toBeUndefined();
  });

  it("permits manual waiting only for a headed non-CI run", async () => {
    let atMurph = false;
    let waits = 0;
    const config = createConfig({ CI: undefined });
    const page = {
      frames: () => [{ url: () => "https://id.whoop.com/sign-in" }],
      getByRole: vi.fn(() => emptyLocator()),
      locator: vi.fn(() => emptyLocator()),
      title: vi.fn(async () => "Sign in"),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async () => {
        waits += 1;
        if (waits === 20) {
          atMurph = true;
        }
      }),
    };

    expect(config.manualAuthorizationAllowed).toBe(true);
    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => waits * 1_000,
    )).resolves.toBeUndefined();
  });

  it("permits a headed non-CI operator to complete a classified challenge", async () => {
    let atMurph = false;
    let waits = 0;
    const config = createConfig({ CI: undefined });
    const page = {
      frames: () => [{ url: () => "https://challenges.cloudflare.com/frame" }],
      title: vi.fn(async () => "Just a moment..."),
      url: () => atMurph
        ? "https://app.example.test/home"
        : "https://id.whoop.com/sign-in",
      waitForTimeout: vi.fn(async () => {
        waits += 1;
        if (waits === 20) {
          atMurph = true;
        }
      }),
    };

    await expect(completeExternalJunctionAuthorizationForTest(
      page as never,
      config,
      () => waits * 1_000,
    )).resolves.toBeUndefined();
    expect(waits).toBe(20);
  });

  it("requires an OTP up front for headed Oura CI", () => {
    expect(() => createConfig({
      MURPH_E2E_CONNECT_URL:
        "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=oura",
      MURPH_E2E_PROVIDER_PASSWORD: undefined,
      MURPH_E2E_PROVIDER_SOURCE: "oura",
    })).toThrow(
      "requires a current MURPH_E2E_PROVIDER_OTP unless it is a headed non-CI run",
    );
  });

  it.each([302, 200])("requires the exact Murph callback with status %i", async (status) => {
    const config = createConfig();
    const response = {
      status: () => status,
      url: () =>
        "https://app.example.test/api/device-sync/connect/junction/callback?state=opaque",
    };
    const page = {
      url: () => "https://app.example.test/home",
      waitForResponse: vi.fn(async (predicate: (value: typeof response) => boolean) => {
        expect(predicate({
          ...response,
          url: () =>
            "https://app.example.test.example.invalid/api/device-sync/connect/junction/callback",
        })).toBe(false);
        expect(predicate({
          ...response,
          url: () => "https://app.example.test/api/device-sync/connect/junction/callback-lookalike",
        })).toBe(false);
        expect(predicate(response)).toBe(true);
        return response;
      }),
    };

    const result = expect(completeHostedLocalJunctionAuthorizationForTest(
      page as never,
      config,
    ));
    if (status === 302) {
      await result.resolves.toBeUndefined();
    } else {
      await result.rejects.toThrow(
        "Murph did not complete the Junction callback redirect.",
      );
    }
  });
});
