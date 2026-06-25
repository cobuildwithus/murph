import { createHmac } from "node:crypto";

import type { HostedPhoneCall } from "@prisma/client";
import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";
import {
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRetellPhoneCallRuntime,
} from "@/src/lib/phone-calls/retell-runtime";
import { consultPhoneCall } from "@/src/lib/phone-calls/consult";
import {
  handleRetellCallAnalyzed,
  handleRetellCallEnded,
  mapRetellCallAnalysis,
} from "@/src/lib/phone-calls/result";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";

type RetellWebhookStore = NonNullable<Parameters<typeof handleRetellCallAnalyzed>[0]["prisma"]>;
type RetellWebhookTx = Parameters<RetellWebhookStore["$transaction"]>[0] extends (
  tx: infer Tx,
) => Promise<unknown>
  ? Tx
  : never;
type RetellWebhookFindUniqueInput = Parameters<RetellWebhookTx["hostedPhoneCall"]["findUnique"]>[0];
type RetellWebhookFindUniqueOrThrowInput = Parameters<RetellWebhookTx["hostedPhoneCall"]["findUniqueOrThrow"]>[0];
type RetellWebhookUpdateManyInput = Parameters<RetellWebhookTx["hostedPhoneCall"]["updateMany"]>[0];

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

describe("Retell phone-call runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates calls with the current Retell override shape and server-owned transfer number", async () => {
    vi.stubEnv("RETELL_API_KEY", "retell-api-key");
    vi.stubEnv("RETELL_FROM_NUMBER", "+12125559999");
    vi.stubEnv("RETELL_AGENT_ID", "agent_123");
    vi.stubEnv("RETELL_AGENT_VERSION", "prod");
    vi.stubEnv("RETELL_AGENT_DATA_STORAGE_SETTING", "basic_attributes_only");
    const fetchCalls: Array<{
      init?: RequestInit;
      url: RequestInfo | URL;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      fetchCalls.push({ init, url });
      return new Response(JSON.stringify({
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    };

    const result = await createRetellPhoneCallRuntime({ fetchImpl }).start({
      brief: VALID_BRIEF,
      id: "hpc_123",
      memberId: "member_123",
      transferNumber: "+12125550000",
    });

    expect(result).toEqual({ providerCallId: "retell_call_123" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("https://api.retellai.com/v2/create-phone-call");
    expect(fetchCalls[0]!.init?.method).toBe("POST");
    const headers = new Headers(fetchCalls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe(["Bearer", process.env.RETELL_API_KEY].join(" "));
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(fetchCalls[0]!.init?.body))).toEqual({
      agent_override: {
        metadata: {
          murph_phone_call_id: "hpc_123",
        },
        retell_llm_dynamic_variables: {
          call_brief: JSON.stringify(VALID_BRIEF),
          murph_timezone: "America/New_York",
          opening_line: "Hi, this is Murph, an AI assistant calling on the user's behalf. I'm calling Eye doctor's office to Schedule a routine eye examination for Friday, June 26, 2026.",
          transfer_number: "+12125550000",
        },
      },
      from_number: "+12125559999",
      override_agent_id: "agent_123",
      override_agent_version: "prod",
      to_number: "+12125550123",
    });
  });

  it("stops the Retell call and fails when the returned storage mode is not basic attributes only", async () => {
    vi.stubEnv("RETELL_API_KEY", "retell-api-key");
    vi.stubEnv("RETELL_FROM_NUMBER", "+12125559999");
    vi.stubEnv("RETELL_AGENT_ID", "agent_123");
    vi.stubEnv("RETELL_AGENT_VERSION", "prod");
    vi.stubEnv("RETELL_AGENT_DATA_STORAGE_SETTING", "basic_attributes_only");
    const fetchCalls: Array<{
      init?: RequestInit;
      url: RequestInfo | URL;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      fetchCalls.push({ init, url });
      if (String(url).includes("/stop-call/")) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({
        call_id: "retell_call_unsafe",
        data_storage_setting: "everything",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    };

    await expect(createRetellPhoneCallRuntime({ fetchImpl }).start({
      brief: VALID_BRIEF,
      id: "hpc_123",
      memberId: "member_123",
      transferNumber: null,
    })).rejects.toThrow("data_storage_setting everything");

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]!.url).toBe("https://api.retellai.com/v2/create-phone-call");
    expect(fetchCalls[1]!.url).toBe("https://api.retellai.com/v2/stop-call/retell_call_unsafe");
    expect(fetchCalls[1]!.init?.method).toBe("POST");
    const stopHeaders = new Headers(fetchCalls[1]!.init?.headers);
    expect(stopHeaders.get("authorization")).toBe(["Bearer", process.env.RETELL_API_KEY].join(" "));
  });

  it("surfaces structured diagnostics when storage mismatch stop fails", async () => {
    vi.stubEnv("RETELL_API_KEY", "retell-api-key");
    vi.stubEnv("RETELL_FROM_NUMBER", "+12125559999");
    vi.stubEnv("RETELL_AGENT_ID", "agent_123");
    vi.stubEnv("RETELL_AGENT_VERSION", "prod");
    vi.stubEnv("RETELL_AGENT_DATA_STORAGE_SETTING", "basic_attributes_only");
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("/stop-call/")) {
        return new Response(null, { status: 500 });
      }
      return new Response(JSON.stringify({
        call_id: "retell_call_unsafe",
        data_storage_setting: "everything",
      }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      });
    };

    await expect(createRetellPhoneCallRuntime({ fetchImpl }).start({
      brief: VALID_BRIEF,
      id: "hpc_123",
      memberId: "member_123",
      transferNumber: null,
    })).rejects.toMatchObject({
      code: "RETELL_STORAGE_MODE_MISMATCH",
      details: {
        code: "retell_storage_mode_mismatch",
        operationName: "retell.create_phone_call",
        statusCode: 500,
        storageMode: "everything",
        type: "retell_storage_mismatch_stop_http_failed",
      },
      httpStatus: 502,
      retryable: false,
    });
  });

  it("fails closed before Retell start when the agent storage mode is not configured as basic attributes only", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("Retell create call should not be requested");
    };

    await expect(createRetellPhoneCallRuntime({ fetchImpl }).start({
      brief: VALID_BRIEF,
      id: "hpc_123",
      memberId: "member_123",
      transferNumber: null,
    })).rejects.toThrow(
      "RETELL_AGENT_DATA_STORAGE_SETTING must be basic_attributes_only",
    );
  });
});

