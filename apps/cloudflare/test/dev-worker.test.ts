import { describe, expect, it } from "vitest";

import { normalizePnpmScriptArgs } from "../scripts/dev-worker.js";

describe("normalizePnpmScriptArgs", () => {
  it("drops pnpm's leading argument separator before forwarding to wrangler", () => {
    expect(normalizePnpmScriptArgs(["--", "--ip", "127.0.0.1", "--port", "8901"]))
      .toEqual(["--ip", "127.0.0.1", "--port", "8901"]);
  });

  it("preserves plain wrangler arguments", () => {
    expect(normalizePnpmScriptArgs(["--local-protocol", "http"]))
      .toEqual(["--local-protocol", "http"]);
  });
});
