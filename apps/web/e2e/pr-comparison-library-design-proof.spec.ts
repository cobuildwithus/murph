import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

const PAGES = [
  { name: "index", route: "/compare" },
  { name: "whoop", route: "/compare/murph-vs-whoop" },
  { name: "bodybuddy", route: "/compare/murph-vs-bodybuddy" },
] as const;

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

async function preparePage(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    if (isLoopbackUrl(route.request().url())) {
      route.continue();
    } else {
      route.abort();
    }
  });
}

async function capturePages({
  browser,
  height,
  outputDir,
  suffix,
  width,
}: {
  browser: Browser;
  height: number;
  outputDir: string;
  suffix: string;
  width: number;
}) {
  const context = await browser.newContext({
    colorScheme: "light",
    reducedMotion: "reduce",
    viewport: { height, width },
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text() !== "Failed to load resource: net::ERR_FAILED"
    ) {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  try {
    await preparePage(page);

    for (const target of PAGES) {
      const response = await page.goto(target.route, { waitUntil: "load" });
      expect(response?.status(), `${target.route} should respond 200`).toBe(200);
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });

      await page.screenshot({
        animations: "disabled",
        caret: "initial",
        fullPage: true,
        path: path.join(outputDir, `${target.name}-${suffix}-full.png`),
      });

      const hero = page.locator(target.name === "index" ? "main > header" : "article > header");
      await expect(hero).toBeVisible();
      await hero.screenshot({
        animations: "disabled",
        caret: "initial",
        path: path.join(outputDir, `${target.name}-${suffix}-hero.png`),
      });

      if (target.name !== "index") {
        const tableSection = page.locator('section[aria-labelledby$="-table"]');
        await expect(tableSection).toBeVisible();
        await tableSection.screenshot({
          animations: "disabled",
          caret: "initial",
          path: path.join(outputDir, `${target.name}-${suffix}-table.png`),
        });
      }
    }
    expect(browserErrors, "comparison pages should not emit browser errors").toEqual([]);
  } finally {
    await context.close();
  }
}

test("capture comparison library design proof", async ({ browser }) => {
  test.skip(
    !process.env.DESIGN_PROOF_OUTPUT_DIR,
    "Run only in the dedicated design-proof capture workflow",
  );
  test.setTimeout(600_000);
  const outputDir = process.env.DESIGN_PROOF_OUTPUT_DIR;
  if (!outputDir) {
    return;
  }
  await mkdir(outputDir, { recursive: true });

  await capturePages({
    browser,
    height: 1_000,
    outputDir,
    suffix: "desktop",
    width: 1_440,
  });
  await capturePages({
    browser,
    height: 844,
    outputDir,
    suffix: "mobile",
    width: 390,
  });
});