describe("verifyRetellSignature", () => {
  it("accepts the Retell raw-body HMAC header", () => {
    const rawBody = JSON.stringify({ event: "call_analyzed" });
    const now = new Date("2026-06-25T12:00:00.000Z");

    expect(() => verifyRetellSignature({
      apiKey: "retell-api-key",
      now,
      rawBody,
      signature: signRetellBody({
        apiKey: "retell-api-key",
        now,
        rawBody,
      }),
    })).not.toThrow();
  });

  it("rejects invalid and stale Retell signatures", () => {
    const rawBody = JSON.stringify({ event: "call_analyzed" });
    const signedAt = new Date("2026-06-25T12:00:00.000Z");

    expect(() => verifyRetellSignature({
      apiKey: "retell-api-key",
      now: signedAt,
      rawBody,
      signature: "v=1790000000000,d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })).toThrow("Invalid Retell signature.");
    expect(() => verifyRetellSignature({
      apiKey: "retell-api-key",
      now: new Date("2026-06-25T12:06:00.000Z"),
      rawBody,
      signature: signRetellBody({
        apiKey: "retell-api-key",
        now: signedAt,
        rawBody,
      }),
    })).toThrow("Invalid Retell signature.");
  });
});

describe("Retell phone-call result handling", () => {
  it("maps post-call analysis fields into the persisted phone-call result", () => {
    expect(mapRetellCallAnalysis({
      call_analysis: {
        call_summary: "Fallback summary",
        custom_analysis_data: {
          follow_up: "Ask the user whether Tuesday works.",
          outcome: "needs_user",
          result: "The office has no Friday availability.",
        },
      },
      call_id: "retell_call_123",
    })).toEqual({
      followUp: "Ask the user whether Tuesday works.",
      outcome: "needs_user",
      summary: "The office has no Friday availability.",
    });
  });

  it("updates call_ended once with provider id and end timestamp", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
    });

    await handleRetellCallEnded({
      call: {
        call_id: "retell_call_123",
        disconnection_reason: "dial_busy",
        end_timestamp: 1_782_345_600,
      },
      prisma: store.prisma,
    });

    expect(store.findUniqueCalls).toEqual([{
      where: {
        providerCallId: "retell_call_123",
      },
    }]);
    expect(store.updateManyCalls).toEqual([{
      data: {
        endedAt: new Date("2026-06-25T00:00:00.000Z"),
        status: "failed",
      },
      where: {
        endedAt: null,
        id: "hpc_123",
        provider: "retell",
        providerCallId: "retell_call_123",
        status: {
          in: ["starting", "calling", "ended"],
        },
      },
    }]);
  });

  it("persists ISO string Retell end timestamps as the real instant", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
    });

    await handleRetellCallEnded({
      call: {
        call_id: "retell_call_123",
        end_timestamp: "2026-06-25T12:34:56.000Z",
      },
      prisma: store.prisma,
    });

    expect(store.updateManyCalls).toEqual([{
      data: {
        endedAt: new Date("2026-06-25T12:34:56.000Z"),
        status: "ended",
      },
      where: {
        endedAt: null,
        id: "hpc_123",
        provider: "retell",
        providerCallId: "retell_call_123",
        status: {
          in: ["starting", "calling", "ended"],
        },
      },
    }]);
  });

  it("handles call_analyzed idempotently and notifies only after the first update", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
    });
    const call = {
      call_analysis: {
        custom_analysis_data: {
          outcome: "completed",
          result: "The appointment is booked for Friday at 3:45 PM.",
        },
      },
      call_id: "retell_call_123",
      data_storage_setting: "basic_attributes_only",
    };

    await handleRetellCallAnalyzed({
      call,
      prisma: store.prisma,
    });
    await handleRetellCallAnalyzed({
      call,
      prisma: store.prisma,
    });

    expect(store.updateManyCalls).toHaveLength(2);
    expect(store.updateManyCalls[0]).toMatchObject({
      data: {
        resultJson: {
          outcome: "completed",
          summary: "The appointment is booked for Friday at 3:45 PM.",
        },
        status: "completed",
      },
      where: {
        analyzedAt: null,
        id: "hpc_123",
        provider: "retell",
        providerCallId: "retell_call_123",
      },
    });
    expect(store.findUniqueOrThrowCalls).toEqual([{
      where: {
        id: "hpc_123",
      },
    }]);
    expect(store.appendResultNotificationCalls.map((callRecord) => callRecord.id)).toEqual([
      "hpc_123",
    ]);
  });

  it("rejects call_analyzed before persistence when Retell reports non-basic storage mode", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
    });

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "Booked.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "everything",
      },
      prisma: store.prisma,
    })).rejects.toMatchObject({
      code: "RETELL_STORAGE_MODE_MISMATCH",
      details: {
        code: "retell_storage_mode_mismatch",
        operationName: "retell.webhook.call_analyzed",
        type: "everything",
      },
      httpStatus: 409,
      retryable: true,
    });

    expect(store.findUniqueCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
    expect(store.appendResultNotificationCalls).toEqual([]);
  });

  it("rejects call_analyzed before persistence when Retell omits storage mode", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
    });

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "Booked.",
          },
        },
        call_id: "retell_call_123",
      },
      prisma: store.prisma,
    })).rejects.toMatchObject({
      code: "RETELL_STORAGE_MODE_MISMATCH",
      details: {
        code: "retell_storage_mode_mismatch",
        operationName: "retell.webhook.call_analyzed",
        type: "missing",
      },
      httpStatus: 409,
      retryable: true,
    });

    expect(store.findUniqueCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
    expect(store.appendResultNotificationCalls).toEqual([]);
  });

  it("recovers call_analyzed by Murph metadata when the provider id write was lost", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({
        id: "hpc_123",
        providerCallId: null,
        status: "starting",
      }),
    });

    await handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "Booked.",
          },
        },
        call_id: "retell_started",
        data_storage_setting: "basic_attributes_only",
        metadata: {
          murph_phone_call_id: "hpc_123",
        },
      },
      prisma: store.prisma,
    });

    expect(store.findUniqueCalls[0]).toEqual({
      where: {
        id: "hpc_123",
      },
    });
    expect(store.updateManyCalls[0]).toMatchObject({
      data: {
        providerCallId: "retell_started",
        status: "completed",
      },
      where: {
        analyzedAt: null,
        id: "hpc_123",
        provider: "retell",
      },
    });
    expect(store.updateManyCalls[0]!.where).not.toHaveProperty("providerCallId");
    expect(store.appendResultNotificationCalls.map((callRecord) => callRecord.id)).toEqual([
      "hpc_123",
    ]);
  });

  it("rolls back call_analyzed when notification enqueue fails so Retell replay can notify", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
      appendResultNotification: vi
        .fn(async (_call: HostedPhoneCall) => {})
        .mockRejectedValueOnce(new Error("mailbox unavailable"))
        .mockResolvedValueOnce(undefined),
    });
    const call = {
      call_analysis: {
        custom_analysis_data: {
          outcome: "completed",
          result: "Booked.",
        },
      },
      call_id: "retell_call_123",
      data_storage_setting: "basic_attributes_only",
    };

    await expect(handleRetellCallAnalyzed({
      call,
      prisma: store.prisma,
    })).rejects.toThrow("mailbox unavailable");

    expect(store.currentCall()?.analyzedAt).toBeNull();

    await handleRetellCallAnalyzed({
      call,
      prisma: store.prisma,
    });

    expect(store.appendResultNotificationCalls.map((callRecord) => callRecord.id)).toEqual([
      "hpc_123",
      "hpc_123",
    ]);
    expect(store.currentCall()?.analyzedAt).toBeInstanceOf(Date);
  });

  it("does not finalize call_analyzed when no result notification route is available", async () => {
    const store = createWebhookStore({
      call: buildHostedPhoneCall({ id: "hpc_123" }),
      appendResultNotification: async () => {
        throw new Error("result notification route unavailable");
      },
    });

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "Booked.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
      },
      prisma: store.prisma,
    })).rejects.toThrow("result notification route unavailable");

    expect(store.currentCall()).toMatchObject({
      analyzedAt: null,
      resultJson: null,
      status: "starting",
    });
    expect(store.appendResultNotificationCalls).toHaveLength(1);
  });
});

