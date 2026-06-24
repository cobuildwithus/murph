import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/components/hosted-onboarding/client-api")>();
  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

import { HostedOnboardingApiError } from "../src/components/hosted-onboarding/client-api";
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
  assert.equal(mocks.routerRefresh.mock.calls.length, 0);
  assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 0);
});

test("dashboard onboarding recovery refreshes stale snapshots when no redirect is returned", async () => {
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
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls, [[{
    method: "POST",
    payload: {},
    url: "/api/hosted-onboarding/session/dashboard-recovery",
  }]]);
  assert.equal(assign.mock.calls.length, 0);
  assert.equal(mocks.routerRefresh.mock.calls.length, 1);
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
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.deepEqual(assign.mock.calls, [["/join/recovery%20invite"]]);
  assert.equal(mocks.routerRefresh.mock.calls.length, 0);
});

test("dashboard onboarding recovery leaves the dashboard when the session is gone", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
    new HostedOnboardingApiError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
    }),
  );

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
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.deepEqual(assign.mock.calls, [["/"]]);
  assert.equal(mocks.routerRefresh.mock.calls.length, 0);
});

test("dashboard onboarding recovery exposes a retry after recoverable failures", async () => {
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({
      redirectPath: null,
    });

  const { cleanup, container, window } = await renderClientComponent(
    createElement(DashboardOnboardingRecoveryRedirect, {
      enabled: true,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(
    container.querySelector('[role="alert"]')?.textContent,
    "Could not reopen checkout.Try again",
  );
  const retryButton = container.querySelector("button");
  assert.ok(retryButton instanceof window.HTMLButtonElement);

  await act(async () => {
    retryButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(mocks.requestHostedOnboardingJson.mock.calls.length, 2);
  assert.equal(mocks.routerRefresh.mock.calls.length, 1);
});
