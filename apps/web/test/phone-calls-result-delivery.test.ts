import type {
  HostedPhoneCallResultDeliveryStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  rearmRecovery: vi.fn(async () => true),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/phone-calls/reconciliation-workflow-start", () => ({
  rearmHostedPhoneCallResultNotificationRecovery: mocks.rearmRecovery,
}));

import {
  recordHostedPhoneCallResultDeliveryOutcome,
} from "@/src/lib/phone-calls/result-delivery";

const CALL_ID = "hpc_result_delivery";
const MEMBER_ID = "member_result_delivery";

describe("hosted phone-call result delivery ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records provider entry without releasing the durable obligation", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    })).resolves.toEqual({ recorded: true, status: "sending" });

    expect(store.readStatus()).toBe("sending");
    expect(store.readTerminalAt()).toBeNull();
    expect(mocks.rearmRecovery).not.toHaveBeenCalled();
  });

  it("marks provider success terminal and re-arms the next obligation", async () => {
    const store = createDeliveryStore("sending");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sent"),
    })).resolves.toEqual({ recorded: true, status: "delivered" });

    expect(store.readStatus()).toBe("delivered");
    expect(store.readTerminalAt()).toBeInstanceOf(Date);
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("accepts an old runner's terminal outcome from queued during rollout", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sent"),
    })).resolves.toEqual({ recorded: true, status: "delivered" });

    expect(store.readStatus()).toBe("delivered");
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("returns pre-provider route loss to pending for a new generation", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: {
        ...deliveryRequest("failed"),
        deliveryErrorCode: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      },
    })).resolves.toEqual({ recorded: true, status: "pending" });

    expect(store.readStatus()).toBe("pending");
    expect(store.readTerminalAt()).toBeNull();
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("makes route loss terminally ambiguous after provider entry", async () => {
    const store = createDeliveryStore("sending");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: {
        ...deliveryRequest("failed"),
        deliveryErrorCode: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      },
    })).resolves.toEqual({ recorded: true, status: "ambiguous" });

    expect(store.readStatus()).toBe("ambiguous");
    expect(store.readTerminalAt()).toBeInstanceOf(Date);
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("preserves an ambiguous provider outcome without resending", async () => {
    const store = createDeliveryStore("sending");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("failed_ambiguous"),
    })).resolves.toEqual({ recorded: true, status: "ambiguous" });

    expect(store.readStatus()).toBe("ambiguous");
    expect(store.readTerminalAt()).toBeInstanceOf(Date);
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("ignores stale-generation callbacks without disturbing current work", async () => {
    const store = createDeliveryStore("queued", 2);
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sent"),
    })).resolves.toEqual({ recorded: false, status: "queued" });

    expect(store.updateMany).not.toHaveBeenCalled();
    expect(mocks.rearmRecovery).not.toHaveBeenCalled();
  });

  it("blocks stale-generation provider entry before another send", async () => {
    const store = createDeliveryStore("queued", 2);
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_TRANSITION_INVALID",
      retryable: false,
    });

    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("blocks provider entry after the call row is terminal", async () => {
    const store = createDeliveryStore("delivered");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_TRANSITION_INVALID",
      retryable: false,
    });

    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("replays terminal callbacks to repair a failed recovery re-arm", async () => {
    const store = createDeliveryStore("delivered");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sent"),
    })).resolves.toEqual({ recorded: false, status: "delivered" });

    expect(store.updateMany).not.toHaveBeenCalled();
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });
});

function deliveryRequest(
  status: "failed" | "failed_ambiguous" | "sending" | "sent",
) {
  return {
    generation: 1,
    phoneCallId: CALL_ID,
    status,
  } as const;
}

function createDeliveryStore(
  initialStatus: HostedPhoneCallResultDeliveryStatus,
  initialGeneration = 1,
) {
  const generation = initialGeneration;
  let status = initialStatus;
  let terminalAt: Date | null = null;
  const updateMany = vi.fn(async (input: {
    data: {
      resultDeliveryStatus: HostedPhoneCallResultDeliveryStatus;
      resultDeliveryTerminalAt: Date | null;
    };
    where: {
      resultDeliveryGeneration: number;
      resultDeliveryStatus: HostedPhoneCallResultDeliveryStatus;
    };
  }) => {
    if (
      input.where.resultDeliveryGeneration !== generation
      || input.where.resultDeliveryStatus !== status
    ) {
      return { count: 0 };
    }
    status = input.data.resultDeliveryStatus;
    terminalAt = input.data.resultDeliveryTerminalAt;
    return { count: 1 };
  });
  return {
    prisma: {
      hostedPhoneCall: {
        findFirst: vi.fn(async () => ({
          resultDeliveryGeneration: generation,
          resultDeliveryStatus: status,
        })),
        updateMany,
      },
    },
    readStatus: () => status,
    readTerminalAt: () => terminalAt,
    updateMany,
  };
}
