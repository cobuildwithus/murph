import {
  Prisma,
  type HostedPhoneCall,
} from "@prisma/client";
import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";
import { describe, expect, it } from "vitest";

import { createHostedPhoneCall } from "@/src/lib/phone-calls/service";
import type { PhoneCallRuntime } from "@/src/lib/phone-calls/types";

type CreateHostedPhoneCallInput = Parameters<typeof createHostedPhoneCall>[0];
type PhoneCallStore = NonNullable<CreateHostedPhoneCallInput["prisma"]>;
type PhoneCallCreateInput = Parameters<PhoneCallStore["hostedPhoneCall"]["create"]>[0];
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
      briefJson: VALID_BRIEF,
      memberId: "member_1",
      provider: "retell",
      requestKey: "phone_call_request_1",
      status: "starting",
    });
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
      id: "hpc_existing",
      providerCallId: "retell_existing",
      status: "calling",
    });
    const store = createPhoneCallStore({
      createError: createUniqueRequestKeyError(["requestKey"]),
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
    expect(store.findCalls).toEqual([{
      where: {
        memberId_requestKey: {
          memberId: existing.memberId,
          requestKey: existing.requestKey,
        },
      },
    }]);
    expect(runtime.startCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it("fails closed when a duplicate request key carries a different brief", async () => {
    const existing = buildHostedPhoneCall({
      briefJson: VALID_BRIEF,
      providerCallId: "retell_existing",
      status: "calling",
    });
    const store = createPhoneCallStore({
      createError: createUniqueRequestKeyError(["requestKey"]),
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
      error: new Error("provider unavailable"),
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
        resultJson: {
          outcome: "not_completed",
          summary: "Murph could not start the phone call.",
        },
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
    expect(store.updateManyCalls).toEqual([{
      data: {
        resultJson: {
          outcome: "not_completed",
          summary: "Murph could not start the phone call.",
        },
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
});

function createPhoneCallStore(input: {
  createError?: unknown;
  created?: HostedPhoneCall;
  existing?: HostedPhoneCall;
}) {
  const createCalls: PhoneCallCreateInput[] = [];
  const findCalls: PhoneCallFindInput[] = [];
  const updateManyCalls: PhoneCallUpdateManyInput[] = [];
  let current = input.created ?? buildHostedPhoneCall();
  const existing = input.existing ?? current;

  const prisma: PhoneCallStore = {
    hostedPhoneCall: {
      create: async (args) => {
        createCalls.push(args);
        if (input.createError) {
          throw input.createError;
        }
        current = {
          ...current,
          ...args.data,
          providerCallId: null,
          resultJson: null,
        };
        return current;
      },
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
          resultJson: args.data.resultJson ?? current.resultJson,
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
  error?: Error;
  onStart?: (call: Parameters<PhoneCallRuntime["start"]>[0]) => Promise<void> | void;
  providerCallId: string;
}) {
  const startCalls: Array<Parameters<PhoneCallRuntime["start"]>[0]> = [];
  const runtime: PhoneCallRuntime = {
    start: async (call) => {
      startCalls.push(call);
      await input.onStart?.(call);
      if (input.error) {
        throw input.error;
      }
      return { providerCallId: input.providerCallId };
    },
  };

  return {
    runtime,
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
    briefJson: VALID_BRIEF,
    createdAt: now,
    endedAt: null,
    id: "hpc_test",
    memberId: "member_1",
    provider: "retell",
    providerCallId: null,
    requestKey: "phone_call_request_1",
    resultJson: null,
    status: "starting",
    updatedAt: now,
    ...overrides,
  };
}

function createUniqueRequestKeyError(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("duplicate phone call request", {
    clientVersion: "test",
    code: "P2002",
    meta: { target },
  });
}
