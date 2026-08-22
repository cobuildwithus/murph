import { beforeEach, describe, expect, it, vi } from "vitest";

const secureBoxMocks = vi.hoisted(() => ({
  openHostedUserSecureBoxString: vi.fn(),
  openHostedUserSecureBoxStrings: vi.fn(),
  sealHostedUserSecureBoxString: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/secure-box", () => secureBoxMocks);

import { readHostedPhoneCallStatus } from "@/src/lib/phone-calls/status";

describe("hosted phone-call status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds an exact lookup to the authenticated member and returns its result", async () => {
    const findMany = vi.fn(async () => [{
      analyzedAt: new Date("2026-09-01T15:01:10.000Z"),
      createdAt: new Date("2026-09-01T15:00:00.000Z"),
      endedAt: new Date("2026-09-01T15:01:00.000Z"),
      id: "hpc_status_exact",
      memberId: "member_status_owner",
      resultEncrypted: null,
      resultJson: {
        followUp: "The requester must provide one missing detail.",
        outcome: "not_completed",
        summary: "The requested task was not completed.",
      },
      status: "failed" as const,
      stopRequestedAt: null,
      updatedAt: new Date("2026-09-01T15:01:10.000Z"),
    }]);

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      phoneCallId: "hpc_status_exact",
      prisma: {
        hostedPhoneCall: { findMany },
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 1,
      where: {
        id: "hpc_status_exact",
        memberId: "member_status_owner",
      },
    }));
    expect(result.calls).toEqual([expect.objectContaining({
      phoneCallId: "hpc_status_exact",
      result: expect.objectContaining({
        outcome: "not_completed",
      }),
      status: "failed",
    })]);
  });

  it("caps an unscoped lookup to the three most recent member calls", async () => {
    const findMany = vi.fn(async () => []);

    await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: { findMany },
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
      where: {
        memberId: "member_status_owner",
      },
    }));
  });

  it("exposes a durable but unconfirmed stop request in member status", async () => {
    const timestamp = new Date("2026-09-01T15:00:00.000Z");
    const stopRequestedAt = new Date("2026-09-01T15:01:00.000Z");

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: {
          findMany: vi.fn(async () => [{
            analyzedAt: null,
            createdAt: timestamp,
            endedAt: null,
            id: "hpc_status_stop_pending",
            memberId: "member_status_owner",
            resultEncrypted: null,
            resultJson: null,
            status: "starting" as const,
            stopRequestedAt,
            updatedAt: stopRequestedAt,
          }]),
        },
      },
    });

    expect(result.calls[0]).toMatchObject({
      phoneCallId: "hpc_status_stop_pending",
      status: "starting",
      stopRequestedAt: stopRequestedAt.toISOString(),
    });
  });

  it("exposes a durable cleanup fallback before notification retry succeeds", async () => {
    const timestamp = new Date("2026-09-01T15:00:00.000Z");
    secureBoxMocks.openHostedUserSecureBoxStrings.mockResolvedValueOnce([
      JSON.stringify({
        followUp:
          "Confirm the outcome with the call recipient before repeating the request.",
        outcome: "needs_user",
        summary:
          "The call is no longer active, but Murph could not safely verify whether the request was completed.",
      }),
    ]);

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: {
          findMany: vi.fn(async () => [{
            analyzedAt: null,
            createdAt: timestamp,
            endedAt: null,
            id: "hpc_status_cleanup_fallback",
            memberId: "member_status_owner",
            resultEncrypted: "encrypted-cleanup-fallback",
            resultJson: null,
            status: "failed" as const,
            stopRequestedAt: null,
            updatedAt: timestamp,
          }]),
        },
      },
    });

    expect(result.calls[0]).toMatchObject({
      analyzedAt: null,
      phoneCallId: "hpc_status_cleanup_fallback",
      result: {
        outcome: "needs_user",
      },
      status: "failed",
    });
  });

  it("keeps a safely ended call result empty while provider analysis is pending", async () => {
    const timestamp = new Date("2026-09-01T15:00:00.000Z");

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: {
          findMany: vi.fn(async () => [{
            analyzedAt: null,
            createdAt: timestamp,
            endedAt: timestamp,
            id: "hpc_status_awaiting_analysis",
            memberId: "member_status_owner",
            resultEncrypted: null,
            resultJson: null,
            status: "ended" as const,
            stopRequestedAt: null,
            updatedAt: timestamp,
          }]),
        },
      },
    });

    expect(result.calls[0]).toMatchObject({
      analyzedAt: null,
      phoneCallId: "hpc_status_awaiting_analysis",
      result: null,
      status: "ended",
    });
    expect(secureBoxMocks.openHostedUserSecureBoxStrings).not.toHaveBeenCalled();
  });

  it("opens the three-result status window through one bounded secure-box batch", async () => {
    const createdAt = new Date("2026-09-01T15:00:00.000Z");
    const calls = [0, 1, 2].map((index) => ({
      analyzedAt: createdAt,
      createdAt,
      endedAt: createdAt,
      id: `hpc_status_batch_${index}`,
      memberId: "member_status_owner",
      resultEncrypted: `encrypted-result-${index}`,
      resultJson: null,
      status: "completed" as const,
      stopRequestedAt: null,
      updatedAt: createdAt,
    }));
    secureBoxMocks.openHostedUserSecureBoxStrings.mockResolvedValueOnce(
      calls.map((_, index) => JSON.stringify({
        outcome: "completed",
        summary: `Completed call ${index}.`,
      })),
    );

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: { findMany: vi.fn(async () => calls) },
      },
    });

    expect(secureBoxMocks.openHostedUserSecureBoxStrings).toHaveBeenCalledOnce();
    expect(secureBoxMocks.openHostedUserSecureBoxStrings).toHaveBeenCalledWith({
      entries: calls.map((call) => ({
        aad: {
          field: "result_encrypted",
          purpose: "hosted-phone-call-private-content",
          rowId: call.id,
          table: "hosted_phone_call",
        },
        scope: "hosted-phone-call:result",
        userId: "member_status_owner",
        value: call.resultEncrypted,
      })),
      lane: "hosted-member-private-field",
      prisma: undefined,
      signal: undefined,
    });
    expect(result.calls.map((call) => call.result?.summary)).toEqual([
      "Completed call 0.",
      "Completed call 1.",
      "Completed call 2.",
    ]);
  });

  it("batches only encrypted results while preserving mixed result order", async () => {
    const timestamp = new Date("2026-09-01T15:00:00.000Z");
    const calls = [{
      analyzedAt: timestamp,
      createdAt: timestamp,
      endedAt: timestamp,
      id: "hpc_status_clear",
      memberId: "member_status_owner",
      resultEncrypted: null,
      resultJson: {
        outcome: "completed",
        summary: "Clear legacy result.",
      },
      status: "completed" as const,
      stopRequestedAt: null,
      updatedAt: timestamp,
    }, {
      analyzedAt: timestamp,
      createdAt: timestamp,
      endedAt: timestamp,
      id: "hpc_status_encrypted",
      memberId: "member_status_owner",
      resultEncrypted: "encrypted-result",
      resultJson: null,
      status: "failed" as const,
      stopRequestedAt: null,
      updatedAt: timestamp,
    }];
    secureBoxMocks.openHostedUserSecureBoxStrings.mockResolvedValueOnce([
      JSON.stringify({
        outcome: "not_completed",
        summary: "Encrypted current result.",
      }),
    ]);

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: { findMany: vi.fn(async () => calls) },
      },
    });

    expect(secureBoxMocks.openHostedUserSecureBoxStrings).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ value: "encrypted-result" })],
      }),
    );
    expect(result.calls.map((call) => call.result?.summary)).toEqual([
      "Clear legacy result.",
      "Encrypted current result.",
    ]);
  });
});
