import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, test, vi } from "vitest";

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: vi.fn(),
}));

describe("HostedBillingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders the self-serve billing portal action", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings, {
      authenticated: true,
    }));

    assert.match(markup, /Subscription/);
    assert.match(markup, /Manage subscription/);
    assert.match(markup, /View or update your plan and payment details\./);
    assert.match(markup, /Change your plan, update payment methods, or cancel\./);
  });
});
