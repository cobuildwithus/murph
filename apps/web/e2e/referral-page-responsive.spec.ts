import { expect, test } from "@playwright/test";

const WIDTHS = [320, 375, 390, 768, 1280] as const;
const GROUP_STUDY_WIDTHS = [390, 1440] as const;
const OVERFLOW_TOLERANCE_PX = 1;

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

test("referral page stays contained and actionable at every marketing breakpoint", async ({
  page,
}) => {
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

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto("/refer", { waitUntil: "load" });
    expect(response?.status(), `/refer should respond 200 at ${width}px`).toBe(
      200,
    );
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });

    const overflowPx = await page.evaluate(() =>
      document.documentElement.scrollWidth
      - document.documentElement.clientWidth
    );
    expect(
      overflowPx,
      `/refer should not overflow horizontally at ${width}px`,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    await expect(
      page.getByRole("heading", {
        name: "Earn more Murph time.",
      }),
    ).toBeVisible();
    const primaryAction = page
      .getByRole("button", { name: /Join Murph to start referring/ })
      .first();
    await expect(primaryAction).toBeVisible();
    const actionBox = await primaryAction.boundingBox();
    expect(
      actionBox?.height ?? 0,
      `primary referral action should stay touchable at ${width}px`,
    ).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole("heading", {
        name: "Choose a referral path.",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("$3.50 of cost-weighted usage credit", { exact: true }),
    ).toBeVisible();
  }
});

test.describe("group-only referral design proof", () => {
  test.use({ deviceScaleFactor: 2 });

  test("group-only homepage referral study shows both concise rewards", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

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

    for (const width of GROUP_STUDY_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto("/design?tab=sections", {
        waitUntil: "load",
      });
      expect(
        response?.status(),
        `/design should respond 200 at ${width}px`,
      ).toBe(200);

      const study = page.locator(
        '[data-design-section="homepage-referral-program-group-only"]',
      );
      await expect(study).toBeVisible();
      await expect(study.locator("article")).toHaveCount(2);
      await expect(
        study.getByText("Bring someone new to Murph", { exact: true }),
      ).toBeVisible();
      await expect(
        study.getByText("Start an active group", { exact: true }),
      ).toBeVisible();
      await expect(
        study.getByText("≈10 days of Murph", { exact: true }),
      ).toBeVisible();
      await expect(
        study.getByText("≈14 days of Murph", { exact: true }),
      ).toBeVisible();
      await expect(study.getByText(/If eligible/)).toHaveCount(0);

      const overflowPx = await study.evaluate((element) =>
        element.scrollWidth - element.clientWidth
      );
      expect(
        overflowPx,
        `group-only referral study should not overflow at ${width}px`,
      ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

      const screenshotPath = testInfo.outputPath(
        `homepage-referral-group-${width}.png`,
      );
      await study.locator("section > div").first().screenshot({
        path: screenshotPath,
      });
      await testInfo.attach(`homepage-referral-group-${width}`, {
        contentType: "image/png",
        path: screenshotPath,
      });
    }
  });
});
