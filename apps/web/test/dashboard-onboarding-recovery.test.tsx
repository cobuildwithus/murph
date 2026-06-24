import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

import { DashboardOnboardingRecoveryRedirect } from "../src/components/dashboard/dashboard-onboarding-recovery";

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    redirectPath: null,
  });
});

test("dashboard onboarding recovery does nothing when disabled", async () => {
  const { assign, cleanup } = await renderClientComponent(
    createElement(DashboardOnboardingRecoveryRedirect, {
      enabled: false,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  assert.equal(assign.mock.calls.length, 0);
  assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
});

test("dashboard onboarding recovery requests recovery without redirecting active members", async () => {
  const { assign, cleanup } = await renderClientComponent(
    createElement(DashboardOnboardingRecoveryRedirect, {
      enabled: true,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls, [[{
    method: "POST",
    payload: {},
    url: "/api/hosted-onboarding/session/dashboard-recovery",
  }]]);
  assert.equal(assign.mock.calls.length, 0);
});

test("dashboard onboarding recovery redirects to the returned join path", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    redirectPath: "/join/recovery%20invite",
  });

  const { assign, cleanup } = await renderClientComponent(
    createElement(DashboardOnboardingRecoveryRedirect, {
      enabled: true,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.deepEqual(assign.mock.calls, [["/join/recovery%20invite"]]);
});
