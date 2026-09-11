import { fileURLToPath } from "node:url";

import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { HostedFamilyStartButton } from "../src/components/settings/hosted-family-start-button";
import {
  buildSanitizedBrowserEnvironmentForTest,
  clickHydratedMurphControl,
} from "./support/hosted-billing-browser-driver";

const enabled = process.env.MURPH_E2E_BILLING_BROWSER_SMOKE === "1";

describe.runIf(enabled)("billing control hydration in real Chromium", () => {
  let browser: Browser;
  let clientScript: string;

  beforeAll(async () => {
    const appRoot = fileURLToPath(new URL("..", import.meta.url));
    const result = await build({
      configFile: false,
      envFile: false,
      oxc: { jsx: { runtime: "automatic", development: false } },
      root: appRoot,
      logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      resolve: { alias: { "@": appRoot } },
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL("./fixtures/billing-browser-hydration.tsx", import.meta.url)),
          formats: ["iife"],
          name: "BillingHydrationFixture",
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!output || !("output" in output)) {
      throw new Error("Billing browser fixture did not build.");
    }
    const chunk = output.output.find((entry) => entry.type === "chunk");
    if (!chunk) {
      throw new Error("Billing browser fixture has no JavaScript chunk.");
    }
    clientScript = chunk.code;
    browser = await chromium.launch({
      env: buildSanitizedBrowserEnvironmentForTest(process.env),
      headless: true,
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it.each([false, true])("clicks the real Family control exactly once after hydration (replacement=%s)", async (replace) => {
    const context = await browser.newContext();
    let releasePoll!: () => void;
    const pollReleased = new Promise<void>((resolve) => { releasePoll = resolve; });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(serverMarkup(replace));
      await page.addScriptTag({ content: clientScript });
      const control = page.getByRole("button", { exact: true, name: "Start your own Family plan" });
      const original = await control.elementHandle();
      expect(original).not.toBeNull();

      // Hold only the first real DOM sample so hydration is guaranteed to
      // occur after polling has begun. Neither React props nor clicks are faked.
      let markSampled!: () => void;
      const sampled = new Promise<void>((resolve) => { markSampled = resolve; });
      const evaluateAll = control.evaluateAll.bind(control);
      vi.spyOn(control, "evaluateAll").mockImplementationOnce(async (...args) => {
        const result = await evaluateAll(...args);
        expect(result).toBe(false);
        markSampled();
        await pollReleased;
        return result;
      });
      const click = clickHydratedMurphControl(5_000, control);
      void click.catch(() => undefined);
      await Promise.race([sampled, click]);
      await browserExpect(page.locator("#root")).not.toHaveAttribute("data-click-count");
      await page.locator("#root").dispatchEvent("hydrate-billing-control");
      expect(errors).toEqual([]);
      if (replace) {
        await browserExpect(page.locator("#root")).toHaveAttribute("data-recovered", "true");
      }
      releasePoll();
      try {
        await click;
      } catch (error) {
        expect(errors).toEqual([]);
        throw error;
      }

      expect(await original?.evaluate((element) => element.isConnected)).toBe(!replace);
      await browserExpect(page.getByRole("dialog")).toBeVisible();
      await browserExpect(page.getByRole("heading", { name: "Start your own Family plan?" })).toBeVisible();
      await browserExpect(page.locator("#root")).toHaveAttribute("data-click-count", "1");
      await original?.dispose();
    } finally {
      releasePoll();
      await context.close();
    }
  });

  it("fails within its configured timeout without clicking a control that never hydrates", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setContent(serverMarkup(false));
      await page.addScriptTag({ content: clientScript });
      await expect(clickHydratedMurphControl(250, page.getByRole("button", {
        exact: true,
        name: "Start your own Family plan",
      }))).rejects.toThrow("Timeout 250ms exceeded");
      await browserExpect(page.locator("#root")).not.toHaveAttribute("data-click-count");
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

function serverMarkup(replace: boolean): string {
  const content = renderToString(createElement("div", null, createElement(HostedFamilyStartButton, {
    label: "Start your own Family plan",
    ownershipConfirmation: true,
  })));
  return `<div id="root" data-replace="${replace}">${content}</div>`;
}
