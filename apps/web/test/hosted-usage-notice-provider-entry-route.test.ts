import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimHostedUsageNoticeProviderEntry: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-notice-provider-entry", () => ({
  claimHostedUsageNoticeProviderEntry:
    mocks.claimHostedUsageNoticeProviderEntry,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

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
    mocks.claimHostedUsageNoticeProviderEntry.mockResolvedValue("claimed");
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
    expect(mocks.claimHostedUsageNoticeProviderEntry).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      authority: {
        channel: "whatsapp",
        target: "+15555550100",
      },
      idempotencyKey: buildHostedAiUsageDeniedResponseIdempotencyKey({
        memberId: "member-1",
        sourceEventId,
      }),
      memberId: "member-1",
      prisma: { kind: "prisma" },
      sourceEventId,
    });
  });

  it("rejects a duplicate or stale provider-entry claim before provider dispatch", async () => {
    mocks.claimHostedUsageNoticeProviderEntry.mockResolvedValueOnce(
      "dispatch_already_started",
    );

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
    expect(mocks.claimHostedUsageNoticeProviderEntry).not.toHaveBeenCalled();
  });

  it("rejects superseded current authority before provider dispatch", async () => {
    mocks.claimHostedUsageNoticeProviderEntry.mockResolvedValueOnce(
      "authority_superseded",
    );

    const response = await postHostedUsageNoticeProviderEntry(createRequest({
      attemptedAt: "2026-07-13T12:00:00.000Z",
      sourceEventId: "source-event-1",
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_USAGE_NOTICE_PROVIDER_AUTHORITY_SUPERSEDED",
      },
    });
  });
});

function createRequest(body: {
  attemptedAt: string;
  sourceEventId: string;
}): Request {
  return new Request(
    "https://web.example.test/api/internal/hosted-runtime/usage-notice/provider-entry",
    {
      body: JSON.stringify({
        ...body,
        channel: "whatsapp",
        target: "+15555550100",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
