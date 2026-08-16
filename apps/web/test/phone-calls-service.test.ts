import type { HostedPhoneCall } from "@prisma/client";
import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";
import {
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";
import { describe, expect, it, vi } from "vitest";

import {
  decryptHostedPhoneCallBrief,
  encryptHostedPhoneCallBrief,
} from "@/src/lib/phone-calls/crypto";
import type {
  HostedAssistantNotificationDestination,
} from "@/src/lib/hosted-routing/assistant-notification-destination";
import {
  createHostedPhoneCall as createHostedPhoneCallImpl,
} from "@/src/lib/phone-calls/service";
import {
  processHostedPhoneCallRecoveryById,
  reconcileHostedPhoneCallProviderAuthority,
} from "@/src/lib/phone-calls/reconciliation";
import {
  markPhoneCallRuntimeNoActiveEffect,
  type PhoneCallRuntime,
} from "@/src/lib/phone-calls/types";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type CreateHostedPhoneCallInput = Parameters<typeof createHostedPhoneCallImpl>[0];
type TestCreateHostedPhoneCallInput =
  Omit<CreateHostedPhoneCallInput, "originSessionId"> & {
    originSessionId?: string;
  };
type PhoneCallStore = NonNullable<CreateHostedPhoneCallInput["prisma"]>;
type PhoneCallReserveInput = Parameters<PhoneCallStore["reserve"]>[0];
type PhoneCallFindFirstInput = Parameters<
  PhoneCallStore["hostedPhoneCall"]["findFirst"]
>[0];
type PhoneCallFindInput = Parameters<PhoneCallStore["hostedPhoneCall"]["findUnique"]>[0];
type PhoneCallUpdateManyInput = Parameters<PhoneCallStore["hostedPhoneCall"]["updateMany"]>[0];

const VALID_BRIEF: HostedPhoneCallBrief = {
  allowTransferToUser: true,
  goal: "Schedule a routine eye examination for Friday, June 26, 2026.",
  instructions: [
    "Only accept an appointment on Friday, June 26, 2026.",
  ],
  shareableFacts: {
    callback_number: "+12125550111",
    patient_name: "Alex",
  },
  successCriteria: "The office confirms the exact appointment time and location.",
  timeZone: "America/New_York",
  to: {
    label: "Eye doctor's office",
    phoneNumber: "+12125550123",
  },
};

const DIRECT_NOTIFICATION_DESTINATION: HostedAssistantNotificationDestination = {
  conversationShape: "direct-member",
  externalThreadRouteAuthority: null,
  route: {
    actorId: "member-actor",
    channel: "linq",
    delivery: {
      kind: "thread",
      target: "direct-chat",
    },
    identityId: "direct-identity",
    threadId: "direct-thread",
    threadIsDirect: true,
  },
};

const TELEGRAM_NOTIFICATION_DESTINATION: HostedAssistantNotificationDestination = {
  conversationShape: "direct-member",
  externalThreadRouteAuthority: null,
  route: {
    actorId: "telegram-member-actor",
    channel: "telegram",
    delivery: {
      kind: "thread",
      target: "telegram-direct-chat",
    },
    identityId: "telegram-direct-identity",
    threadId: "telegram-direct-thread",
    threadIsDirect: true,
  },
};

const GROUP_REQUESTER = {
  assistantInputId: `ain_${"1".repeat(32)}`,
  senderHandle: "+12125550123",
  source: "linq" as const,
};

const SCHEDULED_REQUEST_KEY = `phone_call_scheduled_${"a".repeat(64)}`;

const GROUP_NOTIFICATION_DESTINATION: HostedAssistantNotificationDestination = {
  conversationShape: "thread-container",
  externalThreadRouteAuthority: {
    accountLookupKey: "group-account-lookup",
    channel: "linq",
    containerMemberId: "member_1",
    threadId: "group-chat",
  },
  route: {
    actorId: null,
    channel: "linq",
    delivery: {
      kind: "thread",
      target: "group-chat",
    },
    identityId: "group-identity",
    threadId: "group-thread",
    threadIsDirect: false,
  },
};

describe("createHostedPhoneCall", () => {
  it("creates the local call row before starting Retell and stores the provider id", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });
    const runtime = createPhoneCallRuntime({
      onStart: () => {
        expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
          phoneCallId: store.createCalls[0]!.data.id,
        }, { signal: expect.any(AbortSignal) });
      },
      providerCallId: "retell_call_123",
    });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: "phone_call_request_1",
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver("+12125550000"),
    });

    expect(store.createCalls).toHaveLength(1);
    const createdCallId = store.createCalls[0]!.data.id;
    expect(createdCallId).toMatch(/^hpc_[a-f0-9]{32}$/u);
    expect(response).toEqual({
      phoneCallId: createdCallId,
      status: "calling",
    });
    expect(store.createCalls[0]!.data).toMatchObject({
      briefEncrypted: expect.stringMatching(/^hsb-test:/u),
      memberId: "member_1",
      originSessionId: "session_phone_call",
      provider: "retell",
      requestKey: "phone_call_request_1",
      resultNotificationChannel: null,
      status: "starting",
    });
    expect(store.createCalls[0]!.data).not.toHaveProperty("briefJson");
    expect(JSON.stringify(store.createCalls[0]!.data)).not.toContain(VALID_BRIEF.goal);
    expect(runtime.startCalls).toEqual([{
      brief: VALID_BRIEF,
      id: createdCallId,
      memberId: "member_1",
      transferNumber: "+12125550000",
    }]);
    expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
    expect(store.updateManyCalls).toEqual([{
      data: {
        providerCallId: "retell_call_123",
        status: "calling",
      },
      where: {
        analyzedAt: null,
        id: createdCallId,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    }]);
  });

  it("validates and persists a direct Telegram result route before provider dispatch", async () => {
    const store = createPhoneCallStore({ created: buildHostedPhoneCall() });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_telegram" });
    const notificationDestinationResolver = vi.fn(async () =>
      TELEGRAM_NOTIFICATION_DESTINATION);

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      notificationDestinationResolver,
      prisma: store.prisma,
      requestKey: "phone_call_telegram_request",
      resultNotificationChannel: "telegram",
      runtime: runtime.runtime,
    })).resolves.toMatchObject({ status: "calling" });

    expect(notificationDestinationResolver).toHaveBeenCalledTimes(2);
    expect(notificationDestinationResolver).toHaveBeenNthCalledWith(1, {
      directChannel: "telegram",
      memberId: "member_1",
      signal: expect.any(AbortSignal),
    });
    expect(notificationDestinationResolver).toHaveBeenNthCalledWith(2, {
      directChannel: "telegram",
      memberId: "member_1",
      signal: expect.any(AbortSignal),
    });
    expect(store.createCalls[0]?.data).toMatchObject({
      resultNotificationChannel: "telegram",
    });
    expect(runtime.startCalls).toHaveLength(1);
  });

  it.each([
    { providerCallId: null, status: "starting" as const },
    { providerCallId: "retell_calling", status: "calling" as const },
    { providerCallId: "retell_completed", status: "completed" as const },
  ])("replays a routed Telegram $status call after its live route is removed", async ({
    providerCallId,
    status,
  }) => {
    const existing = buildHostedPhoneCall({
      providerCallId,
      resultNotificationChannel: "telegram",
      status,
      ...(status === "starting" ? { updatedAt: new Date() } : {}),
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const notificationDestinationResolver = vi.fn(async () => {
      throw new Error("route removed");
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      notificationDestinationResolver,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      resultNotificationChannel: "telegram",
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: status === "starting" ? "starting" : "calling",
    });

    expect(notificationDestinationResolver).not.toHaveBeenCalled();
    expect(runtime.startCalls).toEqual([]);
  });

  it.each([
    { existingChannel: null, requestedChannel: "telegram" as const },
  ])("rejects a $existingChannel/$requestedChannel replay collision before route admission", async ({
    existingChannel,
    requestedChannel,
  }) => {
    const existing = buildHostedPhoneCall({
      resultNotificationChannel: existingChannel,
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const notificationDestinationResolver = vi.fn(async () => {
      throw new Error("route removed");
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      notificationDestinationResolver,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      resultNotificationChannel: requestedChannel,
      runtime: runtime.runtime,
    })).rejects.toThrow("request key collision");

    expect(notificationDestinationResolver).not.toHaveBeenCalled();
    expect(runtime.startCalls).toEqual([]);
  });

  it("fails a newly reserved Telegram call without provider ambiguity when its route is revoked before dispatch", async () => {
    const store = createPhoneCallStore({ created: buildHostedPhoneCall() });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const routeRevoked = hostedOnboardingError({
      code: "HOSTED_ASSISTANT_NOTIFICATION_ROUTE_REQUIRED",
      httpStatus: 409,
      message: "Hosted assistant delivery requires a durable notification route.",
      retryable: true,
    });
    const notificationDestinationResolver = vi.fn()
      .mockResolvedValueOnce(TELEGRAM_NOTIFICATION_DESTINATION)
      .mockRejectedValueOnce(routeRevoked);

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      notificationDestinationResolver,
      prisma: store.prisma,
      requestKey: "phone_call_telegram_route_revoked",
      resultNotificationChannel: "telegram",
      runtime: runtime.runtime,
    })).rejects.toBe(routeRevoked);

    expect(notificationDestinationResolver).toHaveBeenCalledTimes(2);
    expect(runtime.startCalls).toEqual([]);
    expect(store.currentCall()).toMatchObject({
      providerCallId: null,
      status: "failed",
    });
  });

  it("rejects a non-direct destination for a requested direct result channel before storage or dispatch", async () => {
    const store = createPhoneCallStore({ created: buildHostedPhoneCall() });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const notificationDestinationResolver = vi.fn(async () =>
      GROUP_NOTIFICATION_DESTINATION);

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      notificationDestinationResolver,
      prisma: store.prisma,
      requestKey: "phone_call_invalid_telegram_route",
      resultNotificationChannel: "telegram",
      runtime: runtime.runtime,
    })).rejects.toThrow(
      "result notification channel does not match the direct route",
    );

    expect(notificationDestinationResolver).toHaveBeenCalledWith({
      directChannel: "telegram",
      memberId: "member_1",
      signal: expect.any(AbortSignal),
    });
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it.each([
    "ended",
    "completed",
    "needs_user",
  ] as const)("reports a provider-bound %s replay as an accepted call", async (status) => {
    const existing = buildHostedPhoneCall({
      briefJson: null,
      endedAt: new Date("2026-06-25T12:00:00.000Z"),
      id: "hpc_existing",
      providerCallId: "retell_existing",
      status,
    });
    existing.briefEncrypted = await encryptHostedPhoneCallBrief({
      callId: existing.id,
      memberId: existing.memberId,
      value: VALID_BRIEF,
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "calling",
    });

    expect(runtime.startCalls).toEqual([]);
  });

  it("replays duplicate request keys for the same member without starting another provider call", async () => {
    const existing = buildHostedPhoneCall({
      briefJson: null,
      id: "hpc_existing",
      providerCallId: "retell_existing",
      status: "calling",
    });
    existing.briefEncrypted = await encryptHostedPhoneCallBrief({
      callId: existing.id,
      memberId: existing.memberId,
      value: VALID_BRIEF,
    });
    const store = createPhoneCallStore({
      existing,
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    });

    expect(response).toEqual({
      phoneCallId: "hpc_existing",
      status: "calling",
    });
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it("replays an existing call before running new-call prerequisites", async () => {
    const existing = buildHostedPhoneCall({
      briefJson: null,
      id: "hpc_existing",
      providerCallId: "retell_existing",
      status: "calling",
    });
    existing.briefEncrypted = await encryptHostedPhoneCallBrief({
      callId: existing.id,
      memberId: existing.memberId,
      value: VALID_BRIEF,
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const transferNumberResolver = vi.fn(async () => {
      throw new Error("new-call transfer prerequisite must not run");
    });

    await expect(createHostedPhoneCallDirect({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
      transferNumberResolver,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "calling",
    });

    expect(transferNumberResolver).not.toHaveBeenCalled();
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("retries stored unsafe cleanup authority without another provider create", async () => {
    const existing = buildHostedPhoneCall({
      briefJson: null,
      endedAt: null,
      id: "hpc_existing",
      providerCallId: "retell_unsafe",
      status: "failed",
    });
    existing.briefEncrypted = await encryptHostedPhoneCallBrief({
      callId: existing.id,
      memberId: existing.memberId,
      value: VALID_BRIEF,
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "failed",
    });

    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: existing.id,
    }, { signal: expect.any(AbortSignal) });
    expect(runtime.startCalls).toEqual([]);
    expect(runtime.stopCalls).toEqual(["retell_unsafe"]);
    expect(store.currentCall().endedAt).toEqual(expect.any(Date));
  });

  it("keeps exact unsafe-cleanup replay typed when rearm and stop both fail", async () => {
    const existing = buildHostedPhoneCall({
      briefJson: null,
      id: "hpc_existing",
      providerCallId: "retell_unsafe",
      status: "failed",
    });
    existing.briefEncrypted = await encryptHostedPhoneCallBrief({
      callId: existing.id,
      memberId: existing.memberId,
      value: VALID_BRIEF,
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_unused",
      stopError: new Error("provider stop unavailable"),
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter: vi.fn().mockRejectedValue(
        new Error("workflow unavailable"),
      ),
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "failed",
    });

    expect(runtime.startCalls).toEqual([]);
    expect(runtime.stopCalls).toEqual(["retell_unsafe"]);
    expect(store.currentCall().endedAt).toBeNull();
  });

  it("lets the durable recovery pass resume failed unsafe cleanup", async () => {
    const existing = buildHostedPhoneCall({
      endedAt: null,
      id: "hpc_existing",
      providerCallId: "retell_unsafe",
      status: "failed",
    });
    const store = createPhoneCallStore({ existing });
    let stopUnavailable = true;
    const runtimeHarness = createPhoneCallRuntime({
      onStop: () => {
        if (stopUnavailable) {
          throw new Error("provider stop unavailable");
        }
      },
      providerCallId: "retell_unused",
    });
    const terminalUsage = {
      combinedCostUsdMicros: 25_000,
      occurredAt: new Date("2026-06-25T01:00:00.000Z"),
      providerCallId: "retell_unsafe",
    };
    const recordTerminalUsage = vi.fn(async () => undefined);
    const runtime = {
      ...runtimeHarness.runtime,
      resolveTerminalUsage: vi.fn(async () => ({
        state: "ready" as const,
        usage: terminalUsage,
      })),
    };
    const prisma = {
      ...store.prisma,
      recordTerminalUsage,
    };

    await expect(processHostedPhoneCallRecoveryById({
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal: new AbortController().signal,
    })).resolves.toBe("pending");
    expect(store.currentCall().endedAt).toBeNull();

    stopUnavailable = false;
    await expect(processHostedPhoneCallRecoveryById({
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal: new AbortController().signal,
    })).resolves.toBe("complete");
    expect(runtimeHarness.startCalls).toEqual([]);
    expect(runtimeHarness.stopCalls).toEqual(["retell_unsafe", "retell_unsafe"]);
    expect(recordTerminalUsage).toHaveBeenCalledWith({
      call: existing,
      usage: terminalUsage,
    });
    expect(store.currentCall()).toMatchObject({
      endedAt: expect.any(Date),
      providerCallId: "retell_unsafe",
      status: "failed",
    });
  });

  it("settles delivered-result usage when provider readiness changes later", async () => {
    const analyzedAt = new Date("2026-06-25T01:00:00.000Z");
    const existing = buildHostedPhoneCall({
      analyzedAt,
      endedAt: analyzedAt,
      id: "hpc_existing",
      providerCallId: "retell_call_123",
      resultDeliveryStatus: "delivered",
      resultJson: {
        outcome: "completed",
        summary: "The requested office confirmed the appointment.",
      },
      resultNotificationChannel: "telegram",
      status: "completed",
    });
    const store = createPhoneCallStore({ existing });
    const recordTerminalUsage = vi.fn(async () => undefined);
    const resolveTerminalUsage = vi.fn()
      .mockResolvedValueOnce({ state: "pending" })
      .mockResolvedValueOnce({ state: "pending" })
      .mockResolvedValueOnce({ state: "pending" })
      .mockResolvedValueOnce({
        state: "ready",
        usage: {
          combinedCostUsdMicros: 125_000,
          occurredAt: new Date("2026-06-25T01:00:00.000Z"),
          providerCallId: "retell_call_123",
        },
      });
    const runtime = {
      ...createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      resolveTerminalUsage,
    };
    const prisma = {
      ...store.prisma,
      recordTerminalUsage,
    };
    const finalizeStoredResult = vi.fn(async () => "complete" as const);
    const signal = new AbortController().signal;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(processHostedPhoneCallRecoveryById({
        finalizeStoredResult,
        phoneCallId: existing.id,
        prisma,
        runtime,
        signal,
      })).resolves.toBe("pending");
    }
    expect(recordTerminalUsage).not.toHaveBeenCalled();

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("complete");
    expect(resolveTerminalUsage).toHaveBeenCalledTimes(4);
    expect(finalizeStoredResult).toHaveBeenCalledTimes(4);
    expect(recordTerminalUsage).toHaveBeenCalledWith({
      call: existing,
      usage: {
        combinedCostUsdMicros: 125_000,
        occurredAt: new Date("2026-06-25T01:00:00.000Z"),
        providerCallId: "retell_call_123",
      },
    });
  });

  it("keeps the tracked Workflow alive until Telegram result delivery is terminal", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_tracked_call",
      providerCallId: "retell_tracked_call",
      resultNotificationChannel: "telegram",
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const recordTerminalUsage = vi.fn(async () => undefined);
    const runtime = {
      ...createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      resolveTerminalUsage: vi.fn(async () => ({
        state: "ready" as const,
        usage: {
          combinedCostUsdMicros: 125_000,
          occurredAt: new Date("2026-06-25T01:00:00.000Z"),
          providerCallId: "retell_tracked_call",
        },
      })),
    };
    const finalizeStoredResult = vi.fn(async () => "complete" as const);
    const signal = new AbortController().signal;

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma: {
        ...store.prisma,
        recordTerminalUsage,
      },
      runtime,
      signal,
    })).resolves.toBe("pending");

    store.advanceCurrentCall({
      analyzedAt: new Date("2026-06-25T01:00:00.000Z"),
      resultDeliveryStatus: "delivered",
      resultJson: {
        outcome: "completed",
        summary: "The requested office confirmed the appointment.",
      },
      status: "completed",
    });

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma: {
        ...store.prisma,
        recordTerminalUsage,
      },
      runtime,
      signal,
    })).resolves.toBe("complete");

    expect(finalizeStoredResult).toHaveBeenCalledOnce();
  });

  it("keeps a provider-identified failed call alive for its accepted late analysis", async () => {
    const endedAt = new Date("2026-06-25T01:00:00.000Z");
    const existing = buildHostedPhoneCall({
      endedAt,
      id: "hpc_failed_before_analysis",
      providerCallId: "retell_failed_before_analysis",
      resultNotificationChannel: "telegram",
      status: "failed",
    });
    const store = createPhoneCallStore({ existing });
    const recordTerminalUsage = vi.fn(async () => undefined);
    const runtime = {
      ...createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      resolveTerminalUsage: vi.fn(async () => ({
        state: "ready" as const,
        usage: {
          combinedCostUsdMicros: 125_000,
          occurredAt: endedAt,
          providerCallId: "retell_failed_before_analysis",
        },
      })),
    };

    await expect(processHostedPhoneCallRecoveryById({
      phoneCallId: existing.id,
      prisma: {
        ...store.prisma,
        recordTerminalUsage,
      },
      runtime,
      signal: new AbortController().signal,
    })).resolves.toBe("pending");

    expect(recordTerminalUsage).toHaveBeenCalledOnce();
  });

  it("finishes a definitive pre-provider failed call without retaining recovery", async () => {
    const existing = buildHostedPhoneCall({
      endedAt: new Date("2026-06-25T01:00:00.000Z"),
      id: "hpc_failed_without_provider",
      providerCallId: null,
      resultNotificationChannel: "telegram",
      status: "failed",
    });
    const store = createPhoneCallStore({ existing });

    await expect(processHostedPhoneCallRecoveryById({
      phoneCallId: existing.id,
      prisma: store.prisma,
      runtime: createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      signal: new AbortController().signal,
    })).resolves.toBe("complete");
  });

  it("keeps an analyzed result pending until its durable notification succeeds", async () => {
    const analyzedAt = new Date("2026-06-25T01:00:00.000Z");
    const existing = buildHostedPhoneCall({
      analyzedAt,
      endedAt: analyzedAt,
      providerCallId: null,
      resultJson: {
        outcome: "completed",
        summary: "The pharmacy confirmed pickup readiness.",
      },
      resultDeliveryStatus: "pending",
      resultNotificationChannel: "telegram",
      status: "completed",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const finalizeStoredResult = vi.fn()
      .mockRejectedValueOnce(new Error("route unavailable"))
      .mockImplementation(async () => {
        if (store.currentCall().resultDeliveryStatus === "pending") {
          store.advanceCurrentCall({ resultDeliveryStatus: "queued" });
        }
        return store.currentCall().resultDeliveryStatus === "delivered"
          ? "complete" as const
          : "pending" as const;
      });
    const signal = new AbortController().signal;

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma: store.prisma,
      runtime: runtime.runtime,
      signal,
    })).resolves.toBe("pending");
    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma: store.prisma,
      runtime: runtime.runtime,
      signal,
    })).resolves.toBe("pending");
    store.advanceCurrentCall({ resultDeliveryStatus: "delivered" });
    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma: store.prisma,
      runtime: runtime.runtime,
      signal,
    })).resolves.toBe("complete");

    expect(finalizeStoredResult).toHaveBeenCalledTimes(3);
    expect(finalizeStoredResult).toHaveBeenCalledWith(existing, {
      abortSignal: signal,
    });
    expect(runtime.startCalls).toEqual([]);
  });

  it.each([
    "pending",
    "retrieval-error",
    "recording-error",
  ] as const)("recovers a stored result independently when terminal usage is %s", async (
    usageFailure,
  ) => {
    const analyzedAt = new Date("2026-06-25T01:00:00.000Z");
    const providerCallId = `retell_result_usage_${usageFailure}`;
    const existing = buildHostedPhoneCall({
      analyzedAt,
      endedAt: analyzedAt,
      id: `hpc_result_usage_${usageFailure}`,
      providerCallId,
      resultDeliveryGeneration: 1,
      resultDeliveryStatus: "pending",
      resultJson: {
        outcome: "completed",
        summary: "The requested office confirmed the appointment.",
      },
      resultNotificationChannel: "telegram",
      status: "completed",
    });
    const store = createPhoneCallStore({ existing });
    const usage = {
      combinedCostUsdMicros: 125_000,
      occurredAt: analyzedAt,
      providerCallId,
    };
    let usageReady = false;
    const resolveTerminalUsage = vi.fn(async () => {
      if (!usageReady && usageFailure === "retrieval-error") {
        throw new Error("Retell usage unavailable");
      }
      if (!usageReady && usageFailure === "pending") {
        return { state: "pending" as const };
      }
      return {
        state: "ready" as const,
        usage,
      };
    });
    const recordTerminalUsage = vi.fn(async () => {
      if (!usageReady && usageFailure === "recording-error") {
        throw new Error("usage ledger unavailable");
      }
    });
    const runtime = {
      ...createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      resolveTerminalUsage,
    };
    const prisma = {
      ...store.prisma,
      recordTerminalUsage,
    };
    let notificationSignals = 0;
    const finalizeStoredResult = vi.fn(async (call: HostedPhoneCall) => {
      if (call.resultDeliveryStatus === "pending") {
        notificationSignals += 1;
        store.advanceCurrentCall({ resultDeliveryStatus: "queued" });
      }
      return "complete" as const;
    });
    const signal = new AbortController().signal;

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("pending");

    expect(notificationSignals).toBe(1);
    expect(store.currentCall().resultDeliveryStatus).toBe("queued");
    usageReady = true;

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("pending");

    expect(notificationSignals).toBe(1);
    store.advanceCurrentCall({ resultDeliveryStatus: "delivered" });

    await expect(processHostedPhoneCallRecoveryById({
      finalizeStoredResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("complete");

    expect(recordTerminalUsage).toHaveBeenLastCalledWith({
      call: expect.objectContaining({ id: existing.id }),
      usage,
    });
  });

  it("retries callback-loss recovery until a terminal transfer result is finalized", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_transfer_recovery",
      providerCallId: "retell_transfer_recovery",
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const terminalUsage = {
      combinedCostUsdMicros: 187_500,
      occurredAt: new Date("2026-06-25T01:00:00.000Z"),
      providerCallId: "retell_transfer_recovery",
    };
    const transferEndedAt = new Date("2026-06-25T01:05:00.000Z");
    const recordTerminalUsage = vi.fn()
      .mockRejectedValueOnce(new Error("usage ledger unavailable"))
      .mockResolvedValue(undefined);
    const runtime = {
      ...createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      resolveTerminalUsage: vi.fn(async () => ({
        state: "ready" as const,
        terminalTransfer: {
          endedAt: transferEndedAt,
          providerCallId: "retell_transfer_recovery",
        },
        usage: terminalUsage,
      })),
    };
    let finalizeAttempts = 0;
    const finalizeResult = vi.fn(async () => {
      finalizeAttempts += 1;
      store.advanceCurrentCall({
        analyzedAt: transferEndedAt,
        resultJson: {
          outcome: "needs_user",
          summary: "The post-handoff outcome is unknown.",
        },
        status: "needs_user",
      });
      if (finalizeAttempts === 1) {
        throw new Error("runtime signal unavailable");
      }
    });
    const prisma = {
      ...store.prisma,
      recordTerminalUsage,
    };
    const signal = new AbortController().signal;

    await expect(processHostedPhoneCallRecoveryById({
      finalizeResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("pending");
    await expect(processHostedPhoneCallRecoveryById({
      finalizeResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("complete");
    await expect(processHostedPhoneCallRecoveryById({
      finalizeResult,
      phoneCallId: existing.id,
      prisma,
      runtime,
      signal,
    })).resolves.toBe("complete");

    expect(recordTerminalUsage).toHaveBeenCalledTimes(3);
    expect(finalizeResult).toHaveBeenCalledTimes(3);
    expect(finalizeResult).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_id: "retell_transfer_recovery",
        data_storage_setting: "basic_attributes_only",
        disconnection_reason: "call_transfer",
        end_timestamp: transferEndedAt.toISOString(),
        transfer_end_timestamp: transferEndedAt.toISOString(),
      }),
      completionPolicy: "transfer_follow_up_required",
    }, {
      abortSignal: signal,
    });
    expect(store.currentCall()).toMatchObject({
      analyzedAt: transferEndedAt,
      status: "needs_user",
    });
  });

  it("keeps fresh duplicate unstarted reservations active without a blind provider retry", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_existing",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(),
    });
    const store = createPhoneCallStore({
      existing,
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      reconciliationWorkflowStarter,
      runtime: runtime.runtime,
    });

    expect(response).toEqual({
      phoneCallId: "hpc_existing",
      status: "starting",
    });
    expect(runtime.startCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: "hpc_existing",
    }, { signal: expect.any(AbortSignal) });
  });

  it("fails a stale unstarted reservation after the provider proves no matching effect", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_existing",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    });
    const store = createPhoneCallStore({
      existing,
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    });

    expect(response).toEqual({
      phoneCallId: "hpc_existing",
      status: "failed",
    });
    expect(runtime.startCalls).toEqual([]);
    expect(runtime.resolveCalls).toEqual(["hpc_existing"]);
    expect(store.updateManyCalls).toEqual([{
      data: { status: "failed" },
      where: {
        analyzedAt: null,
        id: "hpc_existing",
        provider: "retell",
        providerCallId: null,
        status: "starting",
        updatedAt: existing.updatedAt,
      },
    }]);
    expect(store.currentCall()).toMatchObject({
      providerCallId: null,
      resultJson: null,
      status: "failed",
    });
  });

  it("binds a stale reservation to the single provider call recovered by metadata", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_existing",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_unused",
      reconciliationResult: {
        providerCallId: "retell_recovered",
        state: "found",
      },
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: "hpc_existing",
      status: "calling",
    });

    expect(runtime.startCalls).toEqual([]);
    expect(runtime.resolveCalls).toEqual(["hpc_existing"]);
    expect(store.updateManyCalls).toEqual([{
      data: {
        providerCallId: "retell_recovered",
        status: "calling",
      },
      where: {
        analyzedAt: null,
        id: "hpc_existing",
        provider: "retell",
        providerCallId: null,
        status: "starting",
        updatedAt: existing.updatedAt,
      },
    }]);
  });

  it("keeps stale provider authority pending when the recovered id cannot be stored", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_existing",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    });
    const store = createPhoneCallStore({
      existing,
      onUpdateMany: (update) => {
        if (update.data.providerCallId) {
          throw new Error("database unavailable");
        }
      },
    });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_unused",
      reconciliationResult: {
        providerCallId: "retell_recovered",
        state: "found",
      },
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "starting",
    });

    expect(runtime.startCalls).toEqual([]);
    expect(runtime.resolveCalls).toEqual([existing.id]);
    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: existing.id,
    }, { signal: expect.any(AbortSignal) });
    expect(store.currentCall()).toMatchObject({
      providerCallId: null,
      status: "starting",
    });
  });

  it("keeps a stale reservation pending when provider reconciliation is unavailable", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_existing",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_unused",
      reconciliationError: new Error("provider unavailable"),
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      reconciliationWorkflowStarter,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: "hpc_existing",
      status: "starting",
    });
    expect(runtime.startCalls).toEqual([]);
    expect(runtime.resolveCalls).toEqual(["hpc_existing"]);
    expect(store.updateManyCalls).toEqual([]);
    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: "hpc_existing",
    }, { signal: expect.any(AbortSignal) });
  });

  it("blocks a different request while unresolved provider authority is pending", async () => {
    const pending = buildHostedPhoneCall({
      id: "hpc_pending",
      providerCallId: null,
      requestKey: "phone_call_request_prior",
      status: "starting",
      updatedAt: new Date(),
    });
    const store = createPhoneCallStore({ pending });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCallDirect({
      brief: VALID_BRIEF,
      memberId: pending.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: "phone_call_request_new",
      runtime: runtime.runtime,
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_START_PENDING",
      retryable: true,
    });

    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: "hpc_pending",
    }, { signal: expect.any(AbortSignal) });
    expect(store.findFirstCalls).toEqual([{
      where: {
        memberId: pending.memberId,
        OR: [
          {
            analyzedAt: null,
            endedAt: null,
            provider: "retell",
            providerCallId: null,
            status: "starting",
          },
          {
            analyzedAt: null,
            endedAt: null,
            provider: "retell",
            providerCallId: { not: null },
            status: "failed",
          },
        ],
      },
    }]);
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("fails closed when the prior authority cannot be reloaded", async () => {
    const pending = buildHostedPhoneCall({
      id: "hpc_pending",
      providerCallId: null,
      requestKey: "phone_call_request_prior",
      status: "starting",
      updatedAt: new Date(),
    });
    const store = createPhoneCallStore({
      onFindUniqueOrThrow: () => {
        throw new Error("database unavailable");
      },
      pending,
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCallDirect({
      brief: VALID_BRIEF,
      memberId: pending.memberId,
      prisma: store.prisma,
      requestKey: "phone_call_request_new",
      runtime: runtime.runtime,
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_START_PENDING",
      retryable: true,
    });

    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("blocks a different request while unsafe provider cleanup is pending", async () => {
    const pending = buildHostedPhoneCall({
      id: "hpc_cleanup_pending",
      providerCallId: "retell_unsafe",
      requestKey: "phone_call_request_prior",
      status: "failed",
    });
    const store = createPhoneCallStore({ pending });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_unused",
      stopError: new Error("provider stop unavailable"),
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCallDirect({
      brief: VALID_BRIEF,
      memberId: pending.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: "phone_call_request_new",
      runtime: runtime.runtime,
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_START_PENDING",
      retryable: true,
    });

    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: pending.id,
    }, { signal: expect.any(AbortSignal) });
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
    expect(runtime.stopCalls).toEqual(["retell_unsafe"]);
  });

  it("allows a different request after unsafe provider cleanup records terminal proof", async () => {
    const pending = buildHostedPhoneCall({
      id: "hpc_cleanup_pending",
      providerCallId: "retell_unsafe",
      requestKey: "phone_call_request_prior",
      status: "failed",
    });
    const store = createPhoneCallStore({ pending });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_new" });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: pending.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: "phone_call_request_new",
      runtime: runtime.runtime,
    })).resolves.toMatchObject({ status: "calling" });

    expect(runtime.stopCalls).toEqual(["retell_unsafe"]);
    expect(runtime.startCalls).toHaveLength(1);
    expect(store.createCalls).toHaveLength(1);
    expect(reconciliationWorkflowStarter).toHaveBeenCalledTimes(2);
  });

  it("does not fall through when reconciliation discovers unsafe cleanup authority", async () => {
    const pending = buildHostedPhoneCall({
      id: "hpc_pending",
      providerCallId: null,
      requestKey: "phone_call_request_prior",
      status: "starting",
      updatedAt: new Date(0),
    });
    const store = createPhoneCallStore({ pending });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_unused",
      reconciliationResult: {
        providerCallId: "retell_unsafe",
        state: "cleanup_required",
      },
      stopError: new Error("provider stop unavailable"),
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: pending.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: "phone_call_request_new",
      runtime: runtime.runtime,
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_START_PENDING",
      retryable: true,
    });

    expect(runtime.resolveCalls).toEqual([pending.id]);
    expect(runtime.stopCalls).toEqual(["retell_unsafe"]);
    expect(runtime.startCalls).toEqual([]);
    expect(store.currentCall()).toMatchObject({
      endedAt: null,
      providerCallId: "retell_unsafe",
      status: "failed",
    });
    expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
  });

  it("fails closed when a duplicate request key carries a different brief", async () => {
    const existing = buildHostedPhoneCall({
      briefJson: VALID_BRIEF,
      providerCallId: "retell_existing",
      status: "calling",
    });
    const store = createPhoneCallStore({
      existing,
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: {
        ...VALID_BRIEF,
        goal: "Ask whether the office is open on Friday, June 26, 2026.",
        successCriteria: "The office confirms whether it is open that Friday.",
      },
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).rejects.toThrow("request key collision");

    expect(runtime.startCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it("fails closed when a duplicate request key comes from another session", async () => {
    const existing = buildHostedPhoneCall({
      providerCallId: "retell_existing",
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      originSessionId: "session_other",
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).rejects.toThrow("request key collision");

    expect(runtime.startCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it("fails closed when a legacy replay adds a result notification channel", async () => {
    const existing = buildHostedPhoneCall({
      providerCallId: "retell_existing",
      resultNotificationChannel: null,
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      notificationDestinationResolver: async () =>
        TELEGRAM_NOTIFICATION_DESTINATION,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      resultNotificationChannel: "telegram",
      runtime: runtime.runtime,
    })).rejects.toThrow("request key collision");

    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("replays an existing call only when the result notification channel matches", async () => {
    const existing = buildHostedPhoneCall({
      providerCallId: "retell_existing",
      resultNotificationChannel: "telegram",
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      notificationDestinationResolver: async () =>
        TELEGRAM_NOTIFICATION_DESTINATION,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      resultNotificationChannel: "telegram",
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "calling",
    });

    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("replays one scheduled occurrence across resident sessions", async () => {
    const existing = buildHostedPhoneCall({
      providerCallId: "retell_existing",
      requestKey: SCHEDULED_REQUEST_KEY,
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      originSessionId: "session_scheduled_retry",
      prisma: store.prisma,
      requestKey: SCHEDULED_REQUEST_KEY,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: existing.id,
      status: "calling",
    });

    expect(runtime.startCalls).toEqual([]);
    expect(store.createCalls).toEqual([]);
  });

  it("fails closed when a scheduled occurrence retry changes the brief", async () => {
    const existing = buildHostedPhoneCall({
      providerCallId: "retell_existing",
      requestKey: SCHEDULED_REQUEST_KEY,
      status: "calling",
    });
    const store = createPhoneCallStore({ existing });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: {
        ...VALID_BRIEF,
        goal: "Ask whether the office accepts walk-ins.",
      },
      memberId: existing.memberId,
      originSessionId: "session_scheduled_retry",
      prisma: store.prisma,
      requestKey: SCHEDULED_REQUEST_KEY,
      runtime: runtime.runtime,
    })).rejects.toThrow("request key collision");

    expect(runtime.startCalls).toEqual([]);
    expect(store.createCalls).toEqual([]);
  });

  it("allows distinct members to use the same stable request key", async () => {
    const created = buildHostedPhoneCall({
      memberId: "member_2",
      requestKey: "phone_call_request_1",
    });
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_call_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_2",
      prisma: store.prisma,
      requestKey: "phone_call_request_1",
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver(null),
    })).resolves.toMatchObject({
      status: "calling",
    });

    expect(store.createCalls[0]!.data).toMatchObject({
      memberId: "member_2",
      requestKey: "phone_call_request_1",
    });
    expect(runtime.startCalls).toHaveLength(1);
  });

  it("marks the call failed when the provider start fails", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({
      error: markPhoneCallRuntimeNoActiveEffect(new Error("provider unavailable")),
      providerCallId: "retell_unused",
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter: async () => ({ runId: "run_test" }),
      requestKey: created.requestKey,
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver(null),
    })).rejects.toThrow("provider unavailable");

    const createdCallId = store.createCalls[0]!.data.id;
    expect(store.updateManyCalls).toEqual([{
      data: {
        status: "failed",
      },
      where: {
        analyzedAt: null,
        id: createdCallId,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    }]);
  });

  it("does not dispatch Retell when the durable reconciliation Workflow cannot start", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const workflowError = new Error("workflow unavailable");

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter: vi.fn().mockRejectedValue(workflowError),
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).rejects.toBe(workflowError);

    expect(runtime.startCalls).toEqual([]);
    expect(store.currentCall()).toMatchObject({
      providerCallId: null,
      status: "failed",
    });
  });

  it("bounds mandatory Workflow arming before Retell dispatch", async () => {
    const serviceTimeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(serviceTimeout.signal)
      .mockImplementation(() => new AbortController().signal);
    try {
      const created = buildHostedPhoneCall();
      const store = createPhoneCallStore({ created });
      const runtime = createPhoneCallRuntime({ providerCallId: "retell_started" });
      let workflowSignal: AbortSignal | undefined;
      const reconciliationWorkflowStarter = vi.fn(async (
        _input: { phoneCallId: string },
        options: { signal: AbortSignal },
      ) => {
        workflowSignal = options.signal;
        return await new Promise<never>((_resolve, reject) => {
          const rejectOnAbort = () => reject(options.signal.reason);
          if (options.signal.aborted) {
            rejectOnAbort();
            return;
          }
          options.signal.addEventListener("abort", rejectOnAbort, { once: true });
        });
      });
      const outcome = createHostedPhoneCall({
        brief: VALID_BRIEF,
        memberId: created.memberId,
        prisma: store.prisma,
        reconciliationWorkflowStarter,
        requestKey: created.requestKey,
        runtime: runtime.runtime,
      }).then(
        () => null,
        (error: unknown) => error,
      );

      await vi.waitFor(() => {
        expect(workflowSignal).toBeInstanceOf(AbortSignal);
      });
      serviceTimeout.abort(new DOMException("The operation timed out.", "TimeoutError"));
      await expect(outcome).resolves.toMatchObject({ name: "TimeoutError" });
      expect(workflowSignal?.aborted).toBe(true);
      expect(runtime.startCalls).toEqual([]);
      expect(store.currentCall()).toMatchObject({
        providerCallId: null,
        status: "failed",
      });

      await expect(createHostedPhoneCall({
        brief: VALID_BRIEF,
        memberId: created.memberId,
        prisma: store.prisma,
        reconciliationWorkflowStarter: async () => ({ runId: "run_retry" }),
        requestKey: "phone_call_request_retry",
        runtime: runtime.runtime,
      })).resolves.toMatchObject({ status: "calling" });
      expect(runtime.startCalls).toHaveLength(1);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("keeps a stale reconciliation read from releasing a newly dispatched call", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    let releaseWorkflowStart: (() => void) | undefined;
    const reconciliationWorkflowStarter = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseWorkflowStart = resolve;
      });
      return { runId: "run_123" };
    });
    let releaseProviderStart: (() => void) | undefined;
    const runtime = createPhoneCallRuntime({
      onStart: async () => {
        await new Promise<void>((resolve) => {
          releaseProviderStart = resolve;
        });
      },
      providerCallId: "retell_started",
    });
    const foreground = createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    });

    await vi.waitFor(() => {
      expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
    });
    const staleReservation = { ...store.currentCall() };
    releaseWorkflowStart?.();
    await vi.waitFor(() => {
      expect(runtime.startCalls).toHaveLength(1);
    });

    const staleResult = await reconcileHostedPhoneCallProviderAuthority({
      call: staleReservation,
      runtime: createPhoneCallRuntime({ providerCallId: "retell_unused" }).runtime,
      signal: new AbortController().signal,
      store: store.prisma,
    });
    releaseProviderStart?.();
    const foregroundResult = await foreground;

    expect(staleResult).toEqual({
      phoneCallId: staleReservation.id,
      status: "starting",
    });
    expect(foregroundResult).toEqual({
      phoneCallId: staleReservation.id,
      status: "calling",
    });
    expect(store.currentCall()).toMatchObject({
      providerCallId: "retell_started",
      status: "calling",
    });
  });

  it("serializes overlapping reconciliation runs through the row epoch", async () => {
    const existing = buildHostedPhoneCall({
      id: "hpc_existing",
      updatedAt: new Date(0),
    });
    const store = createPhoneCallStore({ existing });
    let releaseResolutions: (() => void) | undefined;
    const resolutionsReady = new Promise<void>((resolve) => {
      releaseResolutions = resolve;
    });
    const runtime: PhoneCallRuntime = {
      resolveProviderCall: vi.fn(async () => {
        await resolutionsReady;
        return {
          providerCallId: "retell_recovered",
          state: "found",
        } as const;
      }),
      start: vi.fn(async () => {
        throw new Error("Reconciliation must not dispatch a provider call.");
      }),
      stopIfActive: vi.fn(async () => {}),
    };
    const signal = new AbortController().signal;

    const first = processHostedPhoneCallRecoveryById({
      phoneCallId: existing.id,
      prisma: store.prisma,
      runtime,
      signal,
    });
    const second = processHostedPhoneCallRecoveryById({
      phoneCallId: existing.id,
      prisma: store.prisma,
      runtime,
      signal,
    });
    await vi.waitFor(() => {
      expect(runtime.resolveProviderCall).toHaveBeenCalledTimes(2);
    });
    releaseResolutions?.();
    const results = await Promise.all([
      first,
      second,
    ]);

    expect(results).toEqual(["complete", "complete"]);
    expect(runtime.resolveProviderCall).toHaveBeenCalledTimes(2);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(store.updateManyCalls).toHaveLength(2);
    expect(store.updateManyCalls.every((update) => (
      update.where.updatedAt?.getTime() === existing.updatedAt.getTime()
    ))).toBe(true);
    expect(store.currentCall()).toMatchObject({
      providerCallId: "retell_recovered",
      status: "calling",
    });
  });

  it("returns starting before a provider-id write can outlive the service deadline", async () => {
    const serviceTimeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValue(serviceTimeout.signal);
    try {
      const created = buildHostedPhoneCall();
      let releaseProviderIdWrite: (() => void) | undefined;
      const store = createPhoneCallStore({
        created,
        onUpdateMany: async (update) => {
          if (update.data.providerCallId) {
            await new Promise<void>((resolve) => {
              releaseProviderIdWrite = resolve;
            });
          }
        },
      });
      const runtime = createPhoneCallRuntime({ providerCallId: "retell_started" });
      let outcome: Awaited<ReturnType<typeof createHostedPhoneCall>> | undefined;
      const response = createHostedPhoneCall({
        brief: VALID_BRIEF,
        memberId: created.memberId,
        prisma: store.prisma,
        requestKey: created.requestKey,
        runtime: runtime.runtime,
      }).then((result) => {
        outcome = result;
        return result;
      });

      await vi.waitFor(() => {
        expect(releaseProviderIdWrite).toBeTypeOf("function");
      });
      serviceTimeout.abort(new DOMException("The operation timed out.", "TimeoutError"));
      await vi.waitFor(() => {
        expect(outcome).toEqual({
          phoneCallId: expect.stringMatching(/^hpc_/u),
          status: "starting",
        });
      });
      releaseProviderIdWrite?.();
      await response;

      await vi.waitFor(() => {
        expect(store.currentCall()).toMatchObject({
          providerCallId: "retell_started",
          status: "calling",
        });
      });
      expect(runtime.startCalls).toHaveLength(1);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("returns starting before an ambiguous authority read can outlive the deadline", async () => {
    const serviceTimeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValue(serviceTimeout.signal);
    try {
      const created = buildHostedPhoneCall();
      let releaseAuthorityRead: (() => void) | undefined;
      const store = createPhoneCallStore({
        created,
        onFindUniqueOrThrow: async () => {
          await new Promise<void>((resolve) => {
            releaseAuthorityRead = resolve;
          });
        },
      });
      const runtime = createPhoneCallRuntime({
        error: new Error("ambiguous provider timeout"),
        providerCallId: "retell_unused",
      });
      let outcome: Awaited<ReturnType<typeof createHostedPhoneCall>> | undefined;
      const response = createHostedPhoneCall({
        brief: VALID_BRIEF,
        memberId: created.memberId,
        prisma: store.prisma,
        requestKey: created.requestKey,
        runtime: runtime.runtime,
      }).then((result) => {
        outcome = result;
        return result;
      });

      await vi.waitFor(() => {
        expect(releaseAuthorityRead).toBeTypeOf("function");
      });
      serviceTimeout.abort(new DOMException("The operation timed out.", "TimeoutError"));
      await vi.waitFor(() => {
        expect(outcome).toEqual({
          phoneCallId: expect.stringMatching(/^hpc_/u),
          status: "starting",
        });
      });
      releaseAuthorityRead?.();
      await response;

      expect(runtime.startCalls).toHaveLength(1);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("keeps unsafe authority pending when its persistence outlives the deadline", async () => {
    const serviceTimeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValue(serviceTimeout.signal);
    try {
      const created = buildHostedPhoneCall();
      let releaseUnsafeAuthorityWrite: (() => void) | undefined;
      const store = createPhoneCallStore({
        created,
        onUpdateMany: async (update) => {
          if (update.data.providerCallId) {
            await new Promise<void>((resolve) => {
              releaseUnsafeAuthorityWrite = resolve;
            });
          }
        },
      });
      const runtime = createPhoneCallRuntime({
        cleanupRequiredError: new Error("unsafe provider storage"),
        providerCallId: "retell_cleanup_pending",
      });
      let outcome: Awaited<ReturnType<typeof createHostedPhoneCall>> | undefined;
      const response = createHostedPhoneCall({
        brief: VALID_BRIEF,
        memberId: created.memberId,
        prisma: store.prisma,
        requestKey: created.requestKey,
        runtime: runtime.runtime,
      }).then((result) => {
        outcome = result;
        return result;
      });

      await vi.waitFor(() => {
        expect(releaseUnsafeAuthorityWrite).toBeTypeOf("function");
      });
      serviceTimeout.abort(new DOMException("The operation timed out.", "TimeoutError"));
      await vi.waitFor(() => {
        expect(outcome).toEqual({
          phoneCallId: expect.stringMatching(/^hpc_/u),
          status: "starting",
        });
      });
      releaseUnsafeAuthorityWrite?.();
      await response;

      await vi.waitFor(() => {
        expect(store.currentCall()).toMatchObject({
          providerCallId: "retell_cleanup_pending",
          status: "failed",
        });
      });
      expect(runtime.startCalls).toHaveLength(1);
      expect(runtime.stopCalls).toEqual([]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("lets the pre-armed Workflow recover when provider-id persistence fails", async () => {
    const created = buildHostedPhoneCall();
    let rejectBinding = true;
    const store = createPhoneCallStore({
      created,
      onUpdateMany: (update) => {
        if (update.data.providerCallId && rejectBinding) {
          rejectBinding = false;
          throw new Error("database unavailable");
        }
      },
    });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_started",
      reconciliationResult: {
        providerCallId: "retell_started",
        state: "found",
      },
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_/u),
      status: "starting",
    });

    expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
    expect(runtime.startCalls).toHaveLength(1);
    store.advanceCurrentCall({ updatedAt: new Date(0) });
    await expect(processHostedPhoneCallRecoveryById({
      phoneCallId: store.currentCall().id,
      prisma: store.prisma,
      runtime: runtime.runtime,
      signal: new AbortController().signal,
    })).resolves.toBe("complete");
    expect(store.currentCall()).toMatchObject({
      providerCallId: "retell_started",
      status: "calling",
    });
  });

  it("starts durable reconciliation when provider dispatch has ambiguous authority", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({
      error: new Error("ambiguous provider timeout"),
      providerCallId: "retell_unused",
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_/u),
      status: "starting",
    });

    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: store.createCalls[0]!.data.id,
    }, { signal: expect.any(AbortSignal) });
    expect(store.updateManyCalls).toEqual([]);
  });

  it("keeps ambiguous authority typed when the post-dispatch row read fails", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({
      created,
      onFindUniqueOrThrow: () => {
        throw new Error("database unavailable");
      },
    });
    const runtime = createPhoneCallRuntime({
      error: new Error("ambiguous provider timeout"),
      providerCallId: "retell_unused",
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_/u),
      status: "starting",
    });
    expect(runtime.startCalls).toHaveLength(1);
  });

  it("persists provider authority before unsafe storage cleanup", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const cleanupError = new Error("unsafe provider storage");
    const runtime = createPhoneCallRuntime({
      cleanupRequiredError: cleanupError,
      onStop: () => {
        expect(store.currentCall()).toMatchObject({
          providerCallId: "retell_cleanup_pending",
          status: "failed",
        });
      },
      providerCallId: "retell_cleanup_pending",
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_/u),
      status: "failed",
    });

    expect(store.updateManyCalls).toEqual([{
      data: {
        providerCallId: "retell_cleanup_pending",
        status: "failed",
      },
      where: {
        analyzedAt: null,
        id: store.createCalls[0]!.data.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    }]);
    expect(reconciliationWorkflowStarter).toHaveBeenCalledWith({
      phoneCallId: store.createCalls[0]!.data.id,
    }, { signal: expect.any(AbortSignal) });
    expect(runtime.stopCalls).toEqual(["retell_cleanup_pending"]);
    expect(store.currentCall()).toMatchObject({
      endedAt: expect.any(Date),
      providerCallId: "retell_cleanup_pending",
      status: "failed",
    });
  });

  it("leaves unsafe cleanup authority pending for the durable retry owner", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const cleanupError = new Error("unsafe provider storage");
    const runtime = createPhoneCallRuntime({
      cleanupRequiredError: cleanupError,
      providerCallId: "retell_cleanup_pending",
      stopError: new Error("provider stop unavailable"),
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_/u),
      status: "failed",
    });

    expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
    expect(runtime.stopCalls).toEqual(["retell_cleanup_pending"]);
    expect(store.currentCall()).toMatchObject({
      endedAt: null,
      providerCallId: "retell_cleanup_pending",
      status: "failed",
    });
  });

  it("returns durable pending authority when unsafe provider-id persistence fails", async () => {
    const created = buildHostedPhoneCall();
    let rejectBinding = true;
    const store = createPhoneCallStore({
      created,
      onUpdateMany: (update) => {
        if (update.data.providerCallId && rejectBinding) {
          rejectBinding = false;
          throw new Error("database unavailable");
        }
      },
    });
    const runtime = createPhoneCallRuntime({
      cleanupRequiredError: new Error("unsafe provider storage"),
      providerCallId: "retell_cleanup_pending",
      reconciliationResult: {
        providerCallId: "retell_cleanup_pending",
        state: "cleanup_required",
      },
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: expect.stringMatching(/^hpc_/u),
      status: "starting",
    });
    expect(runtime.stopCalls).toEqual([]);

    store.advanceCurrentCall({ updatedAt: new Date(0) });
    await expect(processHostedPhoneCallRecoveryById({
      phoneCallId: store.currentCall().id,
      prisma: store.prisma,
      runtime: runtime.runtime,
      signal: new AbortController().signal,
    })).resolves.toBe("complete");
    expect(runtime.stopCalls).toEqual(["retell_cleanup_pending"]);
    expect(store.currentCall()).toMatchObject({
      endedAt: expect.any(Date),
      providerCallId: "retell_cleanup_pending",
      status: "failed",
    });
  });

  it("does not reserve or invoke a provider after the caller aborts during prerequisites", async () => {
    const controller = new AbortController();
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCallDirect({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      transferNumberResolver: async () => {
        controller.abort();
        return "+12125550000";
      },
      runtime: runtime.runtime,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(runtime.startCalls).toEqual([]);
    expect(store.createCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it("marks a committed reservation failed when the deadline aborts before provider dispatch", async () => {
    const controller = new AbortController();
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({
      created,
      onReserve: () => controller.abort(),
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCallDirect({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter: async () => ({ runId: "run_test" }),
      requestKey: created.requestKey,
      runtime: runtime.runtime,
      signal: controller.signal,
      transferNumberResolver: createTransferNumberResolver(null),
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(runtime.startCalls).toEqual([]);
    expect(store.createCalls).toHaveLength(1);
    expect(store.updateManyCalls).toEqual([{
      data: {
        status: "failed",
      },
      where: {
        analyzedAt: null,
        id: store.createCalls[0]!.data.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    }]);
  });

  it("does not overwrite webhook-final state when start success loses the race", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({
      onStart: async (call) => {
        store.advanceCurrentCall({
          analyzedAt: new Date("2026-06-25T12:00:00.000Z"),
          id: call.id,
          providerCallId: "retell_started",
          resultJson: {
            outcome: "completed",
            summary: "Booked before the start path finished.",
          },
          status: "completed",
        });
      },
      providerCallId: "retell_started",
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver("+12125550000"),
    });

    const createdCallId = store.createCalls[0]!.data.id;
    expect(response).toEqual({
      phoneCallId: createdCallId,
      status: "calling",
    });
    expect(runtime.startCalls).toEqual([{
      brief: VALID_BRIEF,
      id: createdCallId,
      memberId: created.memberId,
      transferNumber: "+12125550000",
    }]);
    expect(store.updateManyCalls).toEqual([{
      data: {
        providerCallId: "retell_started",
        status: "calling",
      },
      where: {
        analyzedAt: null,
        id: createdCallId,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    }]);
    expect(store.currentCall()).toMatchObject({
      providerCallId: "retell_started",
      resultJson: {
        outcome: "completed",
        summary: "Booked before the start path finished.",
      },
      status: "completed",
    });
    expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
  });

  it("does not overwrite webhook-final state when start failure loses the race", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({
      error: new Error("ambiguous provider timeout"),
      onStart: async (call) => {
        store.advanceCurrentCall({
          analyzedAt: new Date("2026-06-25T12:00:00.000Z"),
          id: call.id,
          providerCallId: "retell_started",
          resultJson: {
            outcome: "completed",
            summary: "Booked despite the local timeout.",
          },
          status: "completed",
        });
      },
      providerCallId: "retell_unused",
    });
    const reconciliationWorkflowStarter = vi.fn().mockResolvedValue({ runId: "run_123" });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      reconciliationWorkflowStarter,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver(null),
    });

    const createdCallId = store.createCalls[0]!.data.id;
    expect(response).toEqual({
      phoneCallId: createdCallId,
      status: "calling",
    });
    expect(store.updateManyCalls).toEqual([]);
    expect(store.currentCall()).toMatchObject({
      providerCallId: "retell_started",
      resultJson: {
        outcome: "completed",
        summary: "Booked despite the local timeout.",
      },
      status: "completed",
    });
    expect(reconciliationWorkflowStarter).toHaveBeenCalledOnce();
  });

  it("does not resolve a transfer destination when the brief disallows transfer", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_call_123" });
    let resolverCalls = 0;
    const brief: HostedPhoneCallBrief = {
      ...VALID_BRIEF,
      allowTransferToUser: false,
    };

    await createHostedPhoneCall({
      brief,
      memberId: "member_1",
      prisma: store.prisma,
      requestKey: "phone_call_request_1",
      runtime: runtime.runtime,
      transferNumberResolver: async () => {
        resolverCalls += 1;
        return "+12125550000";
      },
    });

    expect(resolverCalls).toBe(0);
    expect(runtime.startCalls).toEqual([{
      brief,
      id: store.createCalls[0]!.data.id,
      memberId: "member_1",
      transferNumber: null,
    }]);
  });

  it("forces transfer off for a container-shaped call before private-number lookup", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_group_call" });
    const notificationDestinationResolver = vi.fn(async () =>
      GROUP_NOTIFICATION_DESTINATION);
    const groupRequesterActivationAsserter = vi.fn(async () => undefined);
    const transferNumberResolver = vi.fn(async () => "+12125550000");

    await createHostedPhoneCall({
      brief: VALID_BRIEF,
      groupRequester: GROUP_REQUESTER,
      groupRequesterActivationAsserter,
      memberId: "member_1",
      notificationDestinationResolver,
      prisma: store.prisma,
      requestKey: "phone_call_group_request",
      runtime: runtime.runtime,
      transferNumberResolver,
    });

    const effectiveBrief = {
      ...VALID_BRIEF,
      allowTransferToUser: false,
    };
    expect(notificationDestinationResolver).toHaveBeenCalledWith({
      memberId: "member_1",
      signal: expect.any(AbortSignal),
    });
    expect(groupRequesterActivationAsserter).toHaveBeenCalledTimes(2);
    expect(groupRequesterActivationAsserter).toHaveBeenNthCalledWith(1, {
      groupRequester: GROUP_REQUESTER,
      inboundMailboxItemIds: [],
      routeAuthority:
        GROUP_NOTIFICATION_DESTINATION.externalThreadRouteAuthority,
      signal: expect.any(AbortSignal),
    });
    expect(groupRequesterActivationAsserter).toHaveBeenNthCalledWith(2, {
      groupRequester: GROUP_REQUESTER,
      inboundMailboxItemIds: [],
      routeAuthority:
        GROUP_NOTIFICATION_DESTINATION.externalThreadRouteAuthority,
      signal: expect.any(AbortSignal),
    });
    expect(transferNumberResolver).not.toHaveBeenCalled();
    expect(runtime.startCalls).toEqual([{
      brief: effectiveBrief,
      id: store.createCalls[0]!.data.id,
      memberId: "member_1",
      transferNumber: null,
    }]);
    await expect(decryptHostedPhoneCallBrief({
      callId: store.createCalls[0]!.data.id,
      memberId: "member_1",
      value: store.createCalls[0]!.data.briefEncrypted,
    })).resolves.toEqual(effectiveBrief);
  });

  it("passes legacy mailbox requester evidence through the Web rollout boundary", async () => {
    const store = createPhoneCallStore({ created: buildHostedPhoneCall() });
    const runtime = createPhoneCallRuntime({
      providerCallId: "retell_legacy_group_call",
    });
    const groupRequesterActivationAsserter = vi.fn(async () => undefined);

    await createHostedPhoneCall({
      brief: VALID_BRIEF,
      groupRequesterActivationAsserter,
      inboundMailboxItemIds: ["mailbox_group_request"],
      memberId: "member_1",
      notificationDestinationResolver: async () =>
        GROUP_NOTIFICATION_DESTINATION,
      prisma: store.prisma,
      requestKey: "phone_call_legacy_group_request",
      runtime: runtime.runtime,
    });

    expect(groupRequesterActivationAsserter).toHaveBeenCalledTimes(2);
    expect(groupRequesterActivationAsserter).toHaveBeenNthCalledWith(1, {
      groupRequester: null,
      inboundMailboxItemIds: ["mailbox_group_request"],
      routeAuthority:
        GROUP_NOTIFICATION_DESTINATION.externalThreadRouteAuthority,
      signal: expect.any(AbortSignal),
    });
    expect(groupRequesterActivationAsserter).toHaveBeenNthCalledWith(2, {
      groupRequester: null,
      inboundMailboxItemIds: ["mailbox_group_request"],
      routeAuthority:
        GROUP_NOTIFICATION_DESTINATION.externalThreadRouteAuthority,
      signal: expect.any(AbortSignal),
    });
  });

  it("fails before storage or provider work when group requester activation is not proven", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const activationError = new Error("group requester is not activated");

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      groupRequester: GROUP_REQUESTER,
      groupRequesterActivationAsserter: async () => {
        throw activationError;
      },
      memberId: "member_1",
      notificationDestinationResolver: async () =>
        GROUP_NOTIFICATION_DESTINATION,
      prisma: store.prisma,
      requestKey: "phone_call_group_request_blocked",
      runtime: runtime.runtime,
    })).rejects.toBe(activationError);

    expect(store.findCalls).toEqual([]);
    expect(store.findFirstCalls).toEqual([]);
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("rechecks current group authority immediately before provider start", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const activationError = new Error("group requester left before dispatch");
    const groupRequesterActivationAsserter = vi.fn(async () => {
      if (groupRequesterActivationAsserter.mock.calls.length === 2) {
        throw activationError;
      }
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      groupRequester: GROUP_REQUESTER,
      groupRequesterActivationAsserter,
      memberId: "member_1",
      notificationDestinationResolver: async () =>
        GROUP_NOTIFICATION_DESTINATION,
      prisma: store.prisma,
      reconciliationWorkflowStarter: vi.fn().mockResolvedValue({
        runId: "run_group_recheck",
      }),
      requestKey: "phone_call_group_request_recheck",
      runtime: runtime.runtime,
    })).rejects.toBe(activationError);

    expect(groupRequesterActivationAsserter).toHaveBeenCalledTimes(2);
    expect(runtime.startCalls).toEqual([]);
    expect(store.currentCall()).toMatchObject({ status: "failed" });
  });

  it("does not inspect group requester evidence for direct calls", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_direct" });
    const groupRequesterActivationAsserter = vi.fn(async () => {
      throw new Error("group-only gate must not run for direct calls");
    });

    await createHostedPhoneCall({
      brief: VALID_BRIEF,
      groupRequesterActivationAsserter,
      memberId: "member_1",
      prisma: store.prisma,
      requestKey: "phone_call_direct_request",
      runtime: runtime.runtime,
    });

    expect(groupRequesterActivationAsserter).not.toHaveBeenCalled();
    expect(runtime.startCalls).toHaveLength(1);
  });

  it("fails before storage or provider work when result delivery is unavailable", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });
    const routeError = new Error("notification route unavailable");

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      notificationDestinationResolver: async () => {
        throw routeError;
      },
      prisma: store.prisma,
      requestKey: "phone_call_route_missing",
      runtime: runtime.runtime,
    })).rejects.toBe(routeError);

    expect(store.findCalls).toEqual([]);
    expect(store.findFirstCalls).toEqual([]);
    expect(store.createCalls).toEqual([]);
    expect(runtime.startCalls).toEqual([]);
  });

  it("does not resolve a transfer destination when transfer permission is omitted", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_call_123" });
    let resolverCalls = 0;
    const brief = hostedPhoneCallBriefSchema.parse({
      goal: VALID_BRIEF.goal,
      instructions: VALID_BRIEF.instructions,
      shareableFacts: VALID_BRIEF.shareableFacts,
      successCriteria: VALID_BRIEF.successCriteria,
      timeZone: VALID_BRIEF.timeZone,
      to: VALID_BRIEF.to,
    });

    await createHostedPhoneCall({
      brief,
      memberId: "member_1",
      prisma: store.prisma,
      requestKey: "phone_call_request_1",
      runtime: runtime.runtime,
      transferNumberResolver: async () => {
        resolverCalls += 1;
        return "+12125550000";
      },
    });

    expect(resolverCalls).toBe(0);
    expect(runtime.startCalls).toEqual([{
      brief,
      id: store.createCalls[0]!.data.id,
      memberId: "member_1",
      transferNumber: null,
    }]);
  });
});

