import { createHmac } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consultPhoneCall: vi.fn(),
  getHostedPhoneCallForConsultation: vi.fn(),
  handleRetellCallAnalyzed: vi.fn(),
  handleRetellCallEnded: vi.fn(),
}));

vi.mock("@/src/lib/phone-calls/consult", () => ({
  consultPhoneCall: mocks.consultPhoneCall,
  getHostedPhoneCallForConsultation: mocks.getHostedPhoneCallForConsultation,
}));

vi.mock("@/src/lib/phone-calls/result", () => ({
  handleRetellCallAnalyzed: mocks.handleRetellCallAnalyzed,
  handleRetellCallEnded: mocks.handleRetellCallEnded,
}));

type AskMurphRouteModule = typeof import("../app/api/retell/functions/ask-murph/route");
type RetellWebhookRouteModule = typeof import("../app/api/retell/webhook/route");

let askMurphRoute: AskMurphRouteModule;
let retellWebhookRoute: RetellWebhookRouteModule;

describe("Retell ask_murph route", () => {
  beforeAll(async () => {
    askMurphRoute = await import("../app/api/retell/functions/ask-murph/route");
    retellWebhookRoute = await import("../app/api/retell/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RETELL_API_KEY", "retell-api-key");
    mocks.getHostedPhoneCallForConsultation.mockResolvedValue({
      brief: {
        goal: "Schedule an appointment.",
      },
      id: "hpc_123",
      memberId: "member_123",
      providerCallId: "retell_call_123",
      status: "calling",
    });
    mocks.consultPhoneCall.mockResolvedValue({
      answer: "Choose the 3:45 PM slot.",
      directive: "continue",
    });
    mocks.handleRetellCallAnalyzed.mockResolvedValue(undefined);
    mocks.handleRetellCallEnded.mockResolvedValue(undefined);
  });

  it("verifies the signed raw Retell function body and returns Murph advice", async () => {
    const payload = {
      args: {
        question: "The office has 11:15 AM and 3:45 PM. Which should I choose?",
      },
      call: {
        call_id: "retell_call_123",
        metadata: {
          murph_phone_call_id: "hpc_123",
        },
        transcript: "Retell transcript so far.",
      },
      name: "ask_murph",
    };

    const response = await askMurphRoute.POST(signedRetellRequest({
      payload,
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "Choose the 3:45 PM slot.",
      directive: "continue",
    });
    expect(mocks.getHostedPhoneCallForConsultation).toHaveBeenCalledWith({
      callId: "hpc_123",
      providerCallId: "retell_call_123",
    });
    expect(mocks.consultPhoneCall).toHaveBeenCalledWith({
      call: expect.objectContaining({
        id: "hpc_123",
      }),
      memberId: "member_123",
      question: "The office has 11:15 AM and 3:45 PM. Which should I choose?",
      transcript: "Retell transcript so far.",
    });
  });

  it("accepts signed ask_murph payloads with long Retell transcripts", async () => {
    const longTranscript = "caller ".repeat(50 * 1024);
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: {
        args: {
          question: "The office needs guidance. What should I do?",
        },
        call: {
          call_id: "retell_call_123",
          metadata: {
            murph_phone_call_id: "hpc_123",
          },
          transcript: longTranscript,
        },
        name: "ask_murph",
      },
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(200);
    const consultInput = mocks.consultPhoneCall.mock.calls.at(-1)?.[0];
    expect(consultInput?.question).toBe("The office needs guidance. What should I do?");
    expect(consultInput?.transcript).toHaveLength(longTranscript.length);
  });

  it("rejects ask_murph calls that do not carry the Murph call id", async () => {
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: {
        args: {
          question: "What now?",
        },
        call: {
          call_id: "retell_call_123",
          metadata: {},
        },
        name: "ask_murph",
      },
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RETELL_MURPH_CALL_ID_REQUIRED",
        message: "Missing Murph phone call id.",
      },
    });
    expect(mocks.consultPhoneCall).not.toHaveBeenCalled();
  });

  it("routes only Retell call lifecycle webhook events Murph consumes", async () => {
    const endedPayload = {
      call: {
        call_id: "retell_call_123",
        disconnection_reason: "user_hangup",
      },
      event: "call_ended",
    };
    const analyzedPayload = {
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "Booked.",
          },
        },
        call_id: "retell_call_123",
      },
      event: "call_analyzed",
    };
    const ignoredPayload = {
      call: {
        call_id: "retell_call_123",
      },
      event: "call_started",
    };

    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: endedPayload,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });
    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: analyzedPayload,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });
    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: ignoredPayload,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });

    expect(mocks.handleRetellCallEnded).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_id: "retell_call_123",
      }),
    });
    expect(mocks.handleRetellCallAnalyzed).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_id: "retell_call_123",
      }),
    });
    expect(mocks.handleRetellCallEnded).toHaveBeenCalledTimes(1);
    expect(mocks.handleRetellCallAnalyzed).toHaveBeenCalledTimes(1);
  });

  it("accepts signed call_analyzed webhooks with long Retell transcripts", async () => {
    const longTranscript = "agent ".repeat(120 * 1024);

    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_analysis: {
            custom_analysis_data: {
              outcome: "completed",
              result: "Booked.",
            },
          },
          call_id: "retell_call_123",
          metadata: {
            murph_phone_call_id: "hpc_123",
          },
          transcript: longTranscript,
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(204);
    expect(mocks.handleRetellCallAnalyzed).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_id: "retell_call_123",
        transcript: expect.stringMatching(/^agent /u),
      }),
    });
  });
});

function signedRetellRequest(input: {
  payload: unknown;
  url: string;
}): Request {
  const rawBody = JSON.stringify(input.payload);
  const timestamp = String(Date.now());
  const digest = createHmac("sha256", "retell-api-key")
    .update(`${rawBody}${timestamp}`)
    .digest("hex");
  return new Request(input.url, {
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-retell-signature": `v=${timestamp},d=${digest}`,
    },
    method: "POST",
  });
}
