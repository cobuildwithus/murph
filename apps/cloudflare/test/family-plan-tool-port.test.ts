import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_BILLING_CONTROL_TIMEOUT_MS,
  HOSTED_RUNTIME_FAMILY_PLAN_CONTRACT_VERSION,
} from "@murphai/hosted-execution/runtime-control";
import { HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH } from
  "@murphai/hosted-execution/routes";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", async () => {
  const actual = await vi.importActual<typeof import(
    "../src/runtime-platform/web-control-transport.ts"
  )>("../src/runtime-platform/web-control-transport.ts");
  return {
    ...actual,
    fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
  };
});

import { createHostedRuntimeFamilyPlanToolPort } from
  "../src/runtime-platform/family-plan-tool-port.ts";

describe("hosted Family plan tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the current wire contract outside the model-visible request", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      action: "read_status",
      result: {
        billingActive: true,
        billingStatus: "active",
        members: [],
        owner: true,
        pendingInvites: [],
        seats: {
          active: 2,
          billed: 2,
          invited: 0,
          max: 6,
          min: 2,
          remaining: 0,
          used: 2,
        },
      },
    });
    const transport = { mode: "proxy" } as const;
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimeFamilyPlanToolPort({
      boundUserId: "member_current",
      fetchImpl,
      transport,
    });

    await expect(port.request({ action: "read_status" })).resolves.toMatchObject({
      result: { owner: true },
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: {
        action: "read_status",
        contractVersion: HOSTED_RUNTIME_FAMILY_PLAN_CONTRACT_VERSION,
      },
      boundUserId: "member_current",
      description: "Hosted family plan tool",
      fetchImpl,
      path: HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
      timeoutMs: HOSTED_RUNTIME_BILLING_CONTROL_TIMEOUT_MS,
      transport,
    });
  });
});
