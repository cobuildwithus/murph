import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const STATES = {
  group: "Leo started a family challenge",
  "link-group": "Leo started a family challenge",
  "any-artifact": "Weekdays for a week. Starts once you say yes.",
  dare: "The loser has to",
  "link-dare": "LOSER HAS TO",
  "heart-rate": "Prove it with heart rate from a wearable.",
  expired: "This invite ran out.",
  missing: "This link isn't available.",
  open: "Get the app",
  "open-any-days": "Any 5 days in a week",
  used: "This link is used up.",
  "link-open": "Breakfast in bed",
  "link-open-any-days": "STARTS OCT 19",
  "link-closed": "This invite isn't available",
} as const;

for (const width of [390, 1280]) {
  test(`weekly game invite at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/groups#game-invite", { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    const study = page.locator('[data-design-study="game-invite"]');
    for (const [state, text] of Object.entries(STATES)) {
      const surface = study.locator(`[data-design-state="${state}"]`);
      await expect(surface).toContainText(text);
      expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    await expect(study.locator('[data-design-state="open"]')).toContainText("Leo challenged you");
    await expect(study.locator('[data-design-state="group"]')).not.toContainText("Everyone");
    await expect(study.locator('[data-design-state="group"]')).toContainText("A healthy meal");
    await expect(study.locator('[data-design-state="group"]')).toContainText("Weekdays for 2 weeks.");
    await expect(study.locator('[data-design-state="group"]')).not.toContainText("Artifact");
    await expect(study.locator('[data-design-state="open"]')).toContainText("Already have Murph? Open it");
    await expect(study.locator('[data-design-state="open"]')).not.toContainText("Copy link");
    await expect(study.locator('[data-design-state="open"]')).toContainText("Mon, Wed, Fri");
    // The link preview names the challenger against "You" (never the invitee's private name), and nobody when closed.
    await expect(study.locator('[data-design-state="link-open"]')).toContainText("Leo");
    await expect(study.locator('[data-design-state="link-open"]')).toContainText("You");
    await expect(study.locator('[data-design-state="link-open"]')).not.toContainText("Ava");
    await expect(study.locator('[data-design-state="link-closed"]')).not.toContainText("Leo");
    await expect(study.locator('[data-design-state="open"]')).toContainText("For the winner");
    await expect(study.locator('[data-design-state="dare"]')).toContainText("75 days");
    await expect(study.locator('[data-design-state="link-dare"]')).toContainText("75 DAYS");
    await expect(study).not.toContainText("of the week");
    await expect(study.locator('[data-design-state="any-artifact"]')).toContainText("Weekdays");
    await expect(study.locator('[data-design-state="any-artifact"]')).not.toContainText("Prove it");
    await expect(study).not.toContainText("paste it in Murph");
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (!output) return;
    await mkdir(output, { recursive: true });
    const style = "nextjs-portal { visibility: hidden; }";
    await study.locator('[data-design-state="heart-rate"]').screenshot({ path: path.join(output, `game-invite-heart-rate-${width}.png`), style });
    for (const state of ["group", "link-group", "any-artifact", "dare", "link-dare"]) {
      await study.locator(`[data-design-state="${state}"]`).screenshot({ path: path.join(output, `game-invite-${state}-${width}.png`), style });
    }
    if (width < 768) {
      await study.locator('[data-design-state="open"]').screenshot({ path: path.join(output, `game-invite-open-${width}.png`), style });
      await study.locator('[data-design-state="link-open"]').screenshot({ path: path.join(output, `game-invite-link-open-${width}.png`), style });
    } else {
      await study.screenshot({ path: path.join(output, `game-invite-states-${width}.png`), style });
    }
  });
}