function createHostedPhoneCall(input: TestCreateHostedPhoneCallInput) {
  return createHostedPhoneCallDirect({
    reconciliationWorkflowStarter: async () => ({ runId: "run_test" }),
    transferNumberResolver: createTransferNumberResolver(null),
    ...input,
  });
}

function createHostedPhoneCallDirect(input: TestCreateHostedPhoneCallInput) {
  return createHostedPhoneCallImpl({
    notificationDestinationResolver: async () => DIRECT_NOTIFICATION_DESTINATION,
    originSessionId: "session_phone_call",
    ...input,
  });
}

function createPhoneCallStore(input: {
  created?: HostedPhoneCall;
  existing?: HostedPhoneCall;
  onFindUniqueOrThrow?: (input: PhoneCallFindInput) => Promise<void> | void;
  onReserve?: () => Promise<void> | void;
  onUpdateMany?: (input: PhoneCallUpdateManyInput) => Promise<void> | void;
  pending?: HostedPhoneCall;
}) {
  const createCalls: PhoneCallReserveInput[] = [];
  const findFirstCalls: PhoneCallFindFirstInput[] = [];
  const findCalls: PhoneCallFindInput[] = [];
  const updateManyCalls: PhoneCallUpdateManyInput[] = [];
  let current = input.created ?? input.existing ?? input.pending ?? buildHostedPhoneCall();
  const existing = input.existing ?? current;

  const prisma: PhoneCallStore = {
    markCleanupEnded: async (args) => {
      if (
        current.id !== args.id
        || current.providerCallId !== args.providerCallId
        || current.status !== "failed"
        || current.endedAt !== null
      ) {
        return { count: 0 };
      }
      current = {
        ...current,
        endedAt: new Date(),
      };
      return { count: 1 };
    },
    refreshDispatchAuthority: async (args) => {
      if (
        current.id !== args.id
        || current.provider !== "retell"
        || current.providerCallId !== null
        || current.status !== "starting"
        || current.analyzedAt !== null
        || current.updatedAt.getTime() !== args.expectedUpdatedAt.getTime()
      ) {
        return { count: 0 };
      }
      current = {
        ...current,
        updatedAt: args.updatedAt,
      };
      return { count: 1 };
    },
    reserve: async (args) => {
      if (input.existing) {
        return {
          call: existing,
          created: false,
        };
      }
      createCalls.push(args);
      current = {
        ...current,
        ...args.data,
        briefJson: null,
        providerCallId: null,
        resultEncrypted: null,
        resultJson: null,
      };
      await input.onReserve?.();
      return {
        call: current,
        created: true,
      };
    },
    hostedPhoneCall: {
      findFirst: async (args) => {
        findFirstCalls.push(args);
        return input.pending ?? null;
      },
      findUnique: async (args) => {
        findCalls.push(args);
        if ("id" in args.where) {
          return args.where.id === current.id ? current : null;
        }
        if (!input.existing) {
          return null;
        }
        return args.where.memberId_requestKey.memberId === current.memberId
          && args.where.memberId_requestKey.requestKey === current.requestKey
          ? current
          : null;
      },
      findUniqueOrThrow: async (args) => {
        findCalls.push(args);
        await input.onFindUniqueOrThrow?.(args);
        if ("id" in args.where) {
          if (args.where.id !== current.id) {
            throw new Error("Hosted phone call not found.");
          }
          return current;
        }

        return existing;
      },
      updateMany: async (args) => {
        updateManyCalls.push(args);
        await input.onUpdateMany?.(args);
        if (!matchesUpdateManyWhere(current, args.where)) {
          return { count: 0 };
        }

        current = {
          ...current,
          providerCallId: args.data.providerCallId ?? current.providerCallId,
          status: args.data.status,
        };
        return { count: 1 };
      },
    },
  };

  return {
    advanceCurrentCall: (overrides: Partial<HostedPhoneCall>) => {
      current = {
        ...current,
        ...overrides,
      };
    },
    createCalls,
    currentCall: () => current,
    findFirstCalls,
    findCalls,
    prisma,
    updateManyCalls,
  };
}

