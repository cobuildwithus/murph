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
    "reports Playwright authorization semantics across frames without content",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://id.whoop.com/**", (route) => route.fulfill({
          body: [
            '<span id="continue-label">Continue synthetic-private-marker</span>',
            '<div style="width:10px;height:10px" role="button"',
            ' aria-labelledby="continue-label" aria-disabled="true"></div>',
            '<a href="#">Privacy policy synthetic-private-marker</a>',
            '<iframe srcdoc="<button>Authorize synthetic-private-marker</button>',
            '<input type=checkbox aria-label=&quot;Required consent',
            ' synthetic-private-marker&quot;>"></iframe>',
          ].join(""),
          contentType: "text/html",
        }));
        await page.goto("https://id.whoop.com/sign-in");
        await page.waitForFunction(() =>
          document.querySelector("iframe")?.contentDocument?.readyState === "complete"
        );
        await expect(page.getByRole("button", { name: /continue/iu }).isEnabled())
          .resolves.toBe(false);

        let now = 0;
        const timedPage = new Proxy(page, {
          get(target, property) {
            if (property === "waitForTimeout") {
              return async (duration: number) => {
                now += duration;
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const config = readHostedLocalJunctionBrowserConfigForTest({
          CI: "1",
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

        let failure: Error | undefined;
        try {
          await completeExternalJunctionAuthorizationForTest(
            timedPage,
            config,
            () => now,
          );
        } catch (error) {
          if (error instanceof Error) failure = error;
        }

        expect(failure?.message).toContain([
          "Authorization surface: childFrames=1 mainActions=1",
          "mainEnabledActions=0 childActions=1 childEnabledActions=1",
          "mainUncheckedCheckboxes=0 childUncheckedCheckboxes=1.",
        ].join(" "));
        expect(failure?.message).not.toContain("synthetic-private-marker");
        expect(failure?.message).not.toContain("id.whoop.com");
        expect(failure?.message).not.toContain("browser-canary@example.invalid");
        expect(failure?.message).not.toContain("opaque-password");
        expect(now).toBe(15_000);
      } finally {
        await browser.close();
      }
    },
  );
});
