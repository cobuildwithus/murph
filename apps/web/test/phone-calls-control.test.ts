import { describe, expect, it, vi } from "vitest";

import { stopHostedPhoneCall } from "@/src/lib/phone-calls/control";

describe("hosted phone-call control", () => {
  it("durably fences an exact member-bound call and delegates provider control", async () => {
    const findFirst = vi.fn(async () => ({
      analyzedAt: null,
      endedAt: null,
      id: "hpc_stop_exact",
      memberId: "member_stop_owner",
      providerCallId: "provider_stop_exact",
      status: "calling" as const,
      stopRequestedAt: null,
    }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const reconciliationWorkflowStarter = vi.fn(async () => ({
      runId: "run_stop",
    }));

    await expect(stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_exact",
      prisma: {
        hostedPhoneCall: {
          findFirst,
          updateMany,
        },
      },
      reconciliationWorkflowStarter,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      phoneCallId: "hpc_stop_exact",
      state: "start_pending",
      status: "calling",
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "hpc_stop_exact",
        memberId: "member_stop_owner",
      },
    }));
    expect(updateMany).toHaveBeenCalledWith({
      data: { stopRequestedAt: expect.any(Date) },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: "hpc_stop_exact",
        memberId: "member_stop_owner",
        status: {
          in: ["starting", "calling", "ended", "failed"],
        },
        stopRequestedAt: null,
      },
    });
    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith(
      { phoneCallId: "hpc_stop_exact" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("re-arms workflow recovery without another write for a repeated durable stop", async () => {
    const updateMany = vi.fn();
    const reconciliationWorkflowStarter = vi.fn();

    await expect(stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_repeat",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => ({
            analyzedAt: null,
            endedAt: null,
            id: "hpc_stop_repeat",
            memberId: "member_stop_owner",
            providerCallId: "provider_stop_repeat",
            status: "calling" as const,
            stopRequestedAt: new Date("2026-09-01T15:00:00.000Z"),
          })),
          updateMany,
        },
      },
      reconciliationWorkflowStarter,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      phoneCallId: "hpc_stop_repeat",
      state: "start_pending",
      status: "calling",
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith(
      { phoneCallId: "hpc_stop_repeat" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps the durable fence when the best-effort workflow wake fails", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));

    await expect(stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: "hpc_stop_wake_retry",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => ({
            analyzedAt: null,
            endedAt: null,
            id: "hpc_stop_wake_retry",
            memberId: "member_stop_owner",
            providerCallId: null,
            status: "starting" as const,
            stopRequestedAt: null,
          })),
          updateMany,
        },
      },
      reconciliationWorkflowStarter: vi.fn(async () => {
        throw new Error("workflow unavailable");
      }),
      signal: new AbortController().signal,
    })).resolves.toEqual({
      phoneCallId: "hpc_stop_wake_retry",
      state: "start_pending",
      status: "starting",
    });

    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("treats an already-terminal call as an idempotent no-op", async () => {
    const updateMany = vi.fn();

    await expect(stopHostedPhoneCall({
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
            stopRequestedAt: null,
          })),
          updateMany,
        },
      },
      signal: new AbortController().signal,
    })).resolves.toEqual({
      phoneCallId: "hpc_stop_terminal",
      state: "already_terminal",
      status: "completed",
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not reveal whether another member owns a requested call id", async () => {
    await expect(stopHostedPhoneCall({
      memberId: "member_stop_requester",
      phoneCallId: "hpc_stop_foreign",
      prisma: {
        hostedPhoneCall: {
          findFirst: vi.fn(async () => null),
          updateMany: vi.fn(),
        },
      },
      signal: new AbortController().signal,
    })).resolves.toEqual({
      phoneCallId: "hpc_stop_foreign",
      state: "not_found",
      status: null,
    });
  });

  it("returns terminal truth when the fence loses a completion race", async () => {
    const terminal = {
      analyzedAt: new Date("2026-09-01T15:01:10.000Z"),
      endedAt: new Date("2026-09-01T15:01:00.000Z"),
      id: "hpc_stop_race",
      memberId: "member_stop_owner",
      providerCallId: "provider_stop_race",
      status: "completed" as const,
      stopRequestedAt: null,
    };
    const findFirst = vi.fn()
      .mockResolvedValueOnce({
        ...terminal,
        analyzedAt: null,
        endedAt: null,
        status: "calling" as const,
      })
      .mockResolvedValueOnce(terminal);

    await expect(stopHostedPhoneCall({
      memberId: "member_stop_owner",
      phoneCallId: terminal.id,
      prisma: {
        hostedPhoneCall: {
          findFirst,
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
      },
      signal: new AbortController().signal,
    })).resolves.toEqual({
      phoneCallId: terminal.id,
      state: "already_terminal",
      status: "completed",
    });
  });
});
