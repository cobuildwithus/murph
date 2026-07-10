import { describe, expect, it } from "vitest";

import { containsUrlLikeText } from "@/src/lib/primitives";

describe("web primitives", () => {
  it("distinguishes ordinary colon-delimited copy from URL-like text", () => {
    expect(containsUrlLikeText("ETA:5pm")).toBe(false);
    expect(containsUrlLikeText("Details: https://example.test/path")).toBe(true);
    expect(containsUrlLikeText("Open custom://path")).toBe(true);
    expect(containsUrlLikeText("Visit example.test when ready")).toBe(true);
  });
});
