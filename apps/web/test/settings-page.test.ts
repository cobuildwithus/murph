import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, test } from "vitest";

const SETTINGS_PAGE = new URL(
  "../app/(dashboard)/settings/page.tsx",
  import.meta.url,
);

describe("settings subscription composition", () => {
  test("derives Starter checkout separately from paid subscription management", async () => {
    const source = await readFile(SETTINGS_PAGE, "utf8");

    assert.match(source, /hasHostedMemberOwnPaidBilling/);
    assert.match(source, /const canStartDirectPlan/);
    assert.match(source, /canStartDirectPlan=\{canStartDirectPlan\}/);
    assert.match(source, /currentBillingPhase=\{billingRef\?\.currentBillingPhase\}/);
  });

  test("contains no timed-trial continuation surface", async () => {
    const source = await readFile(SETTINGS_PAGE, "utf8");

    assert.doesNotMatch(source, /PulseTrialBillingContinuation/);
    assert.doesNotMatch(source, /readHostedPulseTrialContinuationCookie/);
    assert.doesNotMatch(source, /StartPaidPulseButton/);
    assert.doesNotMatch(source, /trial end|days left|expires/i);
  });
});
