import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery,
} from "@/src/lib/hosted-runtime-latency/delivery-link";

describe("hosted ingress latency delivery linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({
      hostedIngressLatencyTrace: {
        updateMany: mocks.updateMany,
      },
    });
    mocks.updateMany.mockResolvedValue({ count: 2 });
  });

  it("links only the authenticated attempt's exact mailbox rows", async () => {
    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: [
        "mailbox_item_1",
        " mailbox_item_2 ",
        "mailbox_item_1",
      ],
      authenticatedUserId: "member_123",
      linqDeliveryId: "hld_123",
      replyRuntimeAttemptId: "runtime_attempt_123",
    })).resolves.toEqual({
      matchedCount: 2,
      recorded: true,
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      data: {
        linqDeliveryId: "hld_123",
        replyRuntimeAttemptId: "runtime_attempt_123",
      },
      where: {
        linqDeliveryId: null,
        mailboxItemId: {
          in: ["mailbox_item_1", "mailbox_item_2"],
        },
        replyRuntimeAttemptId: null,
        runtimeAttemptId: "runtime_attempt_123",
        source: "linq",
        userId: "member_123",
      },
    });
  });

  it("atomically preserves the first accepted delivery link", async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_item_1"],
      authenticatedUserId: "member_123",
      linqDeliveryId: "hld_first",
      replyRuntimeAttemptId: "runtime_attempt_123",
    });
    const second = await linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_item_1"],
      authenticatedUserId: "member_123",
      linqDeliveryId: "hld_second",
      replyRuntimeAttemptId: "runtime_attempt_123",
    });

    expect(first).toEqual({ matchedCount: 1, recorded: true });
    expect(second).toEqual({ matchedCount: 0, recorded: false });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        linqDeliveryId: null,
        replyRuntimeAttemptId: null,
      }),
    }));
  });

  it("does no database work without answered mailbox rows", async () => {
    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: [],
      authenticatedUserId: "member_123",
      linqDeliveryId: "hld_123",
      replyRuntimeAttemptId: "runtime_attempt_123",
    })).resolves.toEqual({ matchedCount: 0, recorded: false });

    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unsafe link identifiers before querying", async () => {
    await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
      answeredMailboxItemIds: ["mailbox_item_1"],
      authenticatedUserId: "member_123",
      linqDeliveryId: "hld_123",
      replyRuntimeAttemptId: "runtime attempt with spaces",
    })).rejects.toThrow("Hosted ingress latency reply runtime attempt id is invalid.");

    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
