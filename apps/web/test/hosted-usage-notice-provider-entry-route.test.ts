import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  markHostedAiUsageDeniedResponseDispatchStartedTx: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-delivery-store")
  >("@/src/lib/hosted-onboarding/linq-delivery-store");
  return {
    ...actual,
    markHostedAiUsageDeniedResponseDispatchStartedTx:
      mocks.markHostedAiUsageDeniedResponseDispatchStartedTx,
  };
});

import {
  buildHostedAiUsageDeniedResponseIdempotencyKey,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  POST as postHostedUsageNoticeProviderEntry,
} from "../app/api/internal/hosted-runtime/usage-notice/provider-entry/route";

describe("hosted usage notice provider entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ kind: "prisma" });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member-1");
    mocks.markHostedAiUsageDeniedResponseDispatchStartedTx.mockResolvedValue(true);
  });

  it("atomically fences the exact prepared attempt for the bound member", async () => {
    const attemptedAt = "2026-07-13T12:00:00.000Z";
    const sourceEventId = "source-event-1";
    const request = createRequest({ attemptedAt, sourceEventId });

    const response = await postHostedUsageNoticeProviderEntry(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providerDispatchClaimed: true,
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 4 * 1024 },
    );
    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx).toHaveBeenCalledWith({
      expectedAttemptedAt: new Date(attemptedAt),
      idempotencyKey: buildHostedAiUsageDeniedResponseIdempotencyKey({
        memberId: "member-1",
        sourceEventId,
      }),
      prisma: { kind: "prisma" },
    });
  });

  it("rejects a duplicate or stale provider-entry claim before provider dispatch", async () => {
    mocks.markHostedAiUsageDeniedResponseDispatchStartedTx.mockResolvedValueOnce(false);

    const response = await postHostedUsageNoticeProviderEntry(createRequest({
      attemptedAt: "2026-07-13T12:00:00.000Z",
      sourceEventId: "source-event-1",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_USAGE_NOTICE_PROVIDER_DISPATCH_ALREADY_STARTED",
      },
    });
  });

  it("rejects a non-canonical attempt timestamp without touching delivery state", async () => {
    const response = await postHostedUsageNoticeProviderEntry(createRequest({
      attemptedAt: "2026-07-13T12:00:00Z",
      sourceEventId: "source-event-1",
    }));

    expect(response.status).toBe(400);
    expect(mocks.markHostedAiUsageDeniedResponseDispatchStartedTx).not.toHaveBeenCalled();
  });
});

function createRequest(body: {
  attemptedAt: string;
  sourceEventId: string;
}): Request {
  return new Request(
    "https://web.example.test/api/internal/hosted-runtime/usage-notice/provider-entry",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
