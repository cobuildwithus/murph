import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  completeExternalJunctionAuthorizationForTest,
  disconnectHostedLocalJunctionAccountForTest,
  readHostedLocalJunctionBrowserConfigForTest,
} from "../scripts/run-hosted-local-junction-wearable-browser";

const smokeEnabled = process.env.MURPH_E2E_HEADED_BROWSER_SMOKE === "1";

function createWhoopConfig() {
  return readHostedLocalJunctionBrowserConfigForTest({
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
}

function createGarminConfig() {
  return readHostedLocalJunctionBrowserConfigForTest({
    CI: "1",
    NODE_ENV: "test",
    MURPH_E2E_CONNECT_URL:
      "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
    MURPH_E2E_HOSTED_SESSION_COOKIE: "opaque-session",
    MURPH_E2E_PROVIDER_EMAIL: "browser-canary@example.invalid",
    MURPH_E2E_PROVIDER_HEADLESS: "0",
    MURPH_E2E_PROVIDER_PASSWORD: "opaque-password",
    MURPH_E2E_PROVIDER_SOURCE: "garmin",
    MURPH_E2E_PROVIDER_TIMEOUT_MS: "30000",
    MURPH_E2E_WEB_BASE_URL: "https://app.example.test",
  });
}

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
    "waits for the reloaded connect page before disconnecting Garmin",
    async () => {
      const browser = await chromium.launch({ headless: false });
      let releaseLoad: (() => void) | undefined;
      const loadGate = new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      try {
        const page = await browser.newPage();
        await page.route("https://app.example.test/hold-load", async (route) => {
          await loadGate;
          await route.fulfill({ body: "", contentType: "image/png" });
        });
        await page.route("https://app.example.test/connect", (route) =>
          route.fulfill({
            body: [
              "<main>",
              "<div>",
              "<h2>Garmin</h2>",
              '<span data-connection-state="connected" ',
              'style="display:block;width:1px;height:1px"></span>',
              '<button aria-label="Disconnect account">Disconnect</button>',
              "</div>",
              '<div id="dialog-root"></div>',
              '<div id="notice"></div>',
              "</main>",
              "<script>",
              "window.disconnectClickAttempts = 0;",
              "document.addEventListener('click', (event) => {",
              "if (event.target.closest('[aria-label=\"Disconnect account\"]')) {",
              "window.disconnectClickAttempts += 1;",
              "}",
              "}, true);",
              "window.addEventListener('load', () => {",
              "document.querySelector('[aria-label=\"Disconnect account\"]')",
              ".addEventListener('click', () => {",
              "document.querySelector('#dialog-root').innerHTML = [",
              "'<div role=\"dialog\">',",
              "'<h2>Disconnect account?</h2>',",
              "'<button>Disconnect</button>',",
              "'</div>',",
              "].join('');",
              "document.querySelector('[role=\"dialog\"] button')",
              ".addEventListener('click', () => {",
              "document.querySelector('#notice').textContent = 'Source disconnected';",
              "document.querySelector('[data-connection-state]')",
              ".setAttribute('data-connection-state', 'idle');",
              "});",
              "});",
              "});",
              "</script>",
              '<img src="https://app.example.test/hold-load" alt="">',
            ].join(""),
            contentType: "text/html",
          })
        );
        await page.goto("https://app.example.test/connect", {
          waitUntil: "domcontentloaded",
        });

        const cleanup = disconnectHostedLocalJunctionAccountForTest(
          page,
          createGarminConfig(),
        );
        await expect(page.getByRole("button", { name: "Disconnect account" }).isVisible())
          .resolves.toBe(true);
        await expect(page.getByRole("dialog").count()).resolves.toBe(0);
        await expect(page.evaluate(() => Reflect.get(
          window,
          "disconnectClickAttempts",
        ))).resolves.toBe(0);

        releaseLoad?.();
        await expect(cleanup).resolves.toBeUndefined();
        await expect(page.evaluate(() => Reflect.get(
          window,
          "disconnectClickAttempts",
        ))).resolves.toBe(1);
        await expect(page.getByText("Source disconnected", { exact: true }).isVisible())
          .resolves.toBe(true);
        await expect(page.locator('[data-connection-state="idle"]').count())
          .resolves.toBe(1);
      } finally {
        releaseLoad?.();
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "completes Garmin's exact two-step consent flow",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://connect.garmin.com/**", (route) => {
          const url = new URL(route.request().url());
          const progressed = url.searchParams.has("permissionsUpdated")
            && url.searchParams.has("selectedCapabilities");
          return route.fulfill({
            body: progressed
              ? [
                '<button onclick="setTimeout(() => location.href=\'https://app.example.test/home\', 750)">',
                "Agree</button>",
                '<button onclick="location.href=\'https://app.example.test/declined\'">',
                "Do Not Agree</button>",
              ].join("")
              : [
                '<input type="checkbox">',
                '<input type="checkbox">',
                '<input type="checkbox">',
                '<button id="save">Save</button>',
                '<button onclick="location.href=\'https://app.example.test/cancel\'">',
                "Cancel</button>",
                "<script>",
                "document.querySelector('#save').addEventListener('click', () => {",
                "const allChecked = [...document.querySelectorAll('input[type=checkbox]')]",
                ".every((input) => input.checked);",
                "location.href = allChecked",
                "? 'https://connect.garmin.com/partner/oauthConfirm",
                "?oauth_token=opaque&oauth_callback=opaque",
                "&permissionsUpdated=1&selectedCapabilities=opaque'",
                ": 'https://app.example.test/incomplete';",
                "});",
                "</script>",
              ].join(""),
            contentType: "text/html",
          });
        });
        await page.route("https://app.example.test/**", (route) => route.fulfill({
          body: "",
          contentType: "text/html",
        }));
        await page.goto([
          "https://connect.garmin.com/partner/oauthConfirm",
          "?oauth_token=opaque&oauth_callback=opaque",
        ].join(""));

        await expect(completeExternalJunctionAuthorizationForTest(
          page,
          createGarminConfig(),
        )).resolves.toBeUndefined();
        expect(new URL(page.url()).pathname).toBe("/home");
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "does not authorize an exact-looking Garmin consent surface on another route",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://connect.garmin.com/**", (route) => route.fulfill({
          body: [
            '<input type="checkbox">',
            '<input type="checkbox">',
            '<input type="checkbox">',
            '<button onclick="location.href=\'https://app.example.test/unexpected\'">',
            "Save</button>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.route("https://app.example.test/**", (route) => route.fulfill({
          body: "",
          contentType: "text/html",
        }));
        await page.goto("https://connect.garmin.com/partner/oauthReview");
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

        await expect(completeExternalJunctionAuthorizationForTest(
          timedPage,
          createGarminConfig(),
          () => now,
        )).rejects.toThrow(
          "Garmin did not expose an automated authorization action.",
        );
        await expect(page.locator('input[type="checkbox"]:checked').count())
          .resolves.toBe(0);
        expect(new URL(page.url()).pathname).toBe("/partner/oauthReview");
        expect(now).toBe(15_000);
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "keeps a failed Garmin consent checkbox action content-free",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(1_000);
        await page.route("https://connect.garmin.com/**", (route) => route.fulfill({
          body: [
            '<input type="checkbox">',
            '<input type="checkbox">',
            '<input type="checkbox">',
            "<button>Save</button>",
            '<div style="position:fixed;inset:0;z-index:1">',
            "overlay-synthetic-private-marker</div>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.goto("https://connect.garmin.com/partner/oauthConfirm");

        let failure: Error | undefined;
        try {
          await completeExternalJunctionAuthorizationForTest(
            page,
            createGarminConfig(),
          );
        } catch (error) {
          if (error instanceof Error) failure = error;
        }
        expect(failure?.message).toBe(
          "Authorization consent selection failed (timeout).",
        );
        expect(failure?.message).not.toContain("synthetic-private-marker");
        expect(failure?.message).not.toContain("connect.garmin.com");
        expect(failure?.message).not.toContain("browser-canary@example.invalid");
        expect(failure?.message).not.toContain("opaque-password");
      } finally {
        await browser.close();
      }
    },
    120_000,
  );

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
            '<button>Proceed synthetic-private-marker</button>',
            '<a href="#">Privacy policy synthetic-private-marker</a>',
            '<iframe srcdoc="<button>Authorize synthetic-private-marker</button>',
            '<button>Proceed synthetic-private-marker</button>',
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

        const config = createWhoopConfig();
        const readFailure = async (subjectPage: typeof page) => {
          let now = 0;
          const timedPage = new Proxy(subjectPage, {
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
          return { failure, now };
        };

        const complex = await readFailure(page);
        expect(complex.failure?.message).toContain([
          "Authorization surface: childFrames=1 mainActions=1",
          "mainEnabledActions=0 mainOtherActions=2 childActions=1",
          "childEnabledActions=1 childOtherActions=1",
          "mainUncheckedCheckboxes=0 childUncheckedCheckboxes=1.",
        ].join(" "));
        expect(complex.failure?.message).not.toContain("synthetic-private-marker");
        expect(complex.failure?.message).not.toContain("id.whoop.com");
        expect(complex.failure?.message).not.toContain("browser-canary@example.invalid");
        expect(complex.failure?.message).not.toContain("opaque-password");
        expect(complex.now).toBe(15_000);

        const emptyPage = await browser.newPage();
        await emptyPage.route("https://id.whoop.com/empty", (route) =>
          route.fulfill({ body: "", contentType: "text/html" })
        );
        await emptyPage.goto("https://id.whoop.com/empty");
        const empty = await readFailure(emptyPage);

        const unknownPage = await browser.newPage();
        await unknownPage.route("https://id.whoop.com/unknown", (route) =>
          route.fulfill({
            body: "<button>Proceed synthetic-private-marker</button>",
            contentType: "text/html",
          })
        );
        await unknownPage.goto("https://id.whoop.com/unknown");
        const unknown = await readFailure(unknownPage);

        expect(empty.failure?.message).toContain(
          "mainOtherActions=0 childActions=0",
        );
        expect(unknown.failure?.message).toContain(
          "mainOtherActions=1 childActions=0",
        );
        expect(unknown.failure?.message).not.toContain("synthetic-private-marker");
      } finally {
        await browser.close();
      }
    },
    120_000,
  );

  it.runIf(smokeEnabled)(
    "keeps WHOOP rendered GRANT bound to one denial-safe live button",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://id.whoop.com/**", (route) => route.fulfill({
          body: [
            '<span id="deny-label">Cancel data access</span>',
            '<button aria-labelledby="deny-label" ',
            'onclick="location.href=\'https://app.example.test/negative\'">',
            "GRANT</button>",
            '<button aria-label="Review hidden value" value="GRANT" ',
            'onclick="location.href=\'https://app.example.test/hidden\'">',
            "Review data access</button>",
            '<button aria-label="Review requested data access" ',
            'onclick="location.href=\'https://app.example.test/home\'">',
            "GRANT</button>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.route("https://app.example.test/**", (route) => route.fulfill({
          body: "",
          contentType: "text/html",
        }));
        await page.goto("https://id.whoop.com/consent");

        await expect(completeExternalJunctionAuthorizationForTest(
          page,
          createWhoopConfig(),
        )).resolves.toBeUndefined();
        expect(new URL(page.url()).pathname).toBe("/home");
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "keeps a failed WHOOP consent click content-free",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(1_000);
        await page.route("https://id.whoop.com/**", (route) => route.fulfill({
          body: [
            '<button aria-label="Review synthetic-private-marker access">',
            "GRANT</button>",
            '<div style="position:fixed;inset:0;z-index:1">',
            "overlay-synthetic-private-marker</div>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.goto("https://id.whoop.com/consent");

        let failure: Error | undefined;
        try {
          await completeExternalJunctionAuthorizationForTest(
            page,
            createWhoopConfig(),
          );
        } catch (error) {
          if (error instanceof Error) failure = error;
        }
        expect(failure?.message).toBe("Authorization action failed (timeout).");
        expect(failure?.message).not.toContain("synthetic-private-marker");
        expect(failure?.message).not.toContain("id.whoop.com");
      } finally {
        await browser.close();
      }
    },
    120_000,
  );
});
