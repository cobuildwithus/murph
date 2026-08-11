import { createHmac } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  accountRetellPhoneCallUsage: vi.fn(),
  consultPhoneCall: vi.fn(),
  finalizePreparedRetellCallResult: vi.fn(),
  getHostedPhoneCallForConsultation: vi.fn(),
  handleRetellCallEnded: vi.fn(),
}));

vi.mock("@/src/lib/phone-calls/consult", () => ({
  consultPhoneCall: mocks.consultPhoneCall,
  getHostedPhoneCallForConsultation: mocks.getHostedPhoneCallForConsultation,
}));

vi.mock("@/src/lib/phone-calls/result", () => ({
  finalizePreparedRetellCallResult: mocks.finalizePreparedRetellCallResult,
  handleRetellCallEnded: mocks.handleRetellCallEnded,
}));

vi.mock("@/src/lib/phone-calls/usage", () => ({
  accountRetellPhoneCallUsage: mocks.accountRetellPhoneCallUsage,
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
    mocks.accountRetellPhoneCallUsage.mockResolvedValue("accounted");
    mocks.finalizePreparedRetellCallResult.mockResolvedValue(undefined);
    mocks.handleRetellCallEnded.mockResolvedValue(undefined);
  });

  it("verifies the signed raw Retell function body and returns Murph advice", async () => {
    const payload = {
      args: {
        question: "The office has 11:15 AM and 3:45 PM. Which should I choose?",
      },
      call: {
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
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
      providerStorageVerified: true,
      signal: expect.any(AbortSignal),
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
          data_storage_setting: "basic_attributes_only",
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
          data_storage_setting: "basic_attributes_only",
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
        data_storage_setting: "basic_attributes_only",
      },
      event: "call_analyzed",
    };
    const ignoredPayload = {
      call: {
        call_id: "retell_call_123",
      },
      event: "call_started",
    };
    const transferEndedPayload = {
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "needs_user",
            result: "An option was available before handoff.",
          },
        },
        call_cost: {
          combined_cost: 12.5,
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
        disconnection_reason: "call_transfer",
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
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
    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: transferEndedPayload,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });

    expect(mocks.handleRetellCallEnded).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_id: "retell_call_123",
      }),
    });
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenNthCalledWith(1, {
      call: expect.objectContaining({
        call_id: "retell_call_123",
      }),
      requiresTransferFollowUp: false,
    });
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenNthCalledWith(2, {
      call: expect.objectContaining({
        call_analysis: expect.objectContaining({
          custom_analysis_data: expect.objectContaining({
            follow_up: null,
            outcome: "needs_user",
            result: expect.stringContaining("post-handoff outcome is unknown"),
          }),
        }),
        call_id: "retell_call_123",
        transfer_end_timestamp: 1_782_408_600_000,
      }),
      requiresTransferFollowUp: true,
    });
    expect(mocks.handleRetellCallEnded).toHaveBeenCalledTimes(1);
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledTimes(2);
    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledTimes(3);
    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenLastCalledWith({
      call: expect.objectContaining({
        call_id: "retell_call_123",
        transfer_end_timestamp: 1_782_408_600_000,
      }),
    });
  });

  it("defers transferred analysis until transfer_ended and sends one post-handoff result", async () => {
    const pendingAnalysis = {
      call: {
        call_analysis: {
          custom_analysis_data: {
            follow_up: "Approval is still needed.",
            outcome: "needs_user",
            result: "An option was available, but the automated leg did not complete it.",
          },
        },
        call_id: "retell_call_transfer",
        data_storage_setting: "basic_attributes_only",
        disconnection_reason: "call_transfer",
      },
      event: "call_analyzed",
    };
    const transferEnded = {
      call: {
        ...pendingAnalysis.call,
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
    };

    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: pendingAnalysis,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });

    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledOnce();
    expect(mocks.finalizePreparedRetellCallResult).not.toHaveBeenCalled();

    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: transferEnded,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });

    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledTimes(2);
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledOnce();
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_analysis: expect.objectContaining({
          custom_analysis_data: expect.objectContaining({
            follow_up: null,
            outcome: "needs_user",
            result: expect.stringContaining(
              "Murph successfully connected the user to the call recipient",
            ),
          }),
        }),
      }),
      requiresTransferFollowUp: true,
    });
  });

  it("returns non-success when call analysis loses authority and requires replay", async () => {
    mocks.finalizePreparedRetellCallResult.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_ANALYSIS_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Hosted phone call analysis lost authority and must be retried.",
      retryable: true,
    }));

    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_analysis: {
            custom_analysis_data: {
              outcome: "not_completed",
              result: "The line was busy.",
            },
          },
          call_id: "retell_call_123",
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_PHONE_CALL_ANALYSIS_RETRY_REQUIRED",
      },
    });
    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledOnce();
  });

  it("keeps call-ended lifecycle handling available when accounting fails", async () => {
    mocks.accountRetellPhoneCallUsage.mockRejectedValueOnce(
      new Error("usage storage unavailable"),
    );

    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_cost: { combined_cost: 4.5 },
          call_id: "retell_call_123",
          end_timestamp: 1_782_386_400_000,
        },
        event: "call_ended",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(500);
    expect(mocks.handleRetellCallEnded).toHaveBeenCalledOnce();
  });

  it("delivers analyzed results when accounting fails and converges on replay", async () => {
    mocks.accountRetellPhoneCallUsage
      .mockRejectedValueOnce(new Error("usage storage unavailable"))
      .mockResolvedValueOnce("accounted");
    const request = () => signedRetellRequest({
      payload: {
        call: {
          call_analysis: {
            custom_analysis_data: {
              outcome: "completed",
              result: "Booked.",
            },
          },
          call_cost: { combined_cost: 4.5 },
          call_id: "retell_call_123",
          data_storage_setting: "basic_attributes_only",
          end_timestamp: 1_782_386_400_000,
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    });

    await expect(retellWebhookRoute.POST(request())).resolves.toMatchObject({
      status: 500,
    });
    await expect(retellWebhookRoute.POST(request())).resolves.toMatchObject({
      status: 204,
    });

    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledTimes(2);
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledTimes(2);
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
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_id: "retell_call_123",
        transcript: expect.stringMatching(/^agent /u),
      }),
      requiresTransferFollowUp: false,
    });
  });

  it("keeps result handling available when Retell cost telemetry is malformed", async () => {
    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_analysis: {
            custom_analysis_data: {
              outcome: "completed",
              result: "Booked.",
            },
          },
          call_cost: {
            combined_cost: "invalid",
          },
          call_id: "retell_call_123",
          data_storage_setting: "basic_attributes_only",
          duration_ms: -1,
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(204);
    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_cost: null,
        duration_ms: null,
      }),
    });
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledOnce();
  });

  it("keeps result handling available when Retell cost telemetry exceeds supported micros", async () => {
    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_analysis: {
            custom_analysis_data: {
              outcome: "completed",
              result: "Booked.",
            },
          },
          call_cost: {
            combined_cost: Number.MAX_VALUE,
          },
          call_id: "retell_call_123",
          data_storage_setting: "basic_attributes_only",
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(204);
    expect(mocks.accountRetellPhoneCallUsage).toHaveBeenCalledWith({
      call: expect.objectContaining({
        call_cost: null,
      }),
    });
    expect(mocks.finalizePreparedRetellCallResult).toHaveBeenCalledOnce();
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
