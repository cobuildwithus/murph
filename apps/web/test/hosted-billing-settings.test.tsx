import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

describe("HostedBillingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePrivy.mockReturnValue({
      authenticated: true,
      ready: true,
    });
    mocks.useUser.mockReturnValue({
      user: {
        id: "member_123",
      },
    });
  });

  test("renders the self-serve billing portal action", async () => {
    const { HostedBillingSettings } = await import("@/src/components/settings/hosted-billing-settings");

    const markup = renderToStaticMarkup(createElement(HostedBillingSettings));

    assert.match(markup, /Subscription/);
    assert.match(markup, /Manage subscription/);
    assert.match(markup, /View or update your plan and payment details\./);
    assert.match(markup, /Change your plan, update payment methods, or cancel\./);
  });
});
