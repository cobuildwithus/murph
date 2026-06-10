import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliverHostedVaultShareRecords: vi.fn(),
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
  deliverHostedVaultShareRecords: mocks.deliverHostedVaultShareRecords,
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

function recentRecord(daysAgo: number): {
  data: { date: string; sleepEndAt: string; sleepStartAt: string };
  occurredAt: string;
  recordKey: string;
} {
  const end = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 8 * 60 * 60 * 1000);
  const date = end.toISOString().slice(0, 10);

  return {
    data: {
      date,
      sleepEndAt: end.toISOString(),
      sleepStartAt: start.toISOString(),
    },
    // occurredAt is parser-pinned to the night-date midnight: it becomes plaintext mailbox
    // metadata, so it must disclose nothing beyond the night date.
    occurredAt: `${date}T00:00:00.000Z`,
    recordKey: date,
  };
}

const STALE_RECORD = {
  data: {
    date: "1999-01-01",
    sleepEndAt: "1999-01-01T06:31:00.000Z",
    sleepStartAt: "1998-12-31T22:04:00.000Z",
  },
  occurredAt: "1999-01-01T00:00:00.000Z",
  recordKey: "1999-01-01",
};

const VALID_BODY = {
  projectionKind: "sleep-times.v0",
  records: [recentRecord(1)],
};

const ACTIVE_SHARE = {
  destinationMemberId: "member_referee",
  grantorMemberId: "member_grantor",
  id: "share_1",
  projectionKind: "sleep-times.v0",
};

const SECOND_SHARE = {
  destinationMemberId: "member_other_referee",
  grantorMemberId: "member_grantor",
  id: "share_2",
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
    mocks.deliverHostedVaultShareRecords.mockResolvedValue({
      lastAppendedMailboxItemId: "mailbox_item_1",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({ signaled: true });
  });

  it("delivers offered records to every active share and signals the destination", async () => {
    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_grantor",
      projectionKind: "sleep-times.v0",
    });
    expect(mocks.deliverHostedVaultShareRecords).toHaveBeenCalledWith({
      records: VALID_BODY.records,
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
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.deliverHostedVaultShareRecords).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("treats an inactive destination exactly like a missing grant", async () => {
    mocks.hasHostedMemberActiveAccess.mockReturnValue(false);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.deliverHostedVaultShareRecords).not.toHaveBeenCalled();
  });

  it("silently drops an all-stale offer instead of erroring", async () => {
    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [STALE_RECORD],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.deliverHostedVaultShareRecords).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("keeps an all-stale offer indistinguishable when the destination is inactive", async () => {
    // The status must be a function of share configuration alone: a grantor probing with
    // stale records learns nothing finer than the normal active/no-active-share split.
    mocks.hasHostedMemberActiveAccess.mockReturnValue(false);

    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [STALE_RECORD],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "no-active-share" });
    expect(mocks.deliverHostedVaultShareRecords).not.toHaveBeenCalled();
  });

  it("delivers only the in-window records when an offer mixes stale and fresh records", async () => {
    const freshRecord = recentRecord(1);
    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [STALE_RECORD, freshRecord],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.deliverHostedVaultShareRecords).toHaveBeenCalledTimes(1);
    expect(mocks.deliverHostedVaultShareRecords).toHaveBeenCalledWith({
      records: [freshRecord],
      share: ACTIVE_SHARE,
    });
  });

  it("keeps delivering to later shares when an earlier share's delivery fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      mocks.findActiveHostedVaultShares.mockResolvedValue([ACTIVE_SHARE, SECOND_SHARE]);
      mocks.readHostedMemberCoreState
        .mockResolvedValueOnce({ id: "member_referee" })
        .mockResolvedValueOnce({ id: "member_other_referee" });
      mocks.deliverHostedVaultShareRecords
        .mockRejectedValueOnce(new Error("destination mailbox down"))
        .mockResolvedValueOnce({ lastAppendedMailboxItemId: "mailbox_item_2" });

      const response = await deliverRoute.POST(buildRequest(VALID_BODY));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "delivered" });
      expect(mocks.deliverHostedVaultShareRecords).toHaveBeenCalledTimes(2);
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
        expectedUserId: "member_other_referee",
        mailboxItemId: "mailbox_item_2",
      });
      // The operator log carries ids only — never payload fields, timestamps, or the
      // raw error message, which could echo destination state back into shared logs.
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "Hosted vault-share delivery to a destination share failed.",
        { errorName: "Error", shareId: "share_1" },
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("skips the wake signal when every offered record is a dedupe duplicate", async () => {
    // Re-offering already-delivered nights appends nothing; waking the destination for a
    // no-op import would be pure noise, and the response still reveals only "delivered".
    mocks.deliverHostedVaultShareRecords.mockResolvedValue({
      lastAppendedMailboxItemId: null,
    });

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "delivered" });
    expect(mocks.deliverHostedVaultShareRecords).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("rejects payloads that do not match the closed schema", async () => {
    const response = await deliverRoute.POST(
      buildRequest({
        projectionKind: "sleep-times.v0",
        records: [{
          data: { date: "whenever", sleepEndAt: "x", sleepStartAt: "y" },
          occurredAt: "z",
          recordKey: "whenever",
        }],
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.findActiveHostedVaultShares).not.toHaveBeenCalled();
    expect(mocks.deliverHostedVaultShareRecords).not.toHaveBeenCalled();
  });

  it("does not let a grantor deliver as someone else: identity comes from callback auth only", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_other");
    mocks.findActiveHostedVaultShares.mockResolvedValue([]);

    const response = await deliverRoute.POST(buildRequest(VALID_BODY));

    expect(mocks.findActiveHostedVaultShares).toHaveBeenCalledWith({
      grantorMemberId: "member_other",
      projectionKind: "sleep-times.v0",
    });
    expect(await response.json()).toEqual({ status: "no-active-share" });
  });

  it("still reports delivered when the wake signal fails after a durable append", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(new Error("temporal down"));

      const response = await deliverRoute.POST(buildRequest(VALID_BODY));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "delivered" });
      // The append is durable and the destination imports on its next wake: a signal
      // failure is not a delivery failure and must not be logged as one.
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
