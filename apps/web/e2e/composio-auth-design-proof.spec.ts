import { expect, test } from "@playwright/test";

const DESIGN_ROUTE =
  "/design?tab=sections#connected-app-authorization-handoff";
const STUDY_SELECTOR =
  '[data-design-section="connected-app-authorization-handoff"]';

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "127.0.0.1"
      || hostname === "localhost"
      || hostname === "[::1]";
  } catch {
    return false;
  }
}

for (const proof of [
  {
    name: "desktop",
    path: "design-proof/composio-auth-desktop.png",
    viewport: { height: 1_000, width: 1_440 },
  },
  {
    name: "mobile",
    path: "design-proof/composio-auth-mobile.png",
    viewport: { height: 844, width: 390 },
  },
] as const) {
  test(`capture Composio authorization ${proof.name} design proof`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      viewport: proof.viewport,
    });
    const page = await context.newPage();

    try {
      await page.route("**/*", (route) => {
        if (isLoopbackUrl(route.request().url())) {
          route.continue();
        } else {
          route.abort();
        }
      });
      await page.addInitScript(() => {
        const style = document.createElement("style");
        style.textContent =
          "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
        (document.head ?? document.documentElement).appendChild(style);
      });

      const response = await page.goto(DESIGN_ROUTE, { waitUntil: "load" });
      expect(response?.status()).toBe(200);
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });

      const study = page.locator(STUDY_SELECTOR);
      await expect(study).toBeVisible();
      await study.screenshot({ path: proof.path });
    } finally {
      await context.close();
    }
  });
}
