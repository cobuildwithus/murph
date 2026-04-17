import { describe, expect, it } from "vitest";

import { shouldAdvanceHostedWakeCursor } from "../src/user-runner/runner-wake-state.js";

describe("shouldAdvanceHostedWakeCursor", () => {
  it("advances the cursor only for terminal wake outcomes", () => {
    expect(shouldAdvanceHostedWakeCursor("completed")).toBe(true);
    expect(shouldAdvanceHostedWakeCursor("poisoned")).toBe(true);
    expect(shouldAdvanceHostedWakeCursor("quarantined")).toBe(true);
    expect(shouldAdvanceHostedWakeCursor("queued")).toBe(false);
    expect(shouldAdvanceHostedWakeCursor("backpressured")).toBe(false);
  });
});
