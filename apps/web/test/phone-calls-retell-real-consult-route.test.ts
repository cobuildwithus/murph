import { createHmac } from "node:crypto";

import type { HostedPhoneCall } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";

import {
  encryptHostedPhoneCallBrief,
} from "@/src/lib/phone-calls/crypto";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedPhoneCall: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  }),
}));

type AskMurphRouteModule =
  typeof import("../app/api/retell/functions/ask-murph/route");

let askMurphRoute: AskMurphRouteModule;
let validBriefEncrypted: string;

const VALID_BRIEF: HostedPhoneCallBrief = {
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
};

describe("Retell ask_murph route with real consultation", () => {
  beforeAll(async () => {
    validBriefEncrypted = await encryptHostedPhoneCallBrief({
      callId: "hpc_123",
      memberId: "member_123",
      value: VALID_BRIEF,
    });
    askMurphRoute = await import("../app/api/retell/functions/ask-murph/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RETELL_API_KEY", "retell-api-key");
    mocks.findUnique.mockResolvedValue(buildHostedPhoneCall());
    mocks.updateMany.mockResolvedValue({ count: 0 });
  });

  it("can continue when the answer is already in the approved call brief", async () => {
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        question: "They asked for the callback phone number. What should I say?",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "Use this approved call-brief fact when relevant: callback number: +12125550111",
      directive: "continue",
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        id: "hpc_123",
      },
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("accepts a missing storage field only for an already-bound provider call", async () => {
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        omitStorageMode: true,
        question: "They asked for the callback phone number. What should I say?",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(200);
    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("claims the Retell provider call id when the start path lost its post-start write", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(buildHostedPhoneCall({
        providerCallId: null,
        status: "starting",
      }))
      .mockResolvedValueOnce(buildHostedPhoneCall({
        providerCallId: "retell_call_123",
        status: "calling",
      }));
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        question: "They asked for the callback phone number. What should I say?",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "Use this approved call-brief fact when relevant: callback number: +12125550111",
      directive: "continue",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      data: {
        providerCallId: "retell_call_123",
        status: "calling",
      },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: "hpc_123",
        provider: "retell",
        providerCallId: null,
        status: {
          in: ["starting", "calling"],
        },
      },
    });
  });

  it("does not claim an unbound call when the storage field is missing", async () => {
    mocks.findUnique.mockResolvedValue(buildHostedPhoneCall({
      providerCallId: null,
      status: "starting",
    }));

    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        omitStorageMode: true,
        question: "They asked for the callback phone number. What should I say?",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(409);
    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unsafe-storage callbacks before reading or decrypting the call brief", async () => {
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        question: "They asked for the callback phone number. What should I say?",
        storageMode: "everything",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "RETELL_STORAGE_MODE_MISMATCH",
      },
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects Retell function callbacks whose provider call id does not match the stored call", async () => {
    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        callId: "retell_call_other",
        question: "They asked for the callback phone number. What should I say?",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_PHONE_CALL_CALLBACK_NOT_ACTIVE",
      },
    });
  });

  it("rejects Retell function callbacks for terminal stored calls", async () => {
    mocks.findUnique.mockResolvedValue(buildHostedPhoneCall({
      status: "completed",
    }));

    const response = await askMurphRoute.POST(signedRetellRequest({
      payload: buildAskMurphPayload({
        question: "They asked for the callback phone number. What should I say?",
      }),
      url: "https://join.example.test/api/retell/functions/ask-murph",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_PHONE_CALL_CALLBACK_NOT_ACTIVE",
      },
    });
  });
});

function buildAskMurphPayload(input: {
  callId?: string;
  omitStorageMode?: boolean;
  question: string;
  storageMode?: string | null;
}): Record<string, unknown> {
  return {
    args: {
      question: input.question,
    },
    call: {
      call_id: input.callId ?? "retell_call_123",
      ...(!input.omitStorageMode
        ? { data_storage_setting: input.storageMode ?? "basic_attributes_only" }
        : {}),
      metadata: {
        murph_phone_call_id: "hpc_123",
      },
      transcript: "The office asked for a callback number.",
    },
    name: "ask_murph",
  };
}

function buildHostedPhoneCall(overrides: Partial<HostedPhoneCall> = {}): HostedPhoneCall {
  const now = new Date("2026-06-25T00:00:00.000Z");
  return {
    analyzedAt: null,
    briefEncrypted: validBriefEncrypted,
    briefJson: null,
    createdAt: now,
    endedAt: null,
    id: "hpc_123",
    memberId: "member_123",
    originSessionId: "session_phone_call",
    provider: "retell",
    providerCallId: "retell_call_123",
    requestKey: "phone_call_request_1",
    resultEncrypted: null,
    resultJson: null,
    resultNotificationChannel: null,
    status: "calling",
    updatedAt: now,
    ...overrides,
  };
}

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
