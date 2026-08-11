import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 1000, label: "desktop", width: 1440 },
  { height: 844, label: "mobile", width: 390 },
] as const;
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

test("shared-card fragments open a private, accessible App Store handoff", async ({
  page,
}) => {
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
      name: "Open this card with Murph",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Murph adds interactive workout and nutrition cards",
    );
    await expect(dialog).not.toContainText(envelope);
    await expect(
      dialog.getByRole("link", {
        name: "Get Murph for iPhone in the App Store (opens in a new tab)",
      }),
    ).toHaveAttribute(
      "href",
      "https://apps.apple.com/us/app/murph-ai/id6786145859",
    );
    await expect(dialog.getByRole("button", { name: "Not now" })).toHaveCount(
      1,
    );
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
    await expect(dialog.locator("a[href], button")).toHaveCount(2);

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

    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#murph-card=${envelope}$`, "u"));

    await page.evaluate(() => {
      window.location.hash = "#ordinary-homepage-section";
    });
    await expect(dialog).toBeHidden();
  }
});
