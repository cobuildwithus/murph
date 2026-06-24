import { describe, expect, test } from "vitest";

import { resolveComputerBrowserViewportPreset } from "@/src/lib/computer-use/viewport";

describe("resolveComputerBrowserViewportPreset", () => {
  test.each([
    [null, "desktop"],
    [undefined, "desktop"],
    ["", "desktop"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "desktop",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "desktop",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "mobile",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      "mobile",
    ],
  ] as const)("resolves %j to %s", (userAgent, expected) => {
    expect(resolveComputerBrowserViewportPreset(userAgent)).toBe(expected);
  });
});
