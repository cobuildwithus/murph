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
type PhoneCallUpdateInput = Parameters<PhoneCallStore["hostedPhoneCall"]["update"]>[0];

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
    }]);
    expect(store.updateCalls).toEqual([{
      data: {
        providerCallId: "retell_call_123",
        status: "calling",
      },
      where: { id: createdCallId },
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
    expect(store.findCalls).toEqual([{ where: { requestKey: existing.requestKey } }]);
    expect(runtime.startCalls).toEqual([]);
    expect(store.updateCalls).toEqual([]);
  });

  it("fails closed when a duplicate request key belongs to another member", async () => {
    const existing = buildHostedPhoneCall({
      memberId: "member_2",
      requestKey: "phone_call_request_1",
      status: "calling",
    });
    const store = createPhoneCallStore({
      createError: createUniqueRequestKeyError(["request_key"]),
      existing,
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_unused" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: "member_1",
      prisma: store.prisma,
      requestKey: existing.requestKey,
      runtime: runtime.runtime,
    })).rejects.toThrow("request key collision");

    expect(runtime.startCalls).toEqual([]);
    expect(store.updateCalls).toEqual([]);
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
    })).rejects.toThrow("provider unavailable");

    const createdCallId = store.createCalls[0]!.data.id;
    expect(store.updateCalls).toEqual([{
      data: {
        resultJson: {
          outcome: "not_completed",
          summary: "Murph could not start the phone call.",
        },
        status: "failed",
      },
      where: { id: createdCallId },
    }]);
  });

  it("does not mark the call failed after the provider already started", async () => {
    const created = buildHostedPhoneCall();
    const store = createPhoneCallStore({
      created,
      updateError: new Error("database unavailable"),
    });
    const runtime = createPhoneCallRuntime({ providerCallId: "retell_started" });

    await expect(createHostedPhoneCall({
      brief: VALID_BRIEF,
      memberId: created.memberId,
      prisma: store.prisma,
      requestKey: created.requestKey,
      runtime: runtime.runtime,
    })).rejects.toThrow("database unavailable");

    const createdCallId = store.createCalls[0]!.data.id;
    expect(runtime.startCalls).toEqual([{
      brief: VALID_BRIEF,
      id: createdCallId,
      memberId: created.memberId,
    }]);
    expect(store.updateCalls).toEqual([{
      data: {
        providerCallId: "retell_started",
        status: "calling",
      },
      where: { id: createdCallId },
    }]);
  });
});

function createPhoneCallStore(input: {
  createError?: unknown;
  created?: HostedPhoneCall;
  existing?: HostedPhoneCall;
  updateError?: Error;
}) {
  const createCalls: PhoneCallCreateInput[] = [];
  const findCalls: PhoneCallFindInput[] = [];
  const updateCalls: PhoneCallUpdateInput[] = [];
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
        return existing;
      },
      update: async (args) => {
        updateCalls.push(args);
        if (input.updateError) {
          throw input.updateError;
        }
        current = {
          ...current,
          providerCallId: args.data.providerCallId ?? current.providerCallId,
          resultJson: args.data.resultJson ?? current.resultJson,
          status: args.data.status,
        };
        return current;
      },
    },
  };

  return {
    createCalls,
    findCalls,
    prisma,
    updateCalls,
  };
}

function createPhoneCallRuntime(input: {
  error?: Error;
  providerCallId: string;
}) {
  const startCalls: Array<Parameters<PhoneCallRuntime["start"]>[0]> = [];
  const runtime: PhoneCallRuntime = {
    start: async (call) => {
      startCalls.push(call);
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
