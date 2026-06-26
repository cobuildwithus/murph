import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: {
    linqFirstContactAdmissionMode: "enforce" as "enforce" | "off",
    linqFirstContactAdmissionModel: "gpt-5.4-nano",
    linqFirstContactAdmissionOpenAiApiKey: "test-openai-key" as string | null,
  },
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.environment,
}));

import {
  classifyHostedLinqFirstContactAdmission,
  claimHostedLinqFirstContactAdmissionBudget,
  readHostedLinqFirstContactAdmissionMode,
  recordHostedLinqFirstContactAdmissionDecision,
  type HostedLinqFirstContactAdmissionRequest,
} from "@/src/lib/hosted-onboarding/linq-first-contact-admission";

const BASE_REQUEST: HostedLinqFirstContactAdmissionRequest = {
  eventId: "evt_123",
  participantContactKind: "phone",
  participantContactLookupKey: "blind:v1:test-contact",
  partTypes: ["text"],
  service: "imessage",
  text: "hi",
};

describe("Linq first-contact admission", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.environment.linqFirstContactAdmissionMode = "enforce";
    mocks.environment.linqFirstContactAdmissionModel = "gpt-5.4-nano";
    mocks.environment.linqFirstContactAdmissionOpenAiApiKey = "test-openai-key";
  });

  it("reads the configured admission mode", () => {
    mocks.environment.linqFirstContactAdmissionMode = "off";

    expect(readHostedLinqFirstContactAdmissionMode()).toBe("off");
  });

  it("deterministically blocks textless first contacts without calling OpenAI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: {
        ...BASE_REQUEST,
        text: null,
      },
    })).resolves.toMatchObject({
      category: "unsupported_content",
      kind: "block",
      source: "deterministic",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a typed 503 when enforcement has no API key", async () => {
    mocks.environment.linqFirstContactAdmissionOpenAiApiKey = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      httpStatus: 503,
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows confident Murph-intent structured responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [
        {
          content: [
            {
              text: JSON.stringify({
                category: "join_intent",
                confidence: 0.91,
                decision: "allow",
              }),
              type: "output_text",
            },
          ],
          type: "message",
        },
      ],
      status: "completed",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      category: "join_intent",
      confidence: 0.91,
      kind: "allow",
      source: "model",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "gpt-5.4-nano",
      store: false,
      text: {
        format: {
          type: "json_schema",
        },
      },
    });
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content;
    expect(prompt).toContain("Goal: decide whether");
    expect(prompt).toContain("If the text mentions Murph at all, return allow");
    expect(prompt).toContain("Block only obvious marketing");
  });

  it("blocks low-confidence or non-allow categories from structured responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        category: "benign_greeting",
        confidence: 0.4,
        decision: "allow",
      }),
      status: "completed",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      category: "uncertain",
      confidence: 0.4,
      kind: "block",
      source: "model",
    });
  });

  it("throws a retryable 503 when classifier confidence is outside the schema bounds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        category: "join_intent",
        confidence: 7,
        decision: "allow",
      }),
      status: "completed",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("terminally blocks OpenAI refusal responses without retrying the webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [
        {
          content: [
            {
              refusal: "Cannot classify this content.",
              type: "refusal",
            },
          ],
          type: "message",
        },
      ],
      status: "completed",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      category: "unsupported_content",
      confidence: 1,
      kind: "block",
      source: "model",
    });
  });

  it("terminally blocks OpenAI content-filter incomplete responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      incomplete_details: {
        reason: "content_filter",
      },
      status: "incomplete",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      category: "unsupported_content",
      confidence: 1,
      kind: "block",
      source: "model",
    });
  });

  it("throws a typed 503 for non-completed OpenAI responses before parsing output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      incomplete_details: {
        reason: "max_output_tokens",
      },
      output: [
        {
          content: [
            {
              text: JSON.stringify({
                category: "join_intent",
                confidence: 0.9,
                decision: "allow",
              }),
              type: "output_text",
            },
          ],
          type: "message",
        },
      ],
      status: "incomplete",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("throws a retryable 503 when the timeout fires while reading the response body", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            signal.addEventListener("abort", () => {
              controller.error(signal.reason ?? new DOMException("Aborted", "AbortError"));
            }, { once: true });
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const classification = classifyHostedLinqFirstContactAdmission({
        request: BASE_REQUEST,
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(classification).rejects.toMatchObject({
        code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
        httpStatus: 503,
        retryable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws a typed 503 on non-success or malformed classifier responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "rate_limit_exceeded",
        message: "Rate limit reached for this request.",
        type: "rate_limit_error",
      },
    }), {
      headers: {
        "x-request-id": "req_123",
      },
      status: 429,
    })));

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        providerErrorCode: "rate_limit_exceeded",
        providerErrorMessage: "Rate limit reached for this request.",
        providerErrorType: "rate_limit_error",
        providerRequestIdPresent: true,
        statusCode: 429,
        type: "http",
      },
      httpStatus: 503,
      retryable: true,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      output_text: "not json",
      status: "completed",
    }), { status: 200 })));

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("admits first contacts when OpenAI reports exhausted credits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "insufficient_quota",
        message: "You exceeded your current quota, please check your plan and billing details.",
        type: "insufficient_quota",
      },
    }), {
      headers: {
        "x-request-id": "req_credits",
      },
      status: 429,
    })));

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      category: "benign_greeting",
      confidence: 1,
      kind: "allow",
      source: "deterministic",
    });
  });

  it("does not spend another first-contact admission budget attempt for the same event replay", async () => {
    const prisma = {
      hostedLinqFirstContactAdmissionBudget: {
        findUnique: vi.fn().mockResolvedValueOnce({
          attemptCount: 3,
          lastEventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_REQUEST.participantContactKind,
          participantContactLookupKey: BASE_REQUEST.participantContactLookupKey,
        }),
        upsert: vi.fn(),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContactKind: BASE_REQUEST.participantContactKind,
      participantContactLookupKey: BASE_REQUEST.participantContactLookupKey,
      prisma,
    })).resolves.toEqual({
      attemptCount: 3,
      kind: "claimed",
    });
    expect(prisma.hostedLinqFirstContactAdmissionBudget.upsert).not.toHaveBeenCalled();
  });

  it("returns the stored decision when a concurrent insert already won the event", async () => {
    const uniqueConflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
    const prisma = {
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn().mockRejectedValueOnce(uniqueConflict),
        findUnique: vi.fn().mockResolvedValueOnce({
          category: "wrong_number_or_personal_logistics",
          confidence: 0.99,
          decision: "block",
          eventId: BASE_REQUEST.eventId,
          source: "model",
        }),
      },
    };

    await expect(recordHostedLinqFirstContactAdmissionDecision({
      decision: {
        category: "join_intent",
        confidence: 0.9,
        kind: "allow",
        source: "model",
      },
      eventId: BASE_REQUEST.eventId,
      prisma,
    })).resolves.toMatchObject({
      category: "wrong_number_or_personal_logistics",
      confidence: 0.99,
      kind: "block",
      source: "model",
    });
  });
});
