import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 900, label: "desktop", width: 1440 },
  { height: 844, label: "mobile", width: 390 },
] as const;

const CHART_NAMES = [
  "People who messaged Murph",
  "Total messages sent",
  "Messages sent per day",
  "Acquisition",
  "Revenue snapshots",
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
      "/design?tab=sections#ops-weekly-growth-compass",
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
    await expect(chartCards).toHaveCount(5);
    await expect(chartSurfaces).toHaveCount(5);

    for (const [index, name] of CHART_NAMES.entries()) {
      await expect(chartSurfaces.nth(index)).toHaveAccessibleName(name);
    }

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

    await page.emulateMedia({ forcedColors: "active" });
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
