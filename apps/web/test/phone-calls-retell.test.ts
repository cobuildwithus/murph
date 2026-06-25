import { createHmac } from "node:crypto";

import type { HostedPhoneCall } from "@prisma/client";
import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRetellPhoneCallRuntime,
} from "@/src/lib/phone-calls/retell-runtime";
import {
  handleRetellCallAnalyzed,
  handleRetellCallEnded,
  mapRetellCallAnalysis,
} from "@/src/lib/phone-calls/result";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";

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
    vi.stubEnv("RETELL_CREATE_PHONE_CALL_URL", "https://retell.example.test/v2/create-phone-call");
    const fetchCalls: Array<{
      init?: RequestInit;
      url: RequestInfo | URL;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      fetchCalls.push({ init, url });
      return new Response(JSON.stringify({ call_id: "retell_call_123" }), {
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
    expect(fetchCalls[0]!.url).toBe("https://retell.example.test/v2/create-phone-call");
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
    const updateCalls: unknown[] = [];
    const store = {
      hostedPhoneCall: {
        findUniqueOrThrow: async () => buildHostedPhoneCall(),
        updateMany: async (input: unknown) => {
          updateCalls.push(input);
          return { count: 1 };
        },
      },
    };

    await handleRetellCallEnded({
      call: {
        call_id: "retell_call_123",
        disconnection_reason: "dial_busy",
        end_timestamp: 1_782_345_600,
      },
      prisma: store,
    });

    expect(updateCalls).toEqual([{
      data: {
        endedAt: new Date("2026-06-25T00:00:00.000Z"),
        status: "failed",
      },
      where: {
        endedAt: null,
        provider: "retell",
        providerCallId: "retell_call_123",
        status: {
          in: ["starting", "calling", "ended"],
        },
      },
    }]);
  });

  it("handles call_analyzed idempotently and notifies only after the first update", async () => {
    const updateCalls: unknown[] = [];
    const findCalls: unknown[] = [];
    const resultHandler = vi.fn(async () => {});
    const store = {
      hostedPhoneCall: {
        findUniqueOrThrow: async (input: unknown) => {
          findCalls.push(input);
          return buildHostedPhoneCall({ id: "hpc_123" });
        },
        updateMany: async (input: unknown) => {
          updateCalls.push(input);
          return { count: updateCalls.length === 1 ? 1 : 0 };
        },
      },
    };
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
      prisma: store,
      resultHandler,
    });
    await handleRetellCallAnalyzed({
      call,
      prisma: store,
      resultHandler,
    });

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]).toMatchObject({
      data: {
        resultJson: {
          outcome: "completed",
          summary: "The appointment is booked for Friday at 3:45 PM.",
        },
        status: "completed",
      },
      where: {
        analyzedAt: null,
        provider: "retell",
        providerCallId: "retell_call_123",
      },
    });
    expect(findCalls).toEqual([{
      where: {
        providerCallId: "retell_call_123",
      },
    }]);
    expect(resultHandler).toHaveBeenCalledTimes(1);
    expect(resultHandler).toHaveBeenCalledWith("hpc_123");
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
