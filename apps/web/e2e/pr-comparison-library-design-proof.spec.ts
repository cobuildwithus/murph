import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { COMPARISONS } from "../src/lib/comparisons/catalog";

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

function colorChannels(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received ${value}.`);
  }
  return channels as [number, number, number];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linearize(red)
    + 0.7152 * linearize(green)
    + 0.0722 * linearize(blue);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(colorChannels(foreground));
  const backgroundLuminance = relativeLuminance(colorChannels(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
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
        await expect(search).toBeEnabled();
        const searchColors = await search.evaluate((input) => {
          let paintedBackground = "";
          let current: Element | null = input;
          while (current) {
            const candidate = getComputedStyle(current).backgroundColor;
            if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
              paintedBackground = candidate;
              break;
            }
            current = current.parentElement;
          }
          return {
            background: paintedBackground,
            placeholder: getComputedStyle(input, "::placeholder").color,
          };
        });
        expect(
          contrastRatio(searchColors.placeholder, searchColors.background),
          "search placeholder should meet WCAG AA contrast",
        ).toBeGreaterThanOrEqual(4.5);
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

test("comparison directory stays browsable without JavaScript", async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Comparison no-JavaScript proof requires a Playwright baseURL.");
  }

  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();

  try {
    await preparePage(page);
    const response = await page.goto("/compare", { waitUntil: "load" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#comparison-search")).toBeDisabled();
    await expect(
      page.locator('[data-comparison-directory] a[href^="/compare/murph-vs-"]'),
    ).toHaveCount(COMPARISONS.length);
    await expect(
      page.getByRole("navigation", { name: "Comparison categories" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
