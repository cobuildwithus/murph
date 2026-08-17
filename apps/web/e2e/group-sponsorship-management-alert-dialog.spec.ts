import { expect, test } from "@playwright/test";

const management = {
  authorizationId: "hgsa_design_component",
  chargedThisPeriodMinor: 500,
  monthlyCapMinor: 2_000,
  pendingThisPeriodMinor: 500,
  pendingMonthlyCapMinor: null,
  periodEnd: "2026-08-30T16:00:00.000Z",
  status: "active",
};

test("sponsorship confirmation preserves focus, safe dismissal, and retry", async ({
  page,
}) => {
  let sponsorshipRequests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "POST"
      && url.pathname.endsWith("/sponsorship")
    ) {
      sponsorshipRequests += 1;
      if (sponsorshipRequests === 1) {
        await route.abort("connectionfailed");
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ management }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort();
  });

  const response = await page.goto("/design?tab=components", {
    waitUntil: "load",
  });
  expect(response?.status(), "design catalog should respond 200").toBe(200);

  const study = page.locator("#group-sponsorship-management-component");
  await expect(study).toHaveCount(1);
  await page.waitForFunction(() => {
    const element = document.querySelector(
      "#group-sponsorship-management-component",
    );
    return element
      ? Object.keys(element).some((key) => key.startsWith("__reactFiber$"))
      : false;
  });
  await study.evaluate((element) => element.removeAttribute("inert"));

  const reviewButton = study.getByRole("button", { name: "Review $20 limit" });
  await reviewButton.click();
  let dialog = page.getByRole("alertdialog", { name: "Increase limit to $20?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Murph makes $5 usage purchases only while automatic refills are active",
  );
  await expect(dialog.locator(":focus")).toHaveCount(1);
  expect(sponsorshipRequests).toBe(0);

  await dialog.getByRole("button", { name: "Keep current setup" }).click();
  await expect(dialog).toBeHidden();
  await expect(reviewButton).toBeFocused();
  expect(sponsorshipRequests).toBe(0);

  await reviewButton.click();
  dialog = page.getByRole("alertdialog", { name: "Increase limit to $20?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(reviewButton).toBeFocused();
  expect(sponsorshipRequests).toBe(0);

  await reviewButton.click();
  dialog = page.getByRole("alertdialog", { name: "Increase limit to $20?" });
  await dialog.getByRole("button", { name: "Increase to $20" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "We couldn’t confirm whether that change went through",
  );
  await expect(
    dialog.getByRole("button", { name: "Check current setup" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Increase to $20" }),
  ).toBeEnabled();
  expect(sponsorshipRequests).toBe(1);

  await dialog.getByRole("button", { name: "Increase to $20" }).click();
  await expect(dialog).toBeHidden();
  expect(sponsorshipRequests).toBe(2);
});
