import assert from "node:assert/strict";

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

import { ResponsiveSelect } from "../src/components/ui/responsive-select";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResponsiveSelect mobile accessibility", () => {
  it("names the trigger with its current value", async () => {
    const rendered = await renderClientComponent(createElement(ResponsiveSelect, {
      ariaLabel: "Catalog type",
      onValueChange: vi.fn(),
      options: [
        { label: "All catalog items", value: "all" },
        { label: "Panels", value: "panel" },
      ],
      value: "panel",
    }));

    try {
      const trigger = rendered.container.querySelector("button");
      assert.ok(trigger instanceof rendered.window.HTMLButtonElement);
      expect(trigger.getAttribute("aria-label")).toBe("Catalog type: Panels");
    } finally {
      await rendered.cleanup();
    }
  });
});
