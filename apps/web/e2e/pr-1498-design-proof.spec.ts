import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

const DESIGN_ROUTE = "/design?tab=sections#signup-referral-signed-in-recovery";
const STUDY_SELECTOR = '[data-design-section="signup-referral-signed-in-recovery"]';

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
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent =
      "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
    (document.head ?? document.documentElement).appendChild(style);
  });
}

async function captureStudy({
  browser,
  fileName,
  height,
  outputDir,
  width,
}: {
  browser: Browser;
  fileName: string;
  height: number;
  outputDir: string;
  width: number;
}): Promise<void> {
  const context = await browser.newContext({
    colorScheme: "light",
    reducedMotion: "reduce",
    viewport: { width, height },
  });
  const page = await context.newPage();
  try {
    await preparePage(page);
    const response = await page.goto(DESIGN_ROUTE, { waitUntil: "load" });
    expect(response?.status(), "design study should respond 200").toBe(200);

    const study = page.locator(STUDY_SELECTOR);
    await expect(study).toHaveCount(1);
    await expect(study).toBeVisible();
    await study.scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });

    await study.screenshot({
      animations: "disabled",
      path: path.join(outputDir, fileName),
    });
  } finally {
    await context.close();
  }
}

test("capture signed-in invite recovery design proof", async ({ browser }) => {
  test.skip(
    !process.env.DESIGN_PROOF_OUTPUT_DIR,
    "Run only in the dedicated design-proof capture workflow",
  );
  test.setTimeout(300_000);
  const outputDir = process.env.DESIGN_PROOF_OUTPUT_DIR;
  expect(outputDir, "DESIGN_PROOF_OUTPUT_DIR is required").toBeTruthy();
  await mkdir(outputDir!, { recursive: true });

  await captureStudy({
    browser,
    fileName: "desktop.png",
    height: 1000,
    outputDir: outputDir!,
    width: 1440,
  });
  await captureStudy({
    browser,
    fileName: "mobile.png",
    height: 844,
    outputDir: outputDir!,
    width: 390,
  });
});
