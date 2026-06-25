import { createHmac } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPhoneCallForConsultation: vi.fn(),
}));

vi.mock("@/src/lib/phone-calls/consult", async (importActual) => {
  const actual =
    await importActual<typeof import("@/src/lib/phone-calls/consult")>();
  return {
    ...actual,
    getHostedPhoneCallForConsultation: mocks.getHostedPhoneCallForConsultation,
  };
});

type AskMurphRouteModule =
  typeof import("../app/api/retell/functions/ask-murph/route");

let askMurphRoute: AskMurphRouteModule;

describe("Retell ask_murph route with real consultation", () => {
  beforeAll(async () => {
    askMurphRoute = await import("../app/api/retell/functions/ask-murph/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RETELL_API_KEY", "retell-api-key");
    mocks.getHostedPhoneCallForConsultation.mockResolvedValue({
      brief: {
        allowTransferToUser: true,
        goal: "Schedule an appointment.",
        instructions: [],
        shareableFacts: {
          callback_number: "+12125550111",
        },
        successCriteria: "The office confirms the appointment.",
        timeZone: "America/New_York",
        to: {
          label: "Office",
          phoneNumber: "+12125550123",
        },
      },
      id: "hpc_123",
      memberId: "member_123",
      providerCallId: "retell_call_123",
      status: "calling",
    });
  });

  it("can continue when the answer is already in the approved call brief", async () => {
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: {
        args: {
          question: "They asked for the callback phone number. What should I say?",
        },
        call: {
          call_id: "retell_call_123",
          metadata: {
            murph_phone_call_id: "hpc_123",
          },
          transcript: "The office asked for a callback number.",
        },
        name: "ask_murph",
      },
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "Use this approved call-brief fact when relevant: callback number: +12125550111",
      directive: "continue",
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
