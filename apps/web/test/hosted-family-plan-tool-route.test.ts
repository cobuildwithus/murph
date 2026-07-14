import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedRuntimeFamilyPlanTool: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-execution/family-plan-tool", () => ({
  handleHostedRuntimeFamilyPlanTool: mocks.handleHostedRuntimeFamilyPlanTool,
  projectHostedRuntimeFamilyPlanToolResponseForContract: vi.fn((response) => response),
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/family-plan/tool/route"
);

let route: RouteModule;

describe("hosted Family plan tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/family-plan/tool/route"
    );
  });

  it("allows bounded Family Stripe transactions to finish", () => {
    expect(route.maxDuration).toBe(800);
  });
});
