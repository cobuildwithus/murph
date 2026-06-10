import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliverHostedVaultShareNights: vi.fn(),
  findActiveHostedVaultShares: vi.fn(),
  hasHostedMemberActiveAccess: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/vault-share-store", () => ({
  deliverHostedVaultShareNights: mocks.deliverHostedVaultShareNights,
  findActiveHostedVaultShares: mocks.findActiveHostedVaultShares,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  hasHostedMemberActiveAccess: mocks.hasHostedMemberActiveAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({}),
}));

type DeliverRouteModule =
  typeof import("../app/api/internal/hosted-runtime/vault-share/deliver/route");

let deliverRoute: DeliverRouteModule;

function recentNight(daysAgo: number): {
  date: string;
  sleepEndAt: string;
  sleepStartAt: string;
} {
  const end = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 8 * 60 * 60 * 1000);

  return {
    date: end.toISOString().slice(0, 10),
    sleepEndAt: end.toISOString(),
    sleepStartAt: start.toISOString(),
  };
}

const VALID_BODY = {
  nights: [recentNight(1)],
  projectionKind: "sleep-times.v0",
};

const ACTIVE_SHARE = {
  destinationMemberId: "member_referee",
  grantorMemberId: "member_grantor",
  id: "share_1",
  projectionKind: "sleep-times.v0",
};

function buildRequest(body: unknown): Request {
  return new Request("https://web.test/api/internal/hosted-runtime/vault-share/deliver", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("vault-share deliver route", () => {
  beforeAll(async () => {
    deliverRoute = await import(
      "../app/api/internal/hosted-runtime/vault-share/deliver/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_grantor");
    mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE]);
    mocks.readHostedMemberCoreState.mockResolvedValue({ id: "member_referee" });
    mocks.hasHostedMemberActiveAccess.mockReturnValue(true);
    mocks.deliverHostedVaultShareNights.mockResolvedValue({
      appendedDates: ["2026-06-09"],
      duplicateDates: [],
      lastAppendedMailboxItemId: "mailbox_item_1",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({ signaled: true });
  });

  it("delivers offered nights to every active share and signals the destination", async () => {
    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appendedCount: 1,
      duplicateCount: 0,
      status: "delivered",
    });
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionKind: "sleep-times.v0",
    });
    expect(mocks.deliverHostedVaultShareNights).toHaveBeenCalledWith({
      nights: VALID_BODY.nights,
      share: ACTIVE_SHARE,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_referee",
      mailboxItemId: "mailbox_item_1",
    });
  });

  it("returns no-active-share and appends nothing when no grant exists", async () => {
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appendedCount: 0,
      duplicateCount: 0,
      status: "no-active-share",
    });
    expect(mocks.deliverHostedVaultShareNights).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("treats an inactive destination exactly like a missing grant", async () => {
    mocks.hasHostedMemberActiveAccess.mockReturnValue(false);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appendedCount: 0,
      duplicateCount: 0,
      status: "no-active-share",
    });
    expect(mocks.deliverHostedVaultShareNights).not.toHaveBeenCalled();
  });

  it("silently drops an all-stale offer instead of erroring", async () => {
    const response = await deliverRoute.POST(
      buildRequest({
        nights: [
          {
            date: "1999-01-01",
            sleepEndAt: "1999-01-01T06:31:00.000Z",
            sleepStartAt: "1998-12-31T22:04:00.000Z",
          },
        ],
        projectionKind: "sleep-times.v0",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appendedCount: 0,
      duplicateCount: 0,
      status: "delivered",
    });
    expect(mocks.deliverHostedVaultShareNights).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("delivers only the in-window nights when an offer mixes stale and fresh nights", async () => {
    const freshNight = recentNight(1);
    const response = await deliverRoute.POST(
      buildRequest({
        nights: [
          {
            date: "1999-01-01",
            sleepEndAt: "1999-01-01T06:31:00.000Z",
            sleepStartAt: "1998-12-31T22:04:00.000Z",
          },
          freshNight,
        ],
        projectionKind: "sleep-times.v0",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appendedCount: 1,
      duplicateCount: 0,
      status: "delivered",
    });
    expect(mocks.deliverHostedVaultShareNights).toHaveBeenCalledTimes(1);
    expect(mocks.deliverHostedVaultShareNights).toHaveBeenCalledWith({
      nights: [freshNight],
      share: ACTIVE_SHARE,
    });
  });

  it("rejects payloads that do not match the closed schema", async () => {
    const response = await deliverRoute.POST(
      buildRequest({
        nights: [{ date: "whenever", sleepEndAt: "x", sleepStartAt: "y" }],
        projectionKind: "sleep-times.v0",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.findActiveHostedVaultShares).not.toHaveBeenCalled();
    expect(mocks.deliverHostedVaultShareNights).not.toHaveBeenCalled();
  });

  it("does not let a grantor deliver as someone else: identity comes from callback auth only", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_other");
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_other",
      projectionKind: "sleep-times.v0",
    });
    expect(await response.json()).toEqual({
      appendedCount: 0,
      duplicateCount: 0,
      status: "no-active-share",
    });
  });

  it("still reports delivered when the wake signal fails after a durable append", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(new Error("temporal down"));

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      appendedCount: 1,
      duplicateCount: 0,
      status: "delivered",
    });
  });
});
