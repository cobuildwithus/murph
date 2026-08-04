import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

describe("HostedPlanUpdateReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("polls the webhook-owned billing projection while the plan is syncing", async () => {
    vi.useFakeTimers();
    const { HostedPlanUpdateReturn } = await import(
      "@/src/components/settings/hosted-plan-update-return"
    );
    const rendered = await renderClientComponent(
      createElement(HostedPlanUpdateReturn, {
        active: false,
        targetPlanCode: "launch_edge_monthly",
      }),
      { requireButton: false },
    );

    assert.match(rendered.container.textContent ?? "", /Activating Edge/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);

    await rendered.cleanup();
  });

  test("shows proven activation and removes the unsigned return hint", async () => {
    const { HostedPlanUpdateReturn } = await import(
      "@/src/components/settings/hosted-plan-update-return"
    );
    const rendered = await renderClientComponent(
      createElement(HostedPlanUpdateReturn, {
        active: true,
        targetPlanCode: "launch_edge_monthly",
      }),
      {
        location: {
          href: "https://join.example.test/settings?planUpdate=launch_edge_monthly",
          origin: "https://join.example.test",
          pathname: "/settings",
          search: "?planUpdate=launch_edge_monthly",
        },
        requireButton: false,
      },
    );

    assert.match(rendered.container.textContent ?? "", /Edge is active/);
    assert.deepEqual(rendered.replaceState.mock.calls[0], [
      {},
      "",
      "/settings",
    ]);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    await rendered.cleanup();
  });

  test("keeps design-catalog studies inert", async () => {
    vi.useFakeTimers();
    const { HostedPlanUpdateReturn } = await import(
      "@/src/components/settings/hosted-plan-update-return"
    );
    const rendered = await renderClientComponent(
      createElement(HostedPlanUpdateReturn, {
        active: false,
        pollingEnabled: false,
        targetPlanCode: "launch_edge_monthly",
      }),
      { requireButton: false },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    await rendered.cleanup();
  });
});
