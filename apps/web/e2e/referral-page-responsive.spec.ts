import { expect, test } from "@playwright/test";

const WIDTHS = [320, 375, 390, 768, 1280] as const;
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
      page.getByText("About 14 more days of Murph usage", { exact: true }),
    ).toBeVisible();
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
  expect(referralLinkRequests).toEqual([]);
});
