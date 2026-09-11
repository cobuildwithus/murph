import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`Starter card setup stays usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    let attempts = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/settings/billing/image-card") {
        attempts += 1;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Card setup is temporarily unavailable." } }) });
      } else if (["localhost", "127.0.0.1"].includes(url.hostname)) {
        await route.continue();
      } else await route.abort();
    });
    await page.goto("/design?tab=components#starter-image-card-component", { waitUntil: "load" });
    const study = page.locator('#starter-image-card-component');
    await study.scrollIntoViewIfNeeded();
    await expect(study).toContainText("Adding a card does not charge you or start a subscription.");
    await page.waitForFunction(() => {
      const element = document.querySelector('#starter-image-card-component button');
      return element && Object.keys(element).some((key) => key.startsWith("__reactFiber$"));
    });
    await study.evaluate((element) => element.removeAttribute("inert"));
    const button = study.getByRole("button", { name: "Add or update card" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(study.getByRole("alert")).toContainText("Card setup is temporarily unavailable.");
    await expect(button).toBeEnabled();
    expect(attempts).toBe(1);
    expect(await study.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await study.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await study.screenshot({ path: testInfo.outputPath(`starter-image-card-${viewport.width}.png`) });
  });
}
