import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 1000, label: "desktop", width: 1440 },
  { height: 844, label: "mobile", width: 390 },
] as const;
const OVERFLOW_TOLERANCE_PX = 1;

test.use({ deviceScaleFactor: 3 });

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

test("shared-card fragments open a private, accessible App Store handoff", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  const requestEvidence: string[] = [];
  page.on("request", (request) => {
    requestEvidence.push(JSON.stringify({
      headers: request.headers(),
      postData: request.postData(),
      url: request.url(),
    }));
  });
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

  for (const { height, label, width } of VIEWPORTS) {
    const envelope = `synthetic-${label}-private-envelope`;
    await page.setViewportSize({ height, width });
    await page.goto("about:blank");
    const response = await page.goto(`/#murph-card=${envelope}`, {
      waitUntil: "load",
    });
    expect(response?.status(), `${label} homepage should respond 200`).toBe(200);

    const dialog = page.getByRole("dialog", {
      name: "Continue on iPhone",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Install or open Murph from the App Store. Then return to Messages and tap the card again.",
    );
    await expect(dialog).not.toContainText("Shared from Messages");
    await expect(dialog).not.toContainText(envelope);
    const appStoreLink = dialog.getByRole("link", {
      name: "Open App Store (opens in a new tab)",
    });
    const cancelButton = dialog.getByRole("button", { name: "Cancel" });
    await expect(appStoreLink).toHaveAttribute(
      "href",
      "https://apps.apple.com/us/app/murph-ai/id6786145859",
    );
    await expect(cancelButton).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(1);
    await expect(dialog.locator("a[href], button")).toHaveCount(3);

    const appStoreBox = await appStoreLink.boundingBox();
    const cancelBox = await cancelButton.boundingBox();
    expect(
      appStoreBox,
      `${label} App Store action should have layout`,
    ).not.toBeNull();
    expect(cancelBox, `${label} Cancel action should have layout`).not.toBeNull();
    if (appStoreBox && cancelBox) {
      expect(
        Math.abs(appStoreBox.width - cancelBox.width),
        `${label} actions should share one full-width column`,
      ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
      expect(
        appStoreBox.height,
        `${label} App Store action should use the large settings size`,
      ).toBeGreaterThanOrEqual(56);
      expect(
        appStoreBox.y + appStoreBox.height,
        `${label} App Store action should stack above Cancel`,
      ).toBeLessThan(cancelBox.y);
    }

    const focusIsContained = await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    );
    expect(focusIsContained, `${label} dialog should contain focus`).toBe(true);

    const overflowPx = await page.evaluate(() =>
      document.documentElement.scrollWidth
      - document.documentElement.clientWidth
    );
    expect(
      overflowPx,
      `${label} handoff should not overflow horizontally`,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    expect(requestEvidence.some((entry) => entry.includes(envelope))).toBe(
      false,
    );

    const screenshotPath = testInfo.outputPath(
      `murph-card-handoff-${label}.png`,
    );
    await dialog.screenshot({ path: screenshotPath });
    await testInfo.attach(`murph-card-handoff-${label}`, {
      contentType: "image/png",
      path: screenshotPath,
    });

    if (label === "desktop") {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`#murph-card=${envelope}$`, "u"));

      await page.evaluate(() => {
        window.location.hash = "#ordinary-homepage-section";
      });
      await expect(dialog).toBeHidden();
      await page.evaluate((nextEnvelope) => {
        window.location.hash = `#murph-card=${nextEnvelope}`;
      }, envelope);
      await expect(dialog).toBeVisible();
    }

    await cancelButton.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#murph-card=${envelope}$`, "u"));

    await page.evaluate(() => {
      window.location.hash = "#ordinary-homepage-section";
    });
    await expect(dialog).toBeHidden();
  }

  for (const { height, label, width } of VIEWPORTS) {
    await page.setViewportSize({ height, width });
    await page.goto("about:blank");
    const response = await page.goto(
      "/design?tab=components#murph-card-handoff-dialog",
      { waitUntil: "load" },
    );
    expect(response?.status(), `${label} design catalog should respond 200`).toBe(
      200,
    );

    const study = page.locator(
      '[data-design-component="murph-card-handoff-dialog"]',
    );
    await expect(study).toBeVisible();
    const surface = study.locator(":scope > div");
    await expect(surface.getByRole("button", { name: "Close" })).toHaveCount(1);

    const screenshotPath = testInfo.outputPath(
      `murph-card-handoff-study-${label}.png`,
    );
    await surface.screenshot({ path: screenshotPath });
    await testInfo.attach(`murph-card-handoff-study-${label}`, {
      contentType: "image/png",
      path: screenshotPath,
    });
  }
});
