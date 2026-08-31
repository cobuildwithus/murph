import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

const PAGES = [
  { name: "index", route: "/compare" },
  { name: "whoop", route: "/compare/murph-vs-whoop" },
  { name: "bodybuddy", route: "/compare/murph-vs-bodybuddy" },
  { name: "commonhealth", route: "/compare/murph-vs-commonhealth" },
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
    const messageText = message.text();
    const isBlockedLocalVercelTelemetry =
      messageText.includes("https://va.vercel-scripts.com/v1/")
      && messageText.includes("violates the following Content Security Policy directive");

    if (
      message.type() === "error" &&
      messageText !== "Failed to load resource: net::ERR_FAILED" &&
      !isBlockedLocalVercelTelemetry
    ) {
      browserErrors.push(messageText);
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
        document
          .querySelectorAll("nextjs-portal")
          .forEach((element) => element.remove());
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

      if (target.name === "index") {
        const directory = page.locator("[data-comparison-directory]");
        const search = page.locator("#comparison-search");
        await expect(directory).toBeVisible();
        await expect(search).toHaveAccessibleName("Find your comparison");
        await directory.screenshot({
          animations: "disabled",
          caret: "initial",
          path: path.join(outputDir, `${target.name}-${suffix}-directory.png`),
        });

        await search.fill("WW");
        await expect(
          page.getByRole("link", { name: "Compare Murph with Weight Watchers" }),
        ).toBeVisible();
        await directory.screenshot({
          animations: "disabled",
          caret: "initial",
          path: path.join(outputDir, `${target.name}-${suffix}-search.png`),
        });

        await search.fill("no matching health product");
        await expect(page.getByText("No comparison found.")).toBeVisible();
        await directory.screenshot({
          animations: "disabled",
          caret: "initial",
          path: path.join(outputDir, `${target.name}-${suffix}-search-empty.png`),
        });
        const clearSearch = page.getByRole("button", {
          name: "Clear comparison search",
        });
        await clearSearch.focus();
        await page.keyboard.press("Enter");
        await expect(search).toBeFocused();
        await expect(search).toHaveValue("");
      }

      if (target.name !== "index") {
        const tableSection = page.locator('section[aria-labelledby$="-table"]');
        await expect(tableSection).toBeVisible();
        const sourceLinks = tableSection.getByRole("link", {
          name: /^Open source/u,
        });
        expect(await sourceLinks.count()).toBeGreaterThan(0);
        for (const sourceLink of await sourceLinks.all()) {
          const bounds = await sourceLink.boundingBox();
          expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(24);
          expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(24);
        }
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
