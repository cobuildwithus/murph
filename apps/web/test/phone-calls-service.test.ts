import type { HostedPhoneCall } from "@prisma/client";
import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";
import {
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";
import { describe, expect, it, vi } from "vitest";

import {
  encryptHostedPhoneCallBrief,
} from "@/src/lib/phone-calls/crypto";
import {
  createHostedPhoneCall as createHostedPhoneCallImpl,
} from "@/src/lib/phone-calls/service";
import {
  markPhoneCallRuntimeNoActiveEffect,
  type PhoneCallRuntime,
} from "@/src/lib/phone-calls/types";

type CreateHostedPhoneCallInput = Parameters<typeof createHostedPhoneCallImpl>[0];
type PhoneCallStore = NonNullable<CreateHostedPhoneCallInput["prisma"]>;
type PhoneCallReserveInput = Parameters<PhoneCallStore["reserve"]>[0];
type PhoneCallFindInput = Parameters<PhoneCallStore["hostedPhoneCall"]["findUniqueOrThrow"]>[0];
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

describe("createHostedPhoneCall", () => {
  it("creates the local call row before starting Retell and stores the provider id", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_call_123" });

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      prisma: store.prisma,
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
      provider: "retell",
      requestKey: "phone_call_request_1",
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

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    });

    expect(response).toEqual({
      phoneCallId: "hpc_existing",
      status: "starting",
    });
    expect(runtime.startCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
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
      },
    }]);
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

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: existing.memberId,
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).resolves.toEqual({
      phoneCallId: "hpc_existing",
      status: "starting",
    });
    expect(runtime.startCalls).toEqual([]);
    expect(runtime.resolveCalls).toEqual(["hpc_existing"]);
    expect(store.updateManyCalls).toEqual([]);
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

  it("persists provider authority when unsafe storage cleanup remains pending", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const cleanupError = new Error("unsafe provider storage");
    const runtime = createPhoneCallRuntime({
      cleanupRequiredError: cleanupError,
      providerCallId: "retell_cleanup_pending",
    });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).rejects.toBe(cleanupError);

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
  });

  it("fails before provider start when no result notification route is available", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCallImpl({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      resultNotificationRouteResolver: async () => {
        throw new Error("result notification route unavailable");
      },
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver("+12125550000"),
    })).rejects.toThrow("result notification route unavailable");

    expect(runtime.startCalls).toEqual([]);
    expect(store.createCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it("does not reserve or invoke a provider after the caller aborts during prerequisites", async () => {
    const controller = new AbortController();
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({ created });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCallImpl({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      resultNotificationRouteResolver: async () => {
        controller.abort();
      },
      runtime: runtime.runtime,
      signal: controller.signal,
      transferNumberResolver: createTransferNumberResolver("+12125550000"),
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

    await expect(createHostedPhoneCallImpl({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      resultNotificationRouteResolver: async () => {},
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

  it("allows individually bounded prerequisites to exceed the generic 30-second control timeout", async () => {
    vi.useFakeTimers();
    try {
      const created = buildHostedPhoneCall();
      const store = createPhoneCallStore({ created });
      const runtime = createPhoneCallRuntime({ providerCallId: "retell_call_123" });
      const response = createHostedPhoneCallImpl({
        brief: VALID_BRIEF,
        memberId: created.memberId,
        prisma: store.prisma,
        requestKey: created.requestKey,
        resultNotificationRouteResolver: async () => {
          await new Promise((resolve) => setTimeout(resolve, 16_000));
        },
        runtime: runtime.runtime,
        transferNumberResolver: async () => {
          await new Promise((resolve) => setTimeout(resolve, 16_000));
          return null;
        },
      });

      await vi.advanceTimersByTimeAsync(32_000);
      await expect(response).resolves.toMatchObject({ status: "calling" });
      expect(runtime.startCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver("+12125550000"),
    });

    const createdCallId = store.createCalls[0]!.data.id;
    expect(response).toEqual({
      phoneCallId: createdCallId,
      status: "starting",
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

    const response = await createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
      transferNumberResolver: createTransferNumberResolver(null),
    });

    const createdCallId = store.createCalls[0]!.data.id;
    expect(response).toEqual({
      phoneCallId: createdCallId,
      status: "starting",
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

function createHostedPhoneCall(input: CreateHostedPhoneCallInput) {
  return createHostedPhoneCallImpl({
    resultNotificationRouteResolver: async () => {},
    transferNumberResolver: createTransferNumberResolver(null),
    ...input,
  });
}

function createPhoneCallStore(input: {
  created?: HostedPhoneCall;
  existing?: HostedPhoneCall;
  onReserve?: () => Promise<void> | void;
}) {
  const createCalls: PhoneCallReserveInput[] = [];
  const findCalls: PhoneCallFindInput[] = [];
  const updateManyCalls: PhoneCallUpdateManyInput[] = [];
  let current = input.created ?? input.existing ?? buildHostedPhoneCall();
  const existing = input.existing ?? current;

  const prisma: PhoneCallStore = {
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
      findUniqueOrThrow: async (args) => {
        findCalls.push(args);
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
    findCalls,
    prisma,
    updateManyCalls,
  };
}

function createPhoneCallRuntime(input: {
  cleanupRequiredError?: Error;
  error?: Error;
  onStart?: (call: Parameters<PhoneCallRuntime["start"]>[0]) => Promise<void> | void;
  providerCallId: string;
  reconciliationError?: Error;
  reconciliationResult?: Awaited<ReturnType<PhoneCallRuntime["resolveProviderCall"]>>;
}) {
  const resolveCalls: string[] = [];
  const startCalls: Array<Parameters<PhoneCallRuntime["start"]>[0]> = [];
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
  };

  return {
    runtime,
    resolveCalls,
    startCalls,
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
    && (where.analyzedAt === undefined || call.analyzedAt === where.analyzedAt);
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
    provider: "retell",
    providerCallId: null,
    requestKey: "phone_call_request_1",
    resultEncrypted: null,
    resultJson: null,
    status: "starting",
    updatedAt: now,
    ...overrides,
  };
}
