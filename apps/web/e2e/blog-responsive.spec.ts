import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PROOF_DIRECTORY = process.env.DESIGN_PROOF_OUTPUT_DIR?.trim() ?? null;
const OVERFLOW_TOLERANCE_PX = 1;

test.use({ deviceScaleFactor: 2, reducedMotion: "reduce" });

test.beforeAll(async () => {
  if (PROOF_DIRECTORY) {
    await mkdir(PROOF_DIRECTORY, { recursive: true });
  }
});

for (const study of [
  { id: "blog-archive", name: "archive" },
  { id: "blog-article", name: "article" },
] as const) {
  test(`${study.name} stays readable at desktop and mobile sizes`, async ({
    page,
  }) => {
    test.skip(
      !PROOF_DIRECTORY,
      "Run with DESIGN_PROOF_OUTPUT_DIR to capture the blog design proof.",
    );
    test.setTimeout(120_000);
    await keepRequestsLocal(page);

    for (const viewport of [
      { height: 1000, name: "desktop", width: 1440 },
      { height: 900, name: "mobile", width: 390 },
    ] as const) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      const response = await page.goto(
        `/design?tab=sections#${study.id}`,
        { waitUntil: "load" },
      );
      if (response) {
        expect(response.status()).toBe(200);
      } else {
        expect(new URL(page.url()).pathname).toBe("/design");
      }
      await page.addStyleTag({
        content: "nextjs-portal { display: none !important; }",
      });

      const surface = page.locator(`[data-design-section="${study.id}"]`);
      await expect(surface).toBeVisible();
      await surface.scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });

      const overflow = await surface.evaluate((element) => ({
        document: document.documentElement.scrollWidth
          - document.documentElement.clientWidth,
        surface: element.scrollWidth - element.clientWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
      expect(overflow.surface).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      await captureStudyProof({
        fileName: `${study.name}-${viewport.name}.png`,
        page,
        proofDirectory: PROOF_DIRECTORY,
        selector: `[data-design-section="${study.id}"]`,
        viewportWidth: viewport.width,
      });
    }
  });
}

async function captureStudyProof(input: {
  fileName: string;
  page: Page;
  proofDirectory: string | null;
  selector: string;
  viewportWidth: number;
}) {
  if (!input.proofDirectory) {
    throw new TypeError("DESIGN_PROOF_OUTPUT_DIR is required.");
  }
  const bounds = await input.page.locator(input.selector).boundingBox();
  if (!bounds) {
    throw new TypeError(`Could not measure ${input.selector}.`);
  }
  const clipWidth = Math.min(
    input.viewportWidth === 390 ? 390 : 1_200,
    bounds.width,
  );
  const clipHeight = Math.min(
    input.viewportWidth === 390 ? 1_150 : 1_000,
    bounds.height,
  );

  await input.page.screenshot({
    animations: "disabled",
    clip: {
      height: clipHeight,
      width: clipWidth,
      x: Math.max(0, bounds.x + (bounds.width - clipWidth) / 2),
      y: bounds.y,
    },
    path: path.join(input.proofDirectory, input.fileName),
  });
}

async function keepRequestsLocal(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    (document.head ?? document.documentElement).appendChild(style);
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      route.continue();
    } else {
      route.abort();
    }
  });
}
