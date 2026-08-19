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
  let cancellationRequests = 0;
  let limitRequests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "POST"
      && url.pathname.endsWith("/sponsorship")
    ) {
      const body: unknown = request.postDataJSON();
      const action = body !== null && typeof body === "object" && "action" in body
        ? body.action
        : null;
      const isCancellation = action === "cancel";
      if (isCancellation) {
        cancellationRequests += 1;
        if (cancellationRequests === 1) {
          await route.fulfill({
            body: JSON.stringify({
              error: {
                code: "HOSTED_GROUP_SPONSORSHIP_STATE_CONFLICT",
                message: "This monthly sponsorship changed. Refresh and try again.",
              },
            }),
            contentType: "application/json",
            status: 409,
          });
          return;
        }
        if (cancellationRequests === 2) {
          await route.fulfill({
            body: JSON.stringify({
              error: {
                code: "AUTH_REQUIRED",
                message: "Sign in to continue.",
              },
            }),
            contentType: "application/json",
            status: 401,
          });
          return;
        }
        if (cancellationRequests === 3) {
          await route.abort("connectionfailed");
          return;
        }
        await route.fulfill({
          body: JSON.stringify({ management: null }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }

      limitRequests += 1;
      if (limitRequests === 1) {
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

  const enableStudy = async () => {
    const currentStudy = page.locator("#group-sponsorship-management-component");
    await expect(currentStudy).toHaveCount(1);
    await page.waitForFunction(() => {
      const element = document.querySelector(
        "#group-sponsorship-management-component",
      );
      return element
        ? Object.keys(element).some((key) => key.startsWith("__reactFiber$"))
        : false;
    });
    await currentStudy.evaluate((element) => element.removeAttribute("inert"));
    return currentStudy;
  };

  let study = await enableStudy();

  const reviewButton = study.getByRole("button", { name: "Review $20 limit" });
  await reviewButton.click();
  let dialog = page.getByRole("alertdialog", {
    name: "Increase your limit to $20?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "When automatic refills are on, Murph may charge $5 at a time",
  );
  await expect(dialog.locator(":focus")).toHaveCount(1);
  expect(limitRequests).toBe(0);

  await dialog.getByRole("button", { name: "Keep $10 limit" }).click();
  await expect(dialog).toBeHidden();
  await expect(reviewButton).toBeFocused();
  expect(limitRequests).toBe(0);

  await reviewButton.click();
  dialog = page.getByRole("alertdialog", {
    name: "Increase your limit to $20?",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(reviewButton).toBeFocused();
  expect(limitRequests).toBe(0);

  await reviewButton.click();
  dialog = page.getByRole("alertdialog", {
    name: "Increase your limit to $20?",
  });
  await dialog.getByRole("button", { name: "Increase to $20" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "We’re not sure whether your limit changed",
  );
  await expect(
    dialog.getByRole("button", { name: "Check current setup" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Increase to $20" }),
  ).toBeEnabled();
  expect(limitRequests).toBe(1);

  await dialog.getByRole("button", { name: "Increase to $20" }).click();
  await expect(dialog).toBeHidden();
  expect(limitRequests).toBe(2);

  await study.getByRole("button", { name: "Cancel sponsorship" }).click();
  dialog = page.getByRole("alertdialog", {
    name: "Cancel your monthly sponsorship?",
  });
  await dialog.getByRole("button", { name: "Cancel sponsorship" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "This monthly sponsorship changed. Refresh and try again.",
  );
  await expect(
    dialog.getByRole("button", { name: "Refresh current setup" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Check cancellation status" }),
  ).toHaveCount(0);
  expect(cancellationRequests).toBe(1);

  await Promise.all([
    page.waitForEvent("framenavigated"),
    dialog.getByRole("button", { name: "Refresh current setup" }).click(),
  ]);
  study = await enableStudy();
  await study.getByRole("button", { name: "Cancel sponsorship" }).click();
  dialog = page.getByRole("alertdialog", {
    name: "Cancel your monthly sponsorship?",
  });
  await dialog.getByRole("button", { name: "Cancel sponsorship" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Sign in to continue.");
  await expect(
    dialog.getByRole("button", { name: "Refresh current setup" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Check cancellation status" }),
  ).toHaveCount(0);
  expect(cancellationRequests).toBe(2);

  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.keyboard.press("Escape"),
  ]);
  study = await enableStudy();
  await study.getByRole("button", { name: "Cancel sponsorship" }).click();
  dialog = page.getByRole("alertdialog", {
    name: "Cancel your monthly sponsorship?",
  });
  await dialog.getByRole("button", { name: "Cancel sponsorship" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "We’re not sure whether your sponsorship was canceled",
  );
  await expect(
    dialog.getByRole("button", { name: "Check cancellation status" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Check current setup" }),
  ).toHaveCount(0);
  expect(cancellationRequests).toBe(3);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Check cancellation status" }).click();
  await expect(dialog).toBeHidden();
  await expect(study.getByRole("status")).toContainText(
    "Monthly sponsorship canceled",
  );
  expect(cancellationRequests).toBe(4);
});

test("payment recovery stays retryable when Checkout cannot open", async ({
  page,
}) => {
  await page.route("**/api/design/group-sponsorship-management", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        checkout: {
          purchaseId: "hucp_design_recovery",
          status: "reconciling",
        },
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  for (const viewport of [
    { height: 720, width: 1_280 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const response = await page.goto("/screenshots/groups", {
      waitUntil: "load",
    });
    expect(response?.status(), "screenshot study should respond 200").toBe(200);

    const recoveryStudy = page.locator(
      '[data-design-state="monthly-recovery"]',
    );
    await expect(recoveryStudy).toHaveCount(1);
    await page.waitForFunction(() => {
      const element = document.querySelector(
        '[data-design-state="monthly-recovery"]',
      );
      return element
        ? Object.keys(element).some((key) => key.startsWith("__reactFiber$"))
        : false;
    });
    await page.locator('[data-screenshot-category="groups"]').evaluate(
      (element) => element.removeAttribute("inert"),
    );

    const reviewButton = recoveryStudy.getByRole("button", {
      name: "Review payment",
    });
    const originalUrl = page.url();
    await reviewButton.click();

    await expect(recoveryStudy.getByRole("alert")).toContainText(
      "Payment review couldn’t open. Try again.",
    );
    await expect(reviewButton).toBeEnabled();
    expect(page.url()).toBe(originalUrl);
  }
});
