import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedRuntimeReconciliationFactsWithVisibleAccess: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-orchestration/visible-runtime-reconciliation", () => ({
  readHostedRuntimeReconciliationFactsWithVisibleAccess:
    mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess,
}));

type ReconciliationRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
);

let reconciliationRoute: ReconciliationRoute;

describe("visible reconciliation facts route", () => {
  beforeAll(async () => {
    reconciliationRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/reconciliation-facts/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess.mockResolvedValue({
      blocked: null,
      mailboxLag: [],
      workspace: null,
    });
  });

  it("routes authenticated facts reads through the visible-access wrapper", async () => {
    const response = await reconciliationRoute.GET(
      new Request(
        "https://join.example.test/api/internal/hosted-orchestration/users/member_123/reconciliation-facts",
      ),
      { params: Promise.resolve({ userId: "member_123" }) },
    );

    expect(response.status).toBe(200);
    expect(
      mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess,
    ).toHaveBeenCalledWith({ userId: "member_123" });
  });
});