describe("consultPhoneCall", () => {
  it("continues with information explicitly approved in shareable facts", async () => {
    const transferNumberResolver = vi.fn(async () => {
      throw new Error("transfer lookup should not be needed for approved facts");
    });

    await expect(consultPhoneCall({
      call: {
        brief: VALID_BRIEF,
        id: "hpc_123",
        memberId: "member_123",
        providerCallId: "retell_call_123",
        status: "calling",
      },
      memberId: "member_123",
      question: "They asked for the callback phone number. What should I say?",
      transcript: "",
      transferNumberResolver,
    })).resolves.toEqual({
      answer: "Use this approved call-brief fact when relevant: callback number: +12125550111",
      directive: "continue",
    });
    expect(transferNumberResolver).not.toHaveBeenCalled();
  });

  it("fails closed instead of transferring when the brief disallows transfer", async () => {
    await expect(consultPhoneCall({
      call: {
        brief: {
          ...VALID_BRIEF,
          allowTransferToUser: false,
        },
        id: "hpc_123",
        memberId: "member_123",
        providerCallId: "retell_call_123",
        status: "calling",
      },
      memberId: "member_123",
      question: "They require identity verification. Should I transfer?",
      transcript: "",
      transferNumberResolver: async () => "+12125550000",
    })).resolves.toEqual({
      answer: "I cannot safely answer that from Murph during the live call. End the call and report what is needed.",
      directive: "end_call",
    });
  });

  it("fails closed instead of transferring when transfer permission is omitted", async () => {
    const brief = hostedPhoneCallBriefSchema.parse({
      goal: VALID_BRIEF.goal,
      instructions: VALID_BRIEF.instructions,
      shareableFacts: VALID_BRIEF.shareableFacts,
      successCriteria: VALID_BRIEF.successCriteria,
      timeZone: VALID_BRIEF.timeZone,
      to: VALID_BRIEF.to,
    });

    await expect(consultPhoneCall({
      call: {
        brief,
        id: "hpc_123",
        memberId: "member_123",
        providerCallId: "retell_call_123",
        status: "calling",
      },
      memberId: "member_123",
      question: "They require identity verification. Should I transfer?",
      transcript: "",
      transferNumberResolver: async () => "+12125550000",
    })).resolves.toEqual({
      answer: "I cannot safely answer that from Murph during the live call. End the call and report what is needed.",
      directive: "end_call",
    });
  });

  it("fails closed instead of transferring when no verified transfer number exists", async () => {
    await expect(consultPhoneCall({
      call: {
        brief: VALID_BRIEF,
        id: "hpc_123",
        memberId: "member_123",
        providerCallId: "retell_call_123",
        status: "calling",
      },
      memberId: "member_123",
      question: "They require identity verification. Should I transfer?",
      transcript: "",
      transferNumberResolver: async () => null,
    })).resolves.toMatchObject({
      directive: "end_call",
    });
  });

  it("allows transfer only when the brief and verified destination allow it", async () => {
    await expect(consultPhoneCall({
      call: {
        brief: VALID_BRIEF,
        id: "hpc_123",
        memberId: "member_123",
        providerCallId: "retell_call_123",
        status: "calling",
      },
      memberId: "member_123",
      question: "They require identity verification. Should I transfer?",
      transcript: "",
      transferNumberResolver: async () => "+12125550000",
    })).resolves.toMatchObject({
      directive: "transfer_to_user",
    });
  });
});

