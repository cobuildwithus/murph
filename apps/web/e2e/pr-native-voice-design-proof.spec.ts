import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`native voice controls at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/*", (route) => {
      const hostname = new URL(route.request().url()).hostname;
      return ["127.0.0.1", "localhost", "[::1]"].includes(hostname) ? route.continue() : route.abort();
    });
    expect((await page.goto("/screenshots/voice", { waitUntil: "load", timeout: 120_000 }))?.status()).toBe(200);
    const study = page.locator('[data-design-section="voice-call"]');
    await expect(study).toBeVisible();
    await expect(study.getByText("Microphone off", { exact: true })).toHaveCount(2);
    await expect(study.getByText("Microphone muted", { exact: true })).toBeVisible();
    await expect(study.getByText("End call", { exact: true })).toHaveCount(4);
    await expect(study.getByText("Cancel", { exact: true })).toBeVisible();
    await expect(study.getByText("Play audio", { exact: true })).toBeVisible();
    await expect(study.locator('[data-voice-state="listening"] [data-speaker]')).toHaveAttribute("data-speaker", "user");
    await expect(study.locator('[data-voice-state="speaking"] [data-speaker]')).toHaveAttribute("data-speaker", "assistant");
    await expect(study.locator('[data-voice-state="connecting"] button').first()).toBeDisabled();
    await expect(study.locator('[data-voice-state="ending"] button').first()).toBeDisabled();
    // Motion reduction covers amplitude-driven scaling as well as the shader.
    await expect(study.locator('[data-voice-state="listening"] button > span').nth(1)).toHaveCSS("transform", "none");
    await expect(study.getByText("Allow microphone access in your browser, then start a new call.")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      document.querySelectorAll("nextjs-portal").forEach((portal) => portal.remove());
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      const surfaces = study.locator(":scope > div");
      for (const surface of await surfaces.all()) {
        const name = await surface.getAttribute("data-voice-state");
        await surface.screenshot({ animations: "disabled", path: path.join(output, `voice-${name}-${width}.png`) });
      }
    }
  });
}
