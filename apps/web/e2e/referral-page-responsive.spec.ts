import { expect, test } from "@playwright/test";

const WIDTHS = [320, 375, 390, 768, 1280] as const;
const REFERRAL_STUDY_WIDTHS = [390, 1440] as const;
const OVERFLOW_TOLERANCE_PX = 1;
const REFERRAL_STUDIES = [
  {
    dayLabels: [
      { count: 2, label: "About 10 more days of Murph usage" },
      { count: 1, label: "About 14 more days of Murph usage" },
    ],
    description: "Share your link or start a group with Murph.",
    rewardCount: 3,
    selector: '[data-design-section="homepage-referral-program"]',
    slug: "mixed",
    titles: [
      "Invite someone to Murph",
      "Bring someone new to Murph",
      "Start an active group",
    ],
  },
  {
    dayLabels: [
      { count: 1, label: "About 10 more days of Murph usage" },
      { count: 1, label: "About 14 more days of Murph usage" },
    ],
    description: "Start a fresh group with Murph.",
    rewardCount: 2,
    selector:
      '[data-design-section="homepage-referral-program-group-only"]',
    slug: "group-only",
    titles: ["Bring someone new to Murph", "Start an active group"],
  },
  {
    dayLabels: [
      { count: 1, label: "About 10 more days of Murph usage" },
    ],
    description: "Share your personal link with someone new.",
    rewardCount: 1,
    selector:
      '[data-design-section="homepage-referral-program-signup-only"]',
    slug: "signup-only",
    titles: ["Invite someone to Murph"],
  },
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
      page.getByText("About 14 more days of Murph usage", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /\$|≈|cost-weighted|usage credit/i,
    );
  }
});

test("referral design study hydrates without reading a member referral link", async ({
  page,
}) => {
  const referralLinkRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/settings/signup-referral-link") {
      referralLinkRequests.push(request.url());
    }
  });
  await page.route("**/*", (route) => {
    if (isLoopbackUrl(route.request().url())) {
      route.continue();
    } else {
      route.abort();
    }
  });

  const response = await page.goto(
    "/design?tab=sections#referral-rewards-page",
    { waitUntil: "networkidle" },
  );
  expect(response?.status()).toBe(200);

  const study = page.locator("#referral-rewards-page");
  await expect(study).toBeVisible();
  await expect(
    study.getByText("About 10 more days of Murph usage", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    study.getByRole("button", { name: /Join Murph to start referring/ }).first(),
  ).toBeVisible();
  await expect(study).not.toContainText(/\$|≈|cost-weighted|usage credit/i);
  expect(referralLinkRequests).toEqual([]);
});

test.describe("homepage referral design proof", () => {
  test.use({ deviceScaleFactor: 2 });

  test("every homepage referral state stays concise and complete", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

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

    for (const width of REFERRAL_STUDY_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto("/design?tab=sections", {
        waitUntil: "load",
      });
      expect(
        response?.status(),
        `/design should respond 200 at ${width}px`,
      ).toBe(200);
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });

      for (const expected of REFERRAL_STUDIES) {
        const study = page.locator(expected.selector);
        await expect(study).toBeVisible();
        await expect(study.locator("article")).toHaveCount(
          expected.rewardCount,
        );
        await expect(
          study.getByText(expected.description, { exact: true }),
        ).toBeVisible();
        await expect(
          study.getByRole("link", { name: "See ways to earn" }),
        ).toBeVisible();
        for (const title of expected.titles) {
          await expect(study.getByText(title, { exact: true })).toBeVisible();
        }
        for (const dayLabel of expected.dayLabels) {
          await expect(
            study.getByText(dayLabel.label, { exact: true }),
          ).toHaveCount(dayLabel.count);
        }
        await expect(study.getByText(/If eligible/)).toHaveCount(0);
        await expect(study).not.toContainText(
          /\$|≈|cost-weighted|usage credit/i,
        );

        const overflowPx = await study.evaluate((element) =>
          element.scrollWidth - element.clientWidth
        );
        expect(
          overflowPx,
          `${expected.slug} referral study should not overflow at ${width}px`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

        const screenshotPath = testInfo.outputPath(
          `homepage-referral-${expected.slug}-${width}.png`,
        );
        await study.locator("section > div").first().screenshot({
          path: screenshotPath,
        });
        await testInfo.attach(
          `homepage-referral-${expected.slug}-${width}`,
          {
            contentType: "image/png",
            path: screenshotPath,
          },
        );
      }
    }
  });
});