function signRetellBody(input: {
  apiKey: string;
  now: Date;
  rawBody: string;
}): string {
  const timestamp = String(input.now.getTime());
  const digest = createHmac("sha256", input.apiKey)
    .update(`${input.rawBody}${timestamp}`)
    .digest("hex");
  return `v=${timestamp},d=${digest}`;
}

function buildHostedPhoneCall(overrides: Partial<HostedPhoneCall> = {}): HostedPhoneCall {
  const now = new Date("2026-06-25T00:00:00.000Z");
  return {
    analyzedAt: null,
    briefJson: VALID_BRIEF,
    createdAt: now,
    endedAt: null,
    id: "hpc_test",
    memberId: "member_123",
    provider: "retell",
    providerCallId: "retell_call_123",
    requestKey: "phone_call_request_1",
    resultJson: null,
    status: "starting",
    updatedAt: now,
    ...overrides,
  };
}

function createWebhookStore(input: {
  appendResultNotification?: (call: HostedPhoneCall) => Promise<void>;
  call: HostedPhoneCall;
}) {
  let currentCall: HostedPhoneCall | null = input.call;
  const appendResultNotificationCalls: HostedPhoneCall[] = [];
  const findUniqueCalls: RetellWebhookFindUniqueInput[] = [];
  const findUniqueOrThrowCalls: RetellWebhookFindUniqueOrThrowInput[] = [];
  const updateManyCalls: RetellWebhookUpdateManyInput[] = [];

  const tx: RetellWebhookTx = {
    appendResultNotification: async (call) => {
      appendResultNotificationCalls.push(call);
      await input.appendResultNotification?.(call);
    },
    hostedPhoneCall: {
      findUnique: async (args) => {
        findUniqueCalls.push(args);
        return readCurrentCallByWhere(currentCall, args.where);
      },
      findUniqueOrThrow: async (args) => {
        findUniqueOrThrowCalls.push(args);
        const call = readCurrentCallByWhere(currentCall, args.where);
        if (!call) {
          throw new Error("HostedPhoneCall not found.");
        }
        return call;
      },
      updateMany: async (args) => {
        updateManyCalls.push(args);
        if (!currentCall || !matchesWebhookUpdateWhere(currentCall, args.where)) {
          return { count: 0 };
        }

        currentCall = {
          ...currentCall,
          analyzedAt: "analyzedAt" in args.data
            ? args.data.analyzedAt ?? currentCall.analyzedAt
            : currentCall.analyzedAt,
          endedAt: "endedAt" in args.data
            ? args.data.endedAt ?? currentCall.endedAt
            : currentCall.endedAt,
          providerCallId: "providerCallId" in args.data
            ? args.data.providerCallId ?? currentCall.providerCallId
            : currentCall.providerCallId,
          resultJson: "resultJson" in args.data
            ? args.data.resultJson ?? currentCall.resultJson
            : currentCall.resultJson,
          status: args.data.status,
        };
        return { count: 1 };
      },
    },
  };
  const prisma: RetellWebhookStore = {
    $transaction: async (callback) => {
      const before = currentCall;
      try {
        return await callback(tx);
      } catch (error) {
        currentCall = before;
        throw error;
      }
    },
  };

  return {
    appendResultNotificationCalls,
    currentCall: () => currentCall,
    findUniqueCalls,
    findUniqueOrThrowCalls,
    prisma,
    updateManyCalls,
  };
}

function readCurrentCallByWhere(
  call: HostedPhoneCall | null,
  where: RetellWebhookFindUniqueInput["where"] | RetellWebhookFindUniqueOrThrowInput["where"],
): HostedPhoneCall | null {
  if (!call) {
    return null;
  }
  if ("id" in where) {
    return call.id === where.id ? call : null;
  }
  return call.providerCallId === where.providerCallId ? call : null;
}

function matchesWebhookUpdateWhere(
  call: HostedPhoneCall,
  where: RetellWebhookUpdateManyInput["where"],
): boolean {
  if (call.id !== where.id || call.provider !== where.provider) {
    return false;
  }
  if (where.providerCallId !== undefined && call.providerCallId !== where.providerCallId) {
    return false;
  }
  if (where.analyzedAt === null && call.analyzedAt !== null) {
    return false;
  }
  if (where.endedAt === null && call.endedAt !== null) {
    return false;
  }
  if (where.status && !where.status.in.includes(call.status)) {
    return false;
  }
  return true;
}
