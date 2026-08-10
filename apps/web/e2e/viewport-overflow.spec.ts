import { expect, test } from "@playwright/test";

// Public marketing pages that must never scroll horizontally. They render
// anonymously (no auth, no database), which is what lets this gate run against
// the placeholder smoke environment. Dynamic and dashboard routes are
// intentionally excluded: they need seeded fixtures. Add new public marketing
// pages here so the gate covers them.
const ROUTES = [
  "/",
  "/clubs",
  "/search",
  "/security",
  "/pitch",
  "/changelog",
  "/growth",
  "/subprocessors",
  "/consumer-health-data-privacy-policy",
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/legal/health-ai-safety-disclosure",
  "/legal/consumer-health-data-privacy-policy",
] as const;

// 320 is the WCAG 1.4.10 (Reflow) floor; 375/390 are the smallest common
// iPhones; 768 is tablet; 1280 is desktop.
const WIDTHS = [320, 375, 390, 768, 1280] as const;

// A merge-blocking gate must not flake on benign sub-pixel rounding, and a real
// "section too wide" bug overflows by tens of pixels, so a 1px slack is safe.
const OVERFLOW_TOLERANCE_PX = 1;

// Layout fidelity caveats (deliberately not engineered around):
//   - Text width depends on the `next/font/google` families, which Next fetches
//     at compile time. CI runners have network access, so production metrics are
//     used; an offline runner would fall back to system metrics.
//   - The nav's GitHub star count is a best-effort server-side fetch and does
//     not drive marketing-section width, so its presence/absence is immaterial.

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

