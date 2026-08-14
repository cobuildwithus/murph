import { describe, expect, it, vi } from "vitest";

import { stopHostedPhoneCall } from "@/src/lib/phone-calls/control";

describe("hosted phone-call control", () => {
  it("stops only an exact member-bound provider call and persists the end", async () => {
    const call = {
      analyzedAt: null,
      endedAt: null,
      id: "hpc_stop_exact",
      memberId: "member_stop_owner",
      providerCallId: "provider_stop_exact",
      status: "calling" as const,
    };
    const findFirst = vi.fn(async () => call);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const stopIfActive = vi.fn(async () => {});

    const result = await stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_exact",
      prisma: {
        hostedPhoneCall: {
          findFirst,
          updateMany,
        },
      },
      runtime: { stopIfActive },
      signal: new AbortController().signal,
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "hpc_stop_exact",
        memberId: "member_stop_owner",
      },
    }));
    expect(stopIfActive).toHaveBeenCalledWith("provider_stop_exact", {
      signal: expect.any(AbortSignal),
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        endedAt: expect.any(Date),
        status: "ended",
      },
      where: expect.objectContaining({
        id: "hpc_stop_exact",
        memberId: "member_stop_owner",
        providerCallId: "provider_stop_exact",
      }),
    }));
    expect(result).toEqual({
      phoneCallId: "hpc_stop_exact",
      state: "stopped",
      status: "ended",
    });
  });

  it("does not claim termination before provider authority is known", async () => {
    const stopIfActive = vi.fn(async () => {});

    const result = await stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_starting",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => ({
            analyzedAt: null,
            endedAt: null,
            id: "hpc_stop_starting",
            memberId: "member_stop_owner",
            providerCallId: null,
            status: "starting" as const,
          })),
          updateMany: vi.fn(),
        },
      },
      runtime: { stopIfActive },
      signal: new AbortController().signal,
    });

    expect(stopIfActive).not.toHaveBeenCalled();
    expect(result).toEqual({
      phoneCallId: "hpc_stop_starting",
      state: "start_pending",
      status: "starting",
    });
  });

  it("treats an already-terminal call as an idempotent no-op", async () => {
    const stopIfActive = vi.fn(async () => {});
    const updateMany = vi.fn();

    const result = await stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_terminal",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => ({
            analyzedAt: new Date("2026-09-01T15:01:10.000Z"),
            endedAt: new Date("2026-09-01T15:01:00.000Z"),
            id: "hpc_stop_terminal",
            memberId: "member_stop_owner",
            providerCallId: "provider_stop_terminal",
            status: "completed" as const,
          })),
          updateMany,
        },
      },
      runtime: { stopIfActive },
      signal: new AbortController().signal,
    });

    expect(stopIfActive).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      phoneCallId: "hpc_stop_terminal",
      state: "already_terminal",
      status: "completed",
    });
  });

  it("returns a retryable error when provider termination is unconfirmed", async () => {
    await expect(stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_retry",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => ({
            analyzedAt: null,
            endedAt: null,
            id: "hpc_stop_retry",
            memberId: "member_stop_owner",
            providerCallId: "provider_stop_retry",
            status: "calling" as const,
          })),
          updateMany: vi.fn(),
        },
      },
      runtime: {
        stopIfActive: vi.fn(async () => {
          throw new Error("synthetic provider failure");
        }),
      },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_STOP_RETRY_REQUIRED",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("does not reveal whether another member owns a requested call id", async () => {
    const result = await stopHostedPhoneCall({
      memberId: "member_stop_requester",
      phoneCallId: "hpc_stop_foreign",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => null),
          updateMany: vi.fn(),
        },
      },
      runtime: { stopIfActive: vi.fn() },
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      phoneCallId: "hpc_stop_foreign",
      state: "not_found",
      status: null,
    });
  });
});
