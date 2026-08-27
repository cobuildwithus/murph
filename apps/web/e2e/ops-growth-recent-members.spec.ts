import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 900, label: "desktop", width: 1440 },
  { height: 844, label: "mobile", width: 390 },
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
  test(`recent-member retention stays truthful and usable on ${viewport.label}`, async ({
    page,
  }, testInfo) => {
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
      "/screenshots/ops#growth-recent-member-retention",
      { waitUntil: "load" },
    );
    expect(response?.status(), "growth study should respond 200").toBe(200);
    const study = page.locator("#growth-recent-member-retention");
    await study.scrollIntoViewIfNeeded();
    await expect(study).toBeVisible();
    await expect(study.getByRole("heading", {
      name: "Recent member retention",
    })).toBeVisible();
    await expect(study).toContainText("personal conversations");
    await expect(study).toContainText("Today is the current UTC day");
    await expect(study).toContainText("Active today");
    await expect(study).toContainText("Active in 7d");
    await expect(study).toContainText("No activity in 7d");
    await expect(study).toContainText("None in window");
    await expect(study).not.toContainText("All time");
    await expect(study).not.toContainText("No message yet");
    await expect(study.locator("tbody tr")).toHaveCount(3);
    await expect(study).not.toContainText("study_recent_member_active_today");
    await expect(study).not.toContainText("cm_00000000000000006419");

    const mobileRows = study.locator('[data-layout="mobile-rows"]');
    const desktopTable = study.locator('[data-layout="desktop-table"]');
    if (viewport.label === "mobile") {
      await expect(mobileRows).toBeVisible();
      await expect(desktopTable).toBeHidden();
      await expect(mobileRows.locator("li")).toHaveCount(3);
    } else {
      await expect(mobileRows).toBeHidden();
      await expect(desktopTable).toBeVisible();
      await expect(desktopTable.locator("tbody tr")).toHaveCount(3);
      const tableContainer = desktopTable.locator(
        '[data-slot="table-container"]',
      );
      expect(await tableContainer.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      )).toBe(false);
    }

    const emptyStudy = page.locator("#growth-recent-member-retention-empty");
    await expect(emptyStudy).toContainText("No real member signups yet.");

    // The isolated proof route runs through the Next.js development server.
    // Wait for its transient compiler indicator so it cannot cover the study.
    await expect(page.getByText("Compiling...", { exact: true })).toBeHidden({
      timeout: 30_000,
    });
    await page.locator("nextjs-portal").evaluateAll((portals) => {
      for (const portal of portals) {
        portal.remove();
      }
    });

    await study.screenshot({
      path: testInfo.outputPath(`recent-member-retention-${viewport.label}.png`),
    });
  });
}