// Evaluated in the browser: how far the document overflows the viewport
// horizontally, plus the outermost elements that escape it. An element is a
// "culprit" when its right edge passes the viewport while its parent stays
// within it (the escape point), which also catches absolutely-positioned or
// translated elements that are not wider than their parent. Anything inside an
// intentional horizontal scroller (overflow-x: auto/scroll) is skipped so a
// deliberate carousel does not trip the gate.
function measureHorizontalOverflow(tolerancePx: number) {
  const viewportWidth = document.documentElement.clientWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const overflowPx = scrollWidth - viewportWidth;
  const culprits: string[] = [];

  if (overflowPx > tolerancePx) {
    const limit = viewportWidth + tolerancePx;
    const hasScrollableAncestor = (element: Element): boolean => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const overflowX = window.getComputedStyle(ancestor).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") {
          return true;
        }
      }
      return false;
    };

    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= limit) {
        continue;
      }
      const parent = element.parentElement;
      const parentRect = parent ? parent.getBoundingClientRect() : null;
      // Report only the outermost escape point in each branch.
      if (parentRect && parentRect.right > limit) {
        continue;
      }
      if (hasScrollableAncestor(element)) {
        continue;
      }
      const tag = element.tagName.toLowerCase();
      const className = (element.getAttribute("class") ?? "").slice(0, 80);
      culprits.push(`<${tag} class="${className}"> right=${Math.round(rect.right)}px width=${Math.round(rect.width)}px`);
      if (culprits.length >= 5) {
        break;
      }
    }
  }

  return { viewportWidth, scrollWidth, overflowPx, culprits };
}

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`no horizontal overflow: ${route} @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      // Measure the real, production-relevant page: drop every non-loopback
      // request so a CDN stall cannot flake the run and dev-only injected
      // widgets (e.g. the `ui.sh/ui-picker.js` overlay `app/layout.tsx` mounts
      // in development) never affect layout.
      await page.route("**/*", (route) => {
        if (isLoopbackUrl(route.request().url())) {
          route.continue();
        } else {
          route.abort();
        }
      });

      // Freeze animation/transition so layout settles to a stable measurement.
      await page.addInitScript(() => {
        const style = document.createElement("style");
        style.textContent =
          "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
        (document.head ?? document.documentElement).appendChild(style);
      });

      const response = await page.goto(route, { waitUntil: "load" });
      expect(response?.status(), `${route} should respond 200`).toBe(200);

      // Web fonts change text width (and therefore min-content), so wait for
      // them and a couple of frames before measuring or the result drifts.
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });

      const result = await page.evaluate(measureHorizontalOverflow, OVERFLOW_TOLERANCE_PX);

      const detail =
        `${route} overflows by ${result.overflowPx}px at ${width}px ` +
        `(scrollWidth ${result.scrollWidth} > viewport ${result.viewportWidth}).` +
        (result.culprits.length > 0
          ? `\nLikely cause(s):\n  ${result.culprits.join("\n  ")}`
          : "");

      expect(result.overflowPx, detail).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    });
  }
}

test("health-data consent actions stay inline and contained", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/*", (route) => {
    if (isLoopbackUrl(route.request().url())) {
      route.continue();
    } else {
      route.abort();
    }
  });

  const response = await page.goto("/design?tab=components", {
    waitUntil: "load",
  });
  expect(response?.status(), "health-data consent study should respond 200").toBe(
    200,
  );

  const activeState = page.locator(
    '[data-design-component="health-data-consent-settings"] ' +
      '[data-design-state="active-source-and-consent-controls"]',
  );
  await expect(activeState).toHaveCount(1);
  await expect(activeState).toBeVisible();

  for (const width of [320, 390, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });

    const layout = await activeState.evaluate((state) => {
      const link = state.querySelector<HTMLAnchorElement>('a[href="/connect"]');
      const button = Array.from(state.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === "Withdraw consent",
      );
      const group = link?.parentElement;
      if (!link || !button || !group || button.parentElement !== group) {
        throw new Error("Active health-data consent actions are missing.");
      }

      const stateRect = state.getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        buttonHeight: buttonRect.height,
        buttonLeft: buttonRect.left,
        buttonTop: buttonRect.top,
        groupLeft: groupRect.left,
        groupRight: groupRect.right,
        linkHeight: linkRect.height,
        linkLeft: linkRect.left,
        linkTop: linkRect.top,
        stateClientWidth: state.clientWidth,
        stateLeft: stateRect.left,
        stateRight: stateRect.right,
        stateScrollWidth: state.scrollWidth,
      };
    });

    expect(
      Math.abs(layout.linkTop - layout.buttonTop),
      `actions should share one row at ${width}px`,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    expect(
      layout.linkLeft,
      `source management should stay first at ${width}px`,
    ).toBeLessThan(layout.buttonLeft);
    expect(
      layout.linkHeight,
      `source target should stay touchable at ${width}px`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      layout.buttonHeight,
      `withdrawal target should stay touchable at ${width}px`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      layout.groupLeft,
      `active action group should stay inside its frame at ${width}px`,
    ).toBeGreaterThanOrEqual(layout.stateLeft - OVERFLOW_TOLERANCE_PX);
    expect(
      layout.groupRight,
      `active action group should stay inside its frame at ${width}px`,
    ).toBeLessThanOrEqual(layout.stateRight + OVERFLOW_TOLERANCE_PX);
    expect(
      layout.stateScrollWidth,
      `active consent state should not overflow at ${width}px`,
    ).toBeLessThanOrEqual(
      layout.stateClientWidth + OVERFLOW_TOLERANCE_PX,
    );
  }
});

test("home onboarding steps keep equal cards across dashboard widths", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/*", (route) => {
    if (isLoopbackUrl(route.request().url())) {
      route.continue();
    } else {
      route.abort();
    }
  });

  const response = await page.goto(
    "/design?tab=sections#home-onboarding-steps",
    { waitUntil: "load" },
  );
  expect(response?.status(), "onboarding study should respond 200").toBe(200);

  const study = page.locator(
    '[data-design-section="home-onboarding-steps"]',
  );
  const track = study.locator("[data-onboarding-steps]");
  await expect(track).toBeVisible();

  for (const viewportWidth of [1023, 1024, 1050, 1280, 1440] as const) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    const dashboardContentWidth = viewportWidth - 256 - 112;
    await study.evaluate((element, width) => {
      element.style.maxWidth = `${width}px`;
      element.style.width = `${width}px`;
    }, dashboardContentWidth);
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });

    const layout = await track.evaluate((element, tolerance) => {
      const cards = Array.from(
        element.querySelectorAll<HTMLElement>("[data-onboarding-step]"),
      );
      const trackRect = element.getBoundingClientRect();
      const measureCards = () => {
        const withinTrack = (rect: DOMRect) =>
          rect.left >= trackRect.left - tolerance
          && rect.right <= trackRect.right + tolerance;
        return {
          actionsContained: cards.every((card) => {
            const cardRect = card.getBoundingClientRect();
            const actionRect = card.querySelector<HTMLElement>(
              "a, button",
            )?.getBoundingClientRect();
            return Boolean(
              actionRect
              && actionRect.left >= cardRect.left - tolerance
              && actionRect.right <= cardRect.right + tolerance,
            );
          }),
          visibleCards: cards.filter((card) =>
            withinTrack(card.getBoundingClientRect())
          ).length,
          widths: cards.map((card) => card.getBoundingClientRect().width),
        };
      };

      element.scrollLeft = 0;
      const start = measureCards();
      element.scrollLeft = element.scrollWidth - element.clientWidth;
      const end = measureCards();

      return {
        actionsContained: start.actionsContained,
        clientWidth: element.clientWidth,
        display: window.getComputedStyle(element).display,
        documentOverflow:
          document.documentElement.scrollWidth
          - document.documentElement.clientWidth,
        endVisibleCards: end.visibleCards,
        maxCardWidthDelta:
          Math.max(...start.widths) - Math.min(...start.widths),
        scrollWidth: element.scrollWidth,
        startVisibleCards: start.visibleCards,
      };
    }, OVERFLOW_TOLERANCE_PX);

    expect(layout.documentOverflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    if (viewportWidth < 1024) {
      expect(layout.display).toBe("grid");
      expect(layout.scrollWidth).toBeLessThanOrEqual(
        layout.clientWidth + OVERFLOW_TOLERANCE_PX,
      );
      continue;
    }

    expect(layout.display).toBe("flex");
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(layout.maxCardWidthDelta).toBeLessThanOrEqual(
      OVERFLOW_TOLERANCE_PX,
    );
    expect(layout.actionsContained).toBe(true);
    expect(layout.startVisibleCards).toBe(3);
    expect(layout.endVisibleCards).toBe(3);
  }
});

test("clubs stays reachable through the global navigation at every breakpoint", async ({
  page,
}) => {
  for (const width of [768, 900, 1023, 1024] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => {
      if (isLoopbackUrl(route.request().url())) {
        route.continue();
      } else {
        route.abort();
      }
    });

    const response = await page.goto("/clubs", { waitUntil: "load" });
    expect(response?.status(), `/clubs should respond 200 at ${width}px`).toBe(
      200,
    );

    const navigation = page.locator("nav.fixed").first();
    const directClubsLink = navigation.locator('a[href="/clubs"]');
    const menuTrigger = navigation.getByRole("button", { name: "Open menu" });

    if (width < 1024) {
      await expect(directClubsLink).toBeHidden();
      await expect(menuTrigger).toBeVisible();
      await menuTrigger.click();
      await expect(
        page.getByRole("dialog").getByRole("link", {
          name: "Clubs",
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    } else {
      await expect(directClubsLink).toBeVisible();
      await expect(menuTrigger).toBeHidden();
    }
  }
});

test("homepage dense feature findings honor their phone breakpoints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route("**/*", (route) => {
    if (isLoopbackUrl(route.request().url())) {
      route.continue();
    } else {
      route.abort();
    }
  });

  const response = await page.goto("/", { waitUntil: "load" });
  expect(response?.status(), "homepage should respond 200").toBe(200);

  const recoveryCard = page
    .getByRole("heading", {
      name: "I read your wearables and tell you what actually matters.",
    })
    .locator("xpath=ancestor::article[1]");
  const recoveryRow = recoveryCard
    .getByText("HRV", { exact: true })
    .locator("xpath=..");
  const recoveryGroup = recoveryRow.locator("xpath=..");
  const recoveryArtifact = recoveryGroup.locator("xpath=..");
  const bloodworkRow = page
    .getByRole("heading", {
      name: "I find insights in your bloodwork over time.",
    })
    .locator("xpath=ancestor::article[1]")
    .getByText("LDL", { exact: true })
    .locator("xpath=ancestor::li[1]");
  const bloodworkArtifact = bloodworkRow.locator("xpath=../..");

  await expect(recoveryGroup).toBeVisible();
  await expect(bloodworkRow).toBeVisible();

  for (const width of [390, 420] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });

    const [recoveryGroupDisplay, recoveryRowDisplay, bloodworkRowDisplay] =
      await Promise.all([
        recoveryGroup.evaluate((element) =>
          window.getComputedStyle(element).display,
        ),
        recoveryRow.evaluate((element) =>
          window.getComputedStyle(element).display,
        ),
        bloodworkRow.evaluate((element) =>
          window.getComputedStyle(element).display,
        ),
      ]);

    expect(recoveryGroupDisplay).toBe(width < 400 ? "block" : "grid");
    expect(recoveryRowDisplay).toBe(width < 400 ? "grid" : "block");
    expect(bloodworkRowDisplay).toBe(width < 420 ? "grid" : "flex");

    for (const artifact of [recoveryArtifact, bloodworkArtifact]) {
      const size = await artifact.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(size.scrollWidth).toBeLessThanOrEqual(
        size.clientWidth + OVERFLOW_TOLERANCE_PX,
      );
    }
  }
});

for (const width of [768, 1280] as const) {
  test(`personal usage-credit owner stays contained @ ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => {
      if (isLoopbackUrl(route.request().url())) {
        route.continue();
      } else {
        route.abort();
      }
    });

    const response = await page.goto(
      "/design?tab=sections#personal-usage-credit-owner",
      { waitUntil: "load" },
    );
    expect(response?.status(), "design owner study should respond 200").toBe(200);

    const study = page.locator(
      '[data-design-study="personal-usage-credit-owner"]',
    );
    const activeState = study.locator(
      '[data-design-state="active-with-credit"]',
    );
    const card = activeState.locator(
      '[aria-label="Pulse AI usage"]',
    );
    const trigger = card.locator("button").filter({ hasText: "Add usage" });
    const historyPreview = study.locator(
      '[data-design-interaction="guidance-with-history"]',
    );
    const referralDetailsPreview = study.locator(
      '[data-design-interaction="referral-details"]',
    );
    await expect(
      study.locator('[data-design-state="exhausted-with-credit"] [inert]'),
    ).toHaveCount(1);
    await expect(
      study.locator('[data-design-state="exhausted-without-credit"] [inert]'),
    ).toHaveCount(1);
    await expect(
      study.locator('[data-design-state="trial-conversion"] [inert]'),
    ).toHaveCount(1);
    await expect(activeState.locator("[inert]")).toHaveCount(1);
    await expect(activeState.getByText("Reward pending", { exact: true })).toBeVisible();
    await expect(historyPreview).toHaveCount(1);
    await expect(
      historyPreview.getByText(
        "Share your link or ask Murph about group referral options.",
      ),
    ).toBeVisible();
    await expect(historyPreview.getByText("Copy link", { exact: true })).toBeVisible();
    await expect(historyPreview.getByText("Ask Murph", { exact: true })).toBeVisible();
    expect(
      await historyPreview.evaluate((element) =>
        element.hasAttribute("inert"),
      ),
    ).toBe(false);
    await expect(trigger).toBeVisible();

    const history = historyPreview.locator("details");
    const historySummary = history.locator("summary");
    await expect(history).not.toHaveAttribute("open", "");
    await historySummary.click();
    await expect(history).toHaveAttribute("open", "");
    await historySummary.focus();
    await page.keyboard.press("Enter");
    await expect(history).not.toHaveAttribute("open", "");
    await expect(
      historyPreview.locator(
        'a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).toHaveCount(3);

    const currentReferrals = referralDetailsPreview.getByRole("list", {
      name: "Current usage referrals",
    });
    await expect(currentReferrals).toBeVisible();
    const referralDetailNames = [
      "Details for Start a group conversation: In progress, Ends Aug 3 at 12:00 PM UTC",
      "Details for Start a group conversation: Checking final activity, Closed Jul 27 at 12:00 PM UTC",
      "Details for Start a group conversation: Reward pending, Qualified Jul 25",
    ];
    for (const name of referralDetailNames) {
      await expect(currentReferrals.getByRole("button", { name })).toHaveCount(1);
    }
    const referralDetailsSummary = currentReferrals.getByRole("button", {
      name: referralDetailNames[0],
    });
    const referralDetails = referralDetailsSummary.locator("..");
    await expect(referralDetails).not.toHaveAttribute("open", "");
    await referralDetailsSummary.click();
    await expect(referralDetails).toHaveAttribute("open", "");
    await expect(
      referralDetails.getByText(
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      ),
    ).toBeVisible();
    await referralDetailsSummary.focus();
    await page.keyboard.press("Enter");
    await expect(referralDetails).not.toHaveAttribute("open", "");

    const trialConversion = study.locator(
      '[data-design-state="trial-conversion"]',
    );
    await expect(trialConversion.getByText("Free trial", { exact: true })).toBeVisible();
    await expect(
      trialConversion.locator("button").filter({ hasText: "Start Pulse plan" }),
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const owner = document.querySelector(
        '[data-design-state="active-with-credit"] [aria-label="Pulse AI usage"]',
      );
      const button = Array.from(owner?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent?.trim() === "Add usage",
      );
      if (!(owner instanceof HTMLElement) || !(button instanceof HTMLElement)) {
        return null;
      }
      const ownerRect = owner.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        buttonClassName: button.className,
        buttonRight: buttonRect.right,
        buttonWidth: buttonRect.width,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        ownerRight: ownerRect.right,
        ownerWidth: ownerRect.width,
      };
    });

    expect(layout).not.toBeNull();
    if (!layout) {
      return;
    }
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(
      layout.documentClientWidth + OVERFLOW_TOLERANCE_PX,
    );
    expect(layout.buttonRight).toBeLessThanOrEqual(
      layout.ownerRight + OVERFLOW_TOLERANCE_PX,
    );
    expect(layout.buttonWidth).toBeLessThan(layout.ownerWidth / 2);
    expect(layout.buttonClassName.split(/\s+/u)).not.toContain("w-full");
  });
}
