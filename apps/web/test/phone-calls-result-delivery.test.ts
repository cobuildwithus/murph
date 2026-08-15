import type {
  HostedPhoneCallResultDeliveryStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRouteAuthority: vi.fn(async () => undefined),
  getPrisma: vi.fn(),
  rearmRecovery: vi.fn(async () => true),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/phone-calls/reconciliation-workflow-start", () => ({
  rearmHostedPhoneCallResultNotificationRecovery: mocks.rearmRecovery,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  assertHostedAssistantNotificationRouteAuthority:
    mocks.assertRouteAuthority,
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
    expect(mocks.assertRouteAuthority).toHaveBeenCalledWith({
      authority: {
        channel: "telegram",
        containerMemberId: MEMBER_ID,
        threadId: "telegram_result_delivery",
      },
      prisma: store.prisma,
      signal: undefined,
    });
    expect(mocks.rearmRecovery).not.toHaveBeenCalled();
  });

  it("rejects revoked route authority before provider entry is recorded", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);
    mocks.assertRouteAuthority.mockRejectedValueOnce(Object.assign(
      new Error("route revoked"),
      { code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED" },
    ));

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    });

    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("revalidates authority when a committed provider-entry callback is retried", async () => {
    const store = createDeliveryStore("sending");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    })).resolves.toEqual({ recorded: false, status: "sending" });

    expect(mocks.assertRouteAuthority).toHaveBeenCalledOnce();
    expect(store.updateMany).not.toHaveBeenCalled();
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

  it("rejects provider success while the generation still proves pre-provider queued", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sent"),
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_TRANSITION_INVALID",
      retryable: false,
    });

    expect(store.readStatus()).toBe("queued");
    expect(store.updateMany).not.toHaveBeenCalled();
    expect(mocks.rearmRecovery).not.toHaveBeenCalled();
  });

  it("records a definitive pre-provider failure while Web still proves queued", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: {
        ...deliveryRequest("failed"),
        deliveryErrorCode: "ASSISTANT_DELIVERY_RETRY_EXHAUSTED",
      },
    })).resolves.toEqual({ recorded: true, status: "failed" });

    expect(store.readStatus()).toBe("failed");
    expect(store.readTerminalAt()).toBeInstanceOf(Date);
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("replays a committed queued failure to repair a lost recovery response", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);
    mocks.rearmRecovery
      .mockRejectedValueOnce(new Error("re-arm response lost"))
      .mockResolvedValueOnce(true);
    const request = {
      ...deliveryRequest("failed"),
      deliveryErrorCode: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
    };

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request,
    })).rejects.toThrow("re-arm response lost");
    expect(store.readStatus()).toBe("failed");

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request,
    })).resolves.toEqual({ recorded: false, status: "failed" });

    expect(store.updateMany).toHaveBeenCalledOnce();
    expect(mocks.rearmRecovery).toHaveBeenCalledTimes(2);
  });

  it("returns a stale no-receipt attempt to pending while Web proves pre-provider queued", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("failed_ambiguous"),
    })).resolves.toEqual({ recorded: true, status: "pending" });

    expect(store.readStatus()).toBe("pending");
    expect(store.readTerminalAt()).toBeNull();
    expect(mocks.rearmRecovery).toHaveBeenCalledOnce();
  });

  it("lets queued recovery win a race against provider entry before its CAS", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);
    let releaseProviderEntry!: () => void;
    let markProviderEntryStarted!: () => void;
    const providerEntryStarted = new Promise<void>((resolve) => {
      markProviderEntryStarted = resolve;
    });
    const providerEntryGate = new Promise<void>((resolve) => {
      releaseProviderEntry = resolve;
    });
    mocks.assertRouteAuthority.mockImplementationOnce(async () => {
      markProviderEntryStarted();
      await providerEntryGate;
    });

    const sending = recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    });
    await providerEntryStarted;

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("failed_ambiguous"),
    })).resolves.toEqual({ recorded: true, status: "pending" });
    releaseProviderEntry();

    await expect(sending).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_TRANSITION_INVALID",
      retryable: false,
    });
    expect(store.readStatus()).toBe("pending");
    expect(store.readTerminalAt()).toBeNull();
  });

  it("lets a definitive queued failure win a race against provider entry before its CAS", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);
    let releaseProviderEntry!: () => void;
    let markProviderEntryStarted!: () => void;
    const providerEntryStarted = new Promise<void>((resolve) => {
      markProviderEntryStarted = resolve;
    });
    const providerEntryGate = new Promise<void>((resolve) => {
      releaseProviderEntry = resolve;
    });
    mocks.assertRouteAuthority.mockImplementationOnce(async () => {
      markProviderEntryStarted();
      await providerEntryGate;
    });

    const sending = recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("sending"),
    });
    await providerEntryStarted;

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: {
        ...deliveryRequest("failed"),
        deliveryErrorCode: "ASSISTANT_TELEGRAM_TOKEN_REQUIRED",
      },
    })).resolves.toEqual({ recorded: true, status: "failed" });
    releaseProviderEntry();

    await expect(sending).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_TRANSITION_INVALID",
      retryable: false,
    });
    expect(store.readStatus()).toBe("failed");
    expect(store.readTerminalAt()).toBeInstanceOf(Date);
  });

  it("replays stale pre-provider recovery after Web commits pending but re-arm fails", async () => {
    const store = createDeliveryStore("queued");
    mocks.getPrisma.mockReturnValue(store.prisma);
    mocks.rearmRecovery
      .mockRejectedValueOnce(new Error("re-arm response lost"))
      .mockResolvedValueOnce(true);

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("failed_ambiguous"),
    })).rejects.toThrow("re-arm response lost");
    expect(store.readStatus()).toBe("pending");

    await expect(recordHostedPhoneCallResultDeliveryOutcome({
      memberId: MEMBER_ID,
      request: deliveryRequest("failed_ambiguous"),
    })).resolves.toEqual({ recorded: false, status: "pending" });

    expect(store.updateMany).toHaveBeenCalledOnce();
    expect(mocks.rearmRecovery).toHaveBeenCalledTimes(2);
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

  it("fails closed when a tracked delivery has no generation", async () => {
    const store = createDeliveryStore("queued", null);
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

function deliveryRequest(status: "sending"): {
  generation: number;
  phoneCallId: string;
  routeAuthority: {
    channel: "telegram";
    containerMemberId: string;
    threadId: string;
  };
  status: "sending";
};
function deliveryRequest(
  status: "failed" | "failed_ambiguous" | "sent",
): {
  generation: number;
  phoneCallId: string;
  status: "failed" | "failed_ambiguous" | "sent";
};
function deliveryRequest(
  status: "failed" | "failed_ambiguous" | "sending" | "sent",
) {
  return status === "sending"
    ? {
        generation: 1,
        phoneCallId: CALL_ID,
        routeAuthority: {
          channel: "telegram" as const,
          containerMemberId: MEMBER_ID,
          threadId: "telegram_result_delivery",
        },
        status,
      }
    : {
        generation: 1,
        phoneCallId: CALL_ID,
        status,
      };
}

function createDeliveryStore(
  initialStatus: HostedPhoneCallResultDeliveryStatus,
  initialGeneration: number | null = 1,
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