function createPhoneCallRuntime(input: {
  cleanupRequiredError?: Error;
  error?: Error;
  onStop?: (providerCallId: string) => Promise<void> | void;
  onStart?: (call: Parameters<PhoneCallRuntime["start"]>[0]) => Promise<void> | void;
  providerCallId: string;
  reconciliationError?: Error;
  reconciliationResult?: Awaited<ReturnType<PhoneCallRuntime["resolveProviderCall"]>>;
  stopError?: Error;
}) {
  const resolveCalls: string[] = [];
  const startCalls: Array<Parameters<PhoneCallRuntime["start"]>[0]> = [];
  const stopCalls: string[] = [];
  const runtime: PhoneCallRuntime = {
    resolveProviderCall: async (callId) => {
      resolveCalls.push(callId);
      if (input.reconciliationError) {
        throw input.reconciliationError;
      }
      return input.reconciliationResult ?? { state: "not_found" };
    },
    start: async (call) => {
      startCalls.push(call);
      await input.onStart?.(call);
      if (input.error) {
        throw input.error;
      }
      if (input.cleanupRequiredError) {
        return {
          cleanupRequired: true,
          error: input.cleanupRequiredError,
          providerCallId: input.providerCallId,
        };
      }
      return { providerCallId: input.providerCallId };
    },
    stopIfActive: async (providerCallId) => {
      stopCalls.push(providerCallId);
      await input.onStop?.(providerCallId);
      if (input.stopError) {
        throw input.stopError;
      }
    },
  };

  return {
    runtime,
    resolveCalls,
    startCalls,
    stopCalls,
  };
}

