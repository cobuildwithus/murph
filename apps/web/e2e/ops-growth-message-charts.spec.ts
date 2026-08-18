import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 900, label: "desktop", width: 1440 },
  { height: 844, label: "mobile", width: 390 },
] as const;

const CHART_NAMES = [
  "People who messaged Murph",
  "Total messages sent",
  "Messages sent per day",
  "Intake and activation",
  "Revenue snapshots",
  "Monthly revenue",
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

for (const viewport of VIEWPORTS) {
  test(`growth message charts expose truthful keyboard states on ${viewport.label}`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(viewport);
    await page.route("**/*", (route) => {
      if (isLoopbackUrl(route.request().url())) {
        route.continue();
      } else {
        route.abort();
      }
    });

    const response = await page.goto(
      "/screenshots/ops#ops-weekly-growth-compass",
      { waitUntil: "load" },
    );
    expect(response?.status(), "growth study should respond 200").toBe(200);

    const study = page.locator("#ops-weekly-growth-compass");
    const interactionBoundary = study.locator("..");
    await expect(study).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    });
    await page.waitForFunction(() => {
      const chartSurface = document.querySelector(
        "#ops-weekly-growth-compass .recharts-surface",
      );
      return chartSurface
        ? Object.keys(chartSurface).some((key) => key.startsWith("__reactFiber$"))
        : false;
    });
    await interactionBoundary.evaluate((element) =>
      element.removeAttribute("inert")
    );

    const chartCards = study.locator(
      "#growth-charts > div.grid > div",
    );
    const chartSurfaces = chartCards.locator(
      '.recharts-surface[role="application"][tabindex="0"]',
    );
    await expect(chartCards).toHaveCount(6);
    await expect(chartSurfaces).toHaveCount(6);

    for (const [index, name] of CHART_NAMES.entries()) {
      await expect(chartSurfaces.nth(index)).toHaveAccessibleName(name);
    }

    const referralLinkUsage = study.locator("#growth-referral-link-usage");
    const referralChart = referralLinkUsage.locator(
      '.recharts-surface[role="application"][tabindex="0"]',
    );
    await expect(referralLinkUsage).toContainText(
      "A use is counted when a recipient selects Join Murph",
    );
    await expect(referralLinkUsage).toContainText(
      "Page views, copied links, and shares are not tracked here",
    );
    await expect(referralLinkUsage).toContainText(
      "Counts reflect retained records, so account deletion can remove a claim or its referral attribution from this view",
    );
    await expect(referralLinkUsage).toContainText("Activated by capture");
    await expect(referralLinkUsage).toContainText(
      "Open cohorts; newer claims have less time",
    );
    await expect(referralLinkUsage).toContainText(
      "These cohorts remain open; newer claims have had less time to activate",
    );
    await expect(referralChart).toHaveAccessibleName("Daily claim cohorts");
    await expect(referralLinkUsage.locator(".recharts-bar")).toHaveCount(2);
    await expect(
      referralLinkUsage.locator(".recharts-bar").first().locator("path").first(),
    ).toHaveCSS("fill", "rgb(143, 117, 81)");

    const emptyReferralLinkUsage = study.locator(
      "#growth-referral-link-usage-empty",
    );
    await expect(emptyReferralLinkUsage).toContainText("N/A");
    await expect(emptyReferralLinkUsage).toContainText("No claims in window");
    await expect(emptyReferralLinkUsage).toContainText(
      "No retained referral claims were recorded in this 30-day window",
    );
    await expect(emptyReferralLinkUsage.locator(".recharts-surface")).toHaveCount(0);
    await expect(
      emptyReferralLinkUsage.locator('[role="application"][tabindex="0"]'),
    ).toHaveCount(0);

    const activityLines = chartCards.nth(0).locator(".recharts-line-curve");
    await expect(chartCards.nth(0)).toContainText(
      "Personal and owned-group rows are removed with account deletion",
    );
    await expect(chartCards.nth(0)).toContainText(
      "activity retained in another member's shared group follows normal content retention",
    );
    await expect(activityLines).toHaveCount(2);
    await expect.poll(
      () => activityLines.nth(0).getAttribute("stroke-dasharray"),
    ).toBeNull();
    await expect(activityLines.nth(1)).toHaveAttribute("stroke-dasharray", "6 4");

    const activityTooltip = chartCards.nth(0).locator(
      ".recharts-tooltip-wrapper",
    );
    await chartSurfaces.nth(0).focus();
    for (let index = 0; index < 18; index += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(activityTooltip).toBeVisible();
    await expect(activityTooltip).toContainText("Jul 19");
    await expect(activityTooltip).toContainText("Messaged that day");
    await expect(activityTooltip).toContainText("Messaged in trailing 7 days");
    await expect(
      activityTooltip.getByText("84", { exact: true }),
    ).toHaveCount(2);

    const dailyTooltip = chartCards.nth(2).locator(
      ".recharts-tooltip-wrapper",
    );
    await chartSurfaces.nth(2).focus();
    await expect(dailyTooltip).toBeHidden();

    await chartSurfaces.nth(1).focus();
    await page.keyboard.press("Shift+Tab");
    const chartSurfaceCount = await chartSurfaces.count();
    for (let index = 0; index < chartSurfaceCount; index += 1) {
      await expect(chartSurfaces.nth(index)).toBeFocused();
      const focusStyle = await chartCards
        .nth(index)
        .locator('[data-slot="chart"]')
        .evaluate((element) => {
          const style = window.getComputedStyle(element);
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
          };
        });
      expect(focusStyle.outlineStyle).not.toBe("none");
      expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("Tab");
    }
    await expect(chartSurfaces.last()).not.toBeFocused();

    await chartSurfaces.nth(2).focus();
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(dailyTooltip).toBeVisible();
    await expect(dailyTooltip).toContainText("Jul 15");
    await expect(dailyTooltip).toContainText("Messages sent per day");
    await expect(dailyTooltip).toContainText("0");

    const monthlyRevenueTooltip = chartCards.nth(5).locator(
      ".recharts-tooltip-wrapper",
    );
    await chartSurfaces.nth(5).focus();
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(monthlyRevenueTooltip).toBeVisible();
    await expect(monthlyRevenueTooltip).toContainText("July 2026");
    await expect(monthlyRevenueTooltip).toContainText("month to date");
    await expect(monthlyRevenueTooltip).toContainText("Personal subscriptions");
    await expect(monthlyRevenueTooltip).toContainText("$118");
    await expect(monthlyRevenueTooltip).toContainText("Family subscriptions");
    await expect(monthlyRevenueTooltip).toContainText("$43");
    await expect(monthlyRevenueTooltip).toContainText("Group sponsorship");
    await expect(monthlyRevenueTooltip).toContainText("$15");
    await expect(monthlyRevenueTooltip).toContainText("Usage top-ups");
    await expect(monthlyRevenueTooltip).toContainText("$25");
    await expect(monthlyRevenueTooltip).toContainText("Total");
    await expect(monthlyRevenueTooltip).toContainText("$201");
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    await expect(monthlyRevenueTooltip).toContainText("April 2026");
    await expect(monthlyRevenueTooltip).toContainText(
      "Subscriptions (personal + family)",
    );
    await expect(monthlyRevenueTooltip).toContainText("$62");
    await expect(monthlyRevenueTooltip).toContainText("$72");
    await page.keyboard.press("ArrowLeft");
    await expect(monthlyRevenueTooltip).toContainText("March 2026");
    await expect(monthlyRevenueTooltip).not.toContainText("month to date");
    await expect(monthlyRevenueTooltip).toContainText("No snapshot");
    await expect(monthlyRevenueTooltip).toContainText("$8");
    await expect(monthlyRevenueTooltip).toContainText("Unavailable");

    const referralTooltip = referralLinkUsage.locator(
      ".recharts-tooltip-wrapper",
    );
    await referralChart.focus();
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(referralTooltip).toBeVisible();
    await expect(referralTooltip).toContainText("Jul 7");
    await expect(referralTooltip).toContainText("Join Murph claims");
    await expect(referralTooltip).toContainText("Activated by capture");
    const referralFocusStyle = await referralLinkUsage
      .locator('[data-slot="chart"]')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
        };
      });
    expect(referralFocusStyle.outlineStyle).not.toBe("none");
    expect(referralFocusStyle.outlineWidth).toBeGreaterThanOrEqual(2);

    await page.emulateMedia({ forcedColors: "active" });
    await expect(referralChart).toHaveAccessibleName("Daily claim cohorts");
    await expect(referralLinkUsage.locator(".recharts-bar")).toHaveCount(2);
    await expect(referralLinkUsage).toContainText("Join Murph claims");
    await expect(referralLinkUsage).toContainText("Activated by capture");
    await expect(activityLines.nth(1)).toHaveAttribute("stroke-dasharray", "6 4");
    await chartSurfaces.nth(1).focus();
    await page.keyboard.press("Shift+Tab");
    const forcedColorFocus = await chartCards
      .first()
      .locator('[data-slot="chart"]')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
        };
      });
    expect(forcedColorFocus.outlineStyle).not.toBe("none");
    expect(forcedColorFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  });
}
