import { createHmac } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  consultPhoneCall: vi.fn(),
  getHostedPhoneCallForConsultation: vi.fn(),
  handleRetellCallAnalyzed: vi.fn(),
  handleRetellCallEnded: vi.fn(),
  handleRetellTransferOutcome: vi.fn(),
  signalHostedAssistantNotificationsBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/phone-calls/consult", () => ({
  consultPhoneCall: mocks.consultPhoneCall,
  getHostedPhoneCallForConsultation: mocks.getHostedPhoneCallForConsultation,
}));

vi.mock("@/src/lib/phone-calls/result", () => ({
  handleRetellCallAnalyzed: mocks.handleRetellCallAnalyzed,
  handleRetellCallEnded: mocks.handleRetellCallEnded,
  handleRetellTransferOutcome: mocks.handleRetellTransferOutcome,
}));

vi.mock("@/src/lib/hosted-execution/assistant-notifications", () => ({
  signalHostedAssistantNotificationsBestEffort:
    mocks.signalHostedAssistantNotificationsBestEffort,
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
    mocks.handleRetellCallAnalyzed.mockResolvedValue({
      notificationSignals: [{
        mailboxItemId: "mailbox_item_123",
        memberId: "member_123",
      }],
    });
    mocks.handleRetellCallEnded.mockResolvedValue({
      notificationSignals: [],
    });
    mocks.handleRetellTransferOutcome.mockResolvedValue({
      notificationSignals: [],
    });
    mocks.signalHostedAssistantNotificationsBestEffort.mockResolvedValue(undefined);
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
    });
  });

  it("drops unneeded Retell transcript fields before ask_murph consultation", async () => {
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
    expect(consultInput).not.toHaveProperty("transcript");
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
    mocks.handleRetellTransferOutcome
      .mockResolvedValueOnce({
        notificationSignals: [{
          mailboxItemId: "mailbox_item_bridge",
          memberId: "member_bridge",
        }],
      })
      .mockResolvedValueOnce({ notificationSignals: [] });
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
    const bridgedPayload = {
      call: {
        call_id: "retell_call_123",
      },
      event: "transfer_bridged",
      transfer_destination: "+12125550123",
      transfer_option: { type: "warm_transfer" },
    };
    const cancelledPayload = {
      call: {
        call_id: "retell_call_123",
      },
      event: "transfer_cancelled",
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
      payload: bridgedPayload,
      url: "https://join.example.test/api/retell/webhook",
    }))).resolves.toMatchObject({ status: 204 });
    await expect(retellWebhookRoute.POST(signedRetellRequest({
      payload: cancelledPayload,
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
    expect(mocks.handleRetellTransferOutcome).toHaveBeenNthCalledWith(1, {
      call: expect.objectContaining({
        call_id: "retell_call_123",
      }),
      event: "transfer_bridged",
    });
    expect(mocks.handleRetellTransferOutcome).toHaveBeenNthCalledWith(2, {
      call: expect.objectContaining({
        call_id: "retell_call_123",
      }),
      event: "transfer_cancelled",
    });
    expect(mocks.handleRetellTransferOutcome).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledTimes(4);
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_item_123",
      memberId: "member_123",
    }]);
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_item_bridge",
      memberId: "member_bridge",
    }]);
  });

  it("returns non-success when call analysis loses authority and requires replay", async () => {
    mocks.handleRetellCallAnalyzed.mockRejectedValueOnce(hostedOnboardingError({
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
    expect(mocks.signalHostedAssistantNotificationsBestEffort).not.toHaveBeenCalled();
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
      }),
    });
    expect(mocks.handleRetellCallAnalyzed.mock.calls.at(-1)?.[0]?.call)
      .not.toHaveProperty("transcript");
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_item_123",
      memberId: "member_123",
    }]);
  });

  it("does not wake the runtime when call_analyzed did not append a notification", async () => {
    mocks.handleRetellCallAnalyzed.mockResolvedValueOnce({
      notificationSignals: [],
    });

    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_id: "retell_call_123",
          data_storage_setting: "basic_attributes_only",
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(204);
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([]);
  });

  it("wakes every returned call_analyzed notification signal", async () => {
    mocks.handleRetellCallAnalyzed.mockResolvedValueOnce({
      notificationSignals: [
        {
          mailboxItemId: "mailbox_item_a",
          memberId: "member_a",
        },
        {
          mailboxItemId: "mailbox_item_b",
          memberId: "member_b",
        },
      ],
    });

    const response = await retellWebhookRoute.POST(signedRetellRequest({
      payload: {
        call: {
          call_id: "retell_call_123",
          data_storage_setting: "basic_attributes_only",
        },
        event: "call_analyzed",
      },
      url: "https://join.example.test/api/retell/webhook",
    }));

    expect(response.status).toBe(204);
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_item_a",
      memberId: "member_a",
    }, {
      mailboxItemId: "mailbox_item_b",
      memberId: "member_b",
    }]);
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
