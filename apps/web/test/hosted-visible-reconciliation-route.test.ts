import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  reportHostedRuntimeUsageGateObservation: vi.fn(),
  readHostedRuntimeReconciliationFactsWithVisibleAccess: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), after: mocks.after,
}));
vi.mock("@/src/lib/hosted-runtime-log/usage-gate", () => ({
  reportHostedRuntimeUsageGateObservation: mocks.reportHostedRuntimeUsageGateObservation,
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

  afterEach(() => {
    vi.restoreAllMocks();
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
    ).toHaveBeenCalledWith(
      { userId: "member_123", onUsageGateDecision: expect.any(Function) },
      expect.any(Function),
    );
    await expect(response.json()).resolves.toEqual({
      blocked: null,
      mailboxLag: [],
      workspace: null,
    });
  });

  it("records decisions after the response using the authenticated member", async () => {
    mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess.mockImplementationOnce(async (input) => {
      input.onUsageGateDecision({ at: "2026-08-01T12:00:00.000Z", usageLimited: true });
      return { blocked: null, mailboxLag: [], workspace: null };
    });
    const response = await reconciliationRoute.GET(
      new Request("https://example.test/api/internal/hosted-orchestration/users/member_123/reconciliation-facts"),
      { params: Promise.resolve({ userId: "member_123" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.reportHostedRuntimeUsageGateObservation).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]?.[0]();
    expect(mocks.reportHostedRuntimeUsageGateObservation).toHaveBeenCalledExactlyOnceWith({
      at: "2026-08-01T12:00:00.000Z", usageLimited: true, userId: "member_123",
    });
  });

  it("preserves the existing generic response when reconciliation fails", async () => {
    const failure = new Error("synthetic reconciliation failure");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.readHostedRuntimeReconciliationFactsWithVisibleAccess
      .mockImplementationOnce(async (
        _input: unknown,
        reportStage?: (stage: "visible_access") => void,
      ) => {
        reportStage?.("visible_access");
        throw failure;
      });

    const response = await reconciliationRoute.GET(
      new Request(
        "https://join.example.test/api/internal/hosted-orchestration/users/member_123/reconciliation-facts",
      ),
      { params: Promise.resolve({ userId: "member_123" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(
      consoleErrorSpy.mock.calls.filter(
        ([message]) => message === "Hosted runtime reconciliation facts failed.",
      ),
    ).toHaveLength(1);
  });
});
