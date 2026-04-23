import { describe, expect, it } from "vitest";

import { normalizeHostedExecutionBaseUrl } from "../src/env.ts";

describe("normalizeHostedExecutionBaseUrl requireOriginOnly", () => {
  it("accepts origin-only values and rejects non-root paths", () => {
    expect(
      normalizeHostedExecutionBaseUrl("https://Example.com/?q=1#frag", {
        requireOriginOnly: true,
      }),
    ).toBe("https://example.com");

    expect(() => normalizeHostedExecutionBaseUrl("https://example.com/root", {
      requireOriginOnly: true,
    })).toThrow(/must not include a path/u);
  });
});
