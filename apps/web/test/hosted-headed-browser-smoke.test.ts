import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  completeExternalJunctionAuthorizationForTest,
  readHostedLocalJunctionBrowserConfigForTest,
} from "../scripts/run-hosted-local-junction-wearable-browser";

const smokeEnabled = process.env.MURPH_E2E_HEADED_BROWSER_SMOKE === "1";

describe("hosted headed browser boundary", () => {
  it.runIf(smokeEnabled)("launches Chromium headed inside the CI virtual display", async () => {
    const browser = await chromium.launch({ headless: false });
    try {
      expect(browser.isConnected()).toBe(true);
      const page = await browser.newPage();
      await page.setContent("<title>Hosted headed browser smoke</title>");
      await expect(page.title()).resolves.toBe("Hosted headed browser smoke");
    } finally {
      await browser.close();
    }
  });

  it.runIf(smokeEnabled)(
    "classifies consent actions with Playwright accessible names and frame scope",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.setContent(`
          <form>
            <button>Don't allow</button>
            <button hidden>Grant</button>
            <span id="grant-label">Grant access</span>
            <button aria-labelledby="grant-label" disabled></button>
            <input aria-label="Optional choice" type="checkbox" />
          </form>
          <iframe srcdoc='<button>Grant</button>'></iframe>
        `);
        await expect.poll(() => page.frames().length).toBe(2);

        let now = 0;
        const diagnosticPage = new Proxy(page, {
          get(target, property, receiver) {
            if (property === "url") {
              return () => "https://id.whoop.com/consent";
            }
            if (property === "waitForTimeout") {
              return async (duration: number) => {
                now += duration;
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const config = readHostedLocalJunctionBrowserConfigForTest({
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
        });

        let failure = "";
        try {
          await completeExternalJunctionAuthorizationForTest(
            diagnosticPage,
            config,
            () => now,
          );
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }

        const match = failure.match(/Authorization surface: (\{.*\})\.$/u);
        expect(match).not.toBeNull();
        const summary = JSON.parse(match?.[1] ?? "{}");
        expect(summary.actions).toEqual({
          negative: 1,
          positive: 3,
          positiveHidden: 1,
          positiveInChildFrames: 1,
          positiveVisible: 2,
          positiveVisibleDisabled: 1,
          positiveVisibleEnabled: 1,
          positiveVisibleEnabledInChildFrames: 1,
        });
        expect(summary.checkboxes).toEqual({
          total: 1,
          visible: 1,
          visibleChecked: 0,
          visibleUnchecked: 1,
        });
        expect(summary.formCount).toBe(1);
        expect(summary.frameCount).toBe(2);
        expect(failure).not.toMatch(
          /Don't allow|Grant access|aria-labelledby|browser-canary|opaque-password/u,
        );
      } finally {
        await browser.close();
      }
    },
  );
});