function createTransferNumberResolver(value: string | null): NonNullable<CreateHostedPhoneCallInput["transferNumberResolver"]> {
  return async () => value;
}

function matchesUpdateManyWhere(
  call: HostedPhoneCall,
  where: PhoneCallUpdateManyInput["where"],
): boolean {
  return call.id === where.id
    && call.provider === where.provider
    && call.providerCallId === where.providerCallId
    && call.status === where.status
    && (where.analyzedAt === undefined || call.analyzedAt === where.analyzedAt)
    && (
      where.updatedAt === undefined
      || call.updatedAt.getTime() === where.updatedAt.getTime()
    );
}

function buildHostedPhoneCall(overrides: Partial<HostedPhoneCall> = {}): HostedPhoneCall {
  const now = new Date("2026-06-25T00:00:00.000Z");
  return {
    analyzedAt: null,
    briefEncrypted: null,
    briefJson: VALID_BRIEF,
    createdAt: now,
    endedAt: null,
    id: "hpc_test",
    memberId: "member_1",
    originSessionId: "session_phone_call",
    provider: "retell",
    providerCallId: null,
    requestKey: "phone_call_request_1",
    resultDeliveryGeneration: 0,
    resultDeliveryStatus: null,
    resultDeliveryTerminalAt: null,
    resultEncrypted: null,
    resultJson: null,
    resultNotificationChannel: null,
    status: "starting",
    updatedAt: now,
    ...overrides,
  };
}
