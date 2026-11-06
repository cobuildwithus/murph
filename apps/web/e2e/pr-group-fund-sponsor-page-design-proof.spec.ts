import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

const STUDY = '[data-design-study="group-usage-funding"]';
const CAPTURED_STATES = [
  "monthly-activation",
  "one-time",
  "ordinary-sponsored-one-time",
  "checkout-canceled",
  "checkout-unconfirmed",
  "checkout-open",
  "payment-confirming",
  "fulfilled-receipt",
  "capacity-conflict",
  "monthly-active",
  "monthly-raising",
  "monthly-paused",
  "monthly-recovery",
  "monthly-canceled",
  "signed-out",
  "unavailable",
];

async function openStudy(page: Page) {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort()
  );
  await page.goto("/screenshots/groups", { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  return page.locator(STUDY);
}

for (const width of [320, 390, 1280]) {
  test(`every funding state fits at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const study = await openStudy(page);
    const states = study.locator("[data-design-state]");
    await expect(states).not.toHaveCount(0);

    // Compare boxes, not scrollWidth: a rotated layer can spill past the page
    // without overflowing its own frame.
    const spilling = await study.evaluate((element) =>
      [...element.querySelectorAll("[data-design-surface]")].flatMap((surface) => {
        const frame = surface.getBoundingClientRect();
        return [...surface.querySelectorAll("*")].flatMap((child) => {
          const box = child.getBoundingClientRect();
          return box.width > 0 &&
              (box.left < frame.left - 1 || box.right > frame.right + 1)
            ? [surface.closest("[data-design-state]")?.getAttribute("data-design-state")]
            : [];
        });
      })
    );
    expect(spilling).toEqual([]);
    await expect(study).not.toContainText("Personalize");
    await expect(study).not.toContainText("Supporters");

    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (!output) return;
    await mkdir(output, { recursive: true });
    for (const state of CAPTURED_STATES) {
      await study
        .locator(`[data-design-state="${state}"] [data-design-surface]`)
        .screenshot({
          path: path.join(output, `group-fund-${state}-${width}.png`),
          style: "nextjs-portal { visibility: hidden; }",
        });
    }
  });
}

test.describe("the dial on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  async function openDial(page: Page) {
    const study = await openStudy(page);
    await page
      .locator('[data-screenshot-category="groups"]')
      .evaluate((element) => element.removeAttribute("inert"));
    const state = study.locator('[data-design-state="monthly-activation"]');
    const dial = state.locator('[data-slot="group-funding-dial"]');
    await dial.scrollIntoViewIfNeeded();
    return {
      cdp: await page.context().newCDPSession(page),
      cta: state.getByRole("button", { name: /Sponsor up to/u }),
      dial,
      slider: state.getByRole("slider", { name: "Monthly amount" }),
    };
  }

  async function touch(cdp: CDPSession, type: string, point?: { x: number; y: number }) {
    await cdp.send("Input.dispatchTouchEvent", {
      touchPoints: point ? [point] : [],
      type: type as "touchStart",
    });
  }

  async function ringPoint(dial: Locator, degrees: number) {
    const box = await dial.boundingBox();
    if (!box) throw new Error("The dial has no box.");
    const radius = box.width * (110 / 320);
    const radians = (degrees * Math.PI) / 180;
    return {
      x: box.x + box.width / 2 + radius * Math.sin(radians),
      y: box.y + box.height / 2 - radius * Math.cos(radians),
    };
  }

  async function dragAlongRing(
    page: Page,
    cdp: CDPSession,
    dial: Locator,
    fromDegrees: number,
    toDegrees: number,
  ) {
    await touch(cdp, "touchStart", await ringPoint(dial, fromDegrees));
    for (let degrees = fromDegrees; degrees <= toDegrees; degrees += 6) {
      await touch(cdp, "touchMove", await ringPoint(dial, degrees));
      await page.waitForTimeout(16);
    }
  }

  test("a scroll that starts on the dial scrolls the page and keeps the amount", async ({ page }) => {
    test.setTimeout(180_000);
    const { cdp, dial, slider } = await openDial(page);
    for (const degrees of [90, 270]) {
      const start = await ringPoint(dial, degrees);
      const scrolledFrom = await page.evaluate(() => window.scrollY);
      await touch(cdp, "touchStart", start);
      for (let step = 1; step <= 14; step += 1) {
        await touch(cdp, "touchMove", { x: start.x, y: start.y - step * 9 });
        await page.waitForTimeout(16);
      }
      await touch(cdp, "touchEnd");
      await page.waitForTimeout(350);

      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolledFrom);
      await expect(slider).toHaveAttribute("aria-valuetext", "$10 a month");
      await dial.scrollIntoViewIfNeeded();
    }
  });

  test("dragging the knob changes the amount while the finger is down", async ({ page }) => {
    test.setTimeout(180_000);
    const { cdp, cta, dial, slider } = await openDial(page);
    const scrolledFrom = await page.evaluate(() => window.scrollY);

    await dragAlongRing(page, cdp, dial, 315, 408);

    await expect(slider).toHaveAttribute("aria-valuetext", "$20 a month");
    await expect(cta).toHaveText("Sponsor up to $20 a month");
    await touch(cdp, "touchEnd");
    await expect(slider).toHaveAttribute("aria-valuetext", "$20 a month");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolledFrom);
  });

  test("the knob stops at the top of the range and the checkout carries it", async ({ page }) => {
    test.setTimeout(180_000);
    const { cdp, cta, dial, slider } = await openDial(page);
    const checkoutBodies: unknown[] = [];
    await page.route("**/api/design/usage-credit-preview", async (route) => {
      checkoutBodies.push(route.request().postDataJSON());
      await route.fulfill({
        body: JSON.stringify({
          purchaseId: "hucp_design_abcdefgh",
          recovered: true,
          status: "payment_pending",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await dragAlongRing(page, cdp, dial, 315, 225 + 270 + 80);
    await expect(slider).toHaveAttribute("aria-valuetext", "$50 a month");
    await touch(cdp, "touchEnd");

    await cta.click();
    await expect.poll(() => checkoutBodies.length).toBe(1);
    expect(checkoutBodies[0]).toMatchObject({
      monthlyCapMinor: 5_000,
      offerCode: "usage_5_usd",
      sponsorshipKind: "monthly",
    });
  });
});
