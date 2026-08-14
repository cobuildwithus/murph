import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: {
    linqFirstContactAdmissionMode: "enforce" as "enforce" | "off",
    linqFirstContactAdmissionModel: "gpt-5.4-nano",
    linqFirstContactAdmissionOpenAiApiKey: "test-openai-key" as string | null,
  },
  participantContact: {
    readCandidates: ["blind:v1:test-contact"] as string[],
    currentLookupKey: "blind:v1:test-contact" as string | null,
  },
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.environment,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-participant-contact", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-participant-contact")>();
  return {
    ...actual,
    createHostedLinqParticipantContactLookupKey: () => mocks.participantContact.currentLookupKey,
    createHostedLinqParticipantContactLookupKeyReadCandidates: () =>
      mocks.participantContact.readCandidates,
  };
});

import {
  classifyHostedLinqFirstContactAdmission,
  claimHostedLinqFirstContactAdmissionBudget,
  readHostedLinqFirstContactAdmissionMode,
  recordHostedLinqFirstContactAdmissionDecision,
  tryHostedLinqFirstContactAdmissionDeterministicDecision,
  type HostedLinqFirstContactAdmissionRequest,
} from "@/src/lib/hosted-onboarding/linq-first-contact-admission";

const BASE_REQUEST: HostedLinqFirstContactAdmissionRequest = {
  eventId: "evt_123",
  participantContactKind: "phone",
  partTypes: ["text"],
  service: "imessage",
  text: "hi",
};

const BASE_PARTICIPANT_CONTACT = {
  kind: "phone" as const,
  lookupKey: "blind:v1:test-contact",
  value: "+15551234567",
};

function resetParticipantContactMocks() {
  mocks.participantContact.readCandidates = ["blind:v1:test-contact"];
  mocks.participantContact.currentLookupKey = "blind:v1:test-contact";
}

describe("Linq first-contact admission", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.environment.linqFirstContactAdmissionMode = "enforce";
    mocks.environment.linqFirstContactAdmissionModel = "gpt-5.4-nano";
    mocks.environment.linqFirstContactAdmissionOpenAiApiKey = "test-openai-key";
    resetParticipantContactMocks();
  });

  it("reads the configured admission mode", () => {
    mocks.environment.linqFirstContactAdmissionMode = "off";

    expect(readHostedLinqFirstContactAdmissionMode()).toBe("off");
  });

  it("flags textless first-contact requests as deterministically blockable so callers can skip the budget claim", () => {
    expect(
      tryHostedLinqFirstContactAdmissionDeterministicDecision({
        ...BASE_REQUEST,
        text: null,
      }),
    ).toMatchObject({
      kind: "block",
      source: "deterministic",
    });
  });

  it("returns null from the deterministic check when text is present so the model classifier still runs", () => {
    expect(
      tryHostedLinqFirstContactAdmissionDeterministicDecision({
        ...BASE_REQUEST,
        text: "Murph can you help me with allergies?",
      }),
    ).toBeNull();
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
      confidence: 0.91,
      kind: "allow",
      source: "model",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const requestInit = fetchMock.mock.calls[0][1];
    const requestHeaders = new Headers(requestInit.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer test-openai-key");
    expect(requestHeaders.get("content-type")).toBe("application/json");
    expect(requestHeaders.get("x-stainless-retry-count")).toBe("0");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: "gpt-5.4-nano",
      reasoning: { effort: "medium" },
      service_tier: "priority",
      store: false,
      text: {
        format: {
          strict: true,
          type: "json_schema",
        },
      },
    });
    const prompt = JSON.parse(String(requestInit.body)).input[0].content;
    expect(prompt).toContain("Goal: decide whether");
    expect(prompt).toContain("Default to allow");
    expect(prompt).toContain("Only block if the message is clearly automated marketing");
  });

  it("blocks when the model returns decision=block regardless of confidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        confidence: 0.4,
        decision: "block",
      }),
      status: "completed",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      confidence: 0.4,
      kind: "block",
      source: "model",
    });
  });

  it("allows when the model returns decision=allow regardless of low confidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        confidence: 0,
        decision: "allow",
      }),
      status: "completed",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).resolves.toMatchObject({
      confidence: 0,
      kind: "allow",
      source: "model",
    });
  });

  it("throws a retryable 503 when classifier confidence is outside the schema bounds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
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

  it("maps an injected fetch rejection to one retryable typed 503 attempt", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyHostedLinqFirstContactAdmission({
      request: BASE_REQUEST,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "transport",
      },
      httpStatus: 503,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws a typed 503 on non-success or malformed classifier responses", async () => {
    const rateLimitFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
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
    }));
    vi.stubGlobal("fetch", rateLimitFetch);

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
    expect(rateLimitFetch).toHaveBeenCalledOnce();

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
      confidence: 1,
      kind: "allow",
      source: "deterministic",
    });
  });

  it("does not spend another first-contact admission budget attempt for the same event replay", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(3),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce({
          eventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
          participantContactLookupKey: BASE_PARTICIPANT_CONTACT.lookupKey,
        }),
        // This event already holds one of the contact's three attempts.
        findMany: vi.fn().mockResolvedValue([
          { eventId: BASE_REQUEST.eventId },
          { eventId: "evt_earlier_attempt_1" },
          { eventId: "evt_earlier_attempt_2" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 3,
      kind: "claimed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not spend another budget attempt when a previously counted event is replayed after a different event has been counted", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(2),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce({
          eventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
          participantContactLookupKey: BASE_PARTICIPANT_CONTACT.lookupKey,
        }),
        // This event's own attempt row plus the one counted after it.
        findMany: vi.fn().mockResolvedValue([
          { eventId: BASE_REQUEST.eventId },
          { eventId: "evt_later_attempt" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 2,
      kind: "claimed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("reports the contact budget as exhausted without spending another attempt once the cap has been reached", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(4),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_attempt_1" },
          { eventId: "evt_attempt_2" },
          { eventId: "evt_attempt_3" },
          { eventId: "evt_attempt_4" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        // Four attempts that never recorded a terminal allow: the cap stands.
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 4,
      kind: "exhausted",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("keeps the cap when every counted attempt for the contact recorded a block", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(4),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_blocked_1" },
          { eventId: "evt_blocked_2" },
          { eventId: "evt_blocked_3" },
          { eventId: "evt_blocked_4" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([
          {
            confidence: 0.96,
            decision: "block",
            eventId: "evt_blocked_1",
            source: "model",
          },
          {
            confidence: 0.98,
            decision: "block",
            eventId: "evt_blocked_2",
            source: "model",
          },
        ]),
      },
    };

    // Only a terminal allow escapes the cap. Recorded blocks are still spent
    // attempts, so the contact stays exhausted.
    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 4,
      kind: "exhausted",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("reuses a recorded allow from an earlier event instead of spending another attempt", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(2),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_earlier_allow" },
          { eventId: "evt_earlier_unresolved" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([{
          confidence: 0.87,
          decision: "allow",
          eventId: "evt_earlier_allow",
          source: "model",
        }]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      decision: {
        confidence: 0.87,
        kind: "allow",
        source: "model",
      },
      kind: "already_allowed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("reuses a recorded allow that landed after the contact reached the attempt cap", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(4),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_race_1" },
          { eventId: "evt_race_2" },
          { eventId: "evt_race_3" },
          { eventId: "evt_race_4" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        // Concurrent events claimed the last slots before the winning
        // classifier call finished recording its allow.
        findMany: vi.fn().mockResolvedValue([{
          confidence: 1,
          decision: "allow",
          eventId: "evt_race_3",
          source: "model",
        }]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      decision: {
        confidence: 1,
        kind: "allow",
        source: "model",
      },
      kind: "already_allowed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("does not reuse a classifier-unavailable fail-open allow", async () => {
    // A deterministic allow means nobody could check this sender, not that the
    // sender is welcome. Reusing it would let one classifier outage admit a
    // contact permanently, so the contact's four real attempts still bind.
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(5),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_unavailable_1" },
          { eventId: "evt_attempt_1" },
          { eventId: "evt_attempt_2" },
          { eventId: "evt_attempt_3" },
          { eventId: "evt_attempt_4" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([{
          confidence: 1,
          decision: "allow",
          eventId: "evt_unavailable_1",
          source: "deterministic",
        }]),
      },
    };

    // Whether the fail-open row is charged is a separate question; what this
    // asserts is that it is never handed back as an admission.
    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toMatchObject({
      kind: "exhausted",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("does not charge classifier-unavailable attempts against the contact's cap", async () => {
    // Four events during one OpenAI outage. None of them reached the
    // classifier, so none of them spent a classification: charging them would
    // leave the contact with no reusable evidence and no attempts left, silent
    // on every path until someone edited the database.
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(4),
        create: vi.fn().mockResolvedValueOnce({
          eventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
          participantContactLookupKey: BASE_PARTICIPANT_CONTACT.lookupKey,
        }),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_outage_1" },
          { eventId: "evt_outage_2" },
          { eventId: "evt_outage_3" },
          { eventId: "evt_outage_4" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue(
          [1, 2, 3, 4].map((index) => ({
            confidence: 1,
            decision: "allow",
            eventId: `evt_outage_${index}`,
            source: "deterministic",
          })),
        ),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 1,
      kind: "claimed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).toHaveBeenCalledTimes(1);
  });

  it("reads the recorded allow under every contact key version that still resolves", async () => {
    mocks.participantContact.readCandidates = ["blind:v2:test-contact", "blind:v1:test-contact"];
    mocks.participantContact.currentLookupKey = "blind:v2:test-contact";

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(1),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([{ eventId: "evt_rotated_allow" }]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([{
          confidence: 0.91,
          decision: "allow",
          eventId: "evt_rotated_allow",
          source: "model",
        }]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toMatchObject({
      kind: "already_allowed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.findMany).toHaveBeenCalledWith({
      select: {
        eventId: true,
      },
      where: {
        participantContactLookupKey: {
          in: ["blind:v2:test-contact", "blind:v1:test-contact"],
        },
      },
    });
  });

  it("counts a fresh first-contact event as a single new attempt", async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(1),
        create: vi.fn().mockResolvedValueOnce({
          eventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
          participantContactLookupKey: BASE_PARTICIPANT_CONTACT.lookupKey,
        }),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([{ eventId: "evt_earlier_attempt" }]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 2,
      kind: "claimed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).toHaveBeenCalledTimes(1);
  });

  it("finds an earlier key-version row after contact privacy rotation so a replay does not spend another attempt", async () => {
    mocks.participantContact.readCandidates = ["blind:v2:test-contact", "blind:v1:test-contact"];
    mocks.participantContact.currentLookupKey = "blind:v2:test-contact";

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(2),
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValueOnce({
          eventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
          participantContactLookupKey: "blind:v1:test-contact",
        }),
        findMany: vi.fn().mockResolvedValue([
          { eventId: BASE_REQUEST.eventId },
          { eventId: "evt_rotated_earlier_attempt" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 2,
      kind: "claimed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.findFirst).toHaveBeenCalledWith({
      where: {
        eventId: BASE_REQUEST.eventId,
        participantContactLookupKey: {
          in: ["blind:v2:test-contact", "blind:v1:test-contact"],
        },
      },
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).not.toHaveBeenCalled();
  });

  it("inserts the new attempt under the current contact key version when older versions are still readable", async () => {
    mocks.participantContact.readCandidates = ["blind:v2:test-contact", "blind:v1:test-contact"];
    mocks.participantContact.currentLookupKey = "blind:v2:test-contact";

    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn().mockResolvedValueOnce(2),
        create: vi.fn().mockResolvedValueOnce({
          eventId: BASE_REQUEST.eventId,
          participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
          participantContactLookupKey: "blind:v2:test-contact",
        }),
        findFirst: vi.fn().mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([
          { eventId: "evt_rotated_attempt_1" },
          { eventId: "evt_rotated_attempt_2" },
        ]),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    })).resolves.toEqual({
      attemptCount: 3,
      kind: "claimed",
    });
    expect(tx.hostedLinqFirstContactAdmissionBudget.create).toHaveBeenCalledWith({
      data: {
        eventId: BASE_REQUEST.eventId,
        participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
        participantContactLookupKey: "blind:v2:test-contact",
      },
    });
  });

  it("runs the per-contact advisory lock under a version-independent lock value before any cap read or budget write", async () => {
    mocks.participantContact.readCandidates = ["blind:v2:test-contact", "blind:v1:test-contact"];
    mocks.participantContact.currentLookupKey = "blind:v2:test-contact";

    const callOrder: string[] = [];
    let lockSqlSegments: readonly string[] = [];
    let lockValues: readonly unknown[] = [];
    const tx = {
      $executeRaw: vi.fn(async (template: TemplateStringsArray, ...values: readonly unknown[]) => {
        callOrder.push("$executeRaw");
        lockSqlSegments = [...template];
        lockValues = values;
        return 0;
      }),
      hostedLinqFirstContactAdmissionBudget: {
        count: vi.fn(async () => {
          callOrder.push("count");
          return 0;
        }),
        create: vi.fn(async () => {
          callOrder.push("create");
          return {
            eventId: BASE_REQUEST.eventId,
            participantContactKind: BASE_PARTICIPANT_CONTACT.kind,
            participantContactLookupKey: "blind:v2:test-contact",
          };
        }),
        findFirst: vi.fn(async () => {
          callOrder.push("findFirst");
          return null;
        }),
        findMany: vi.fn(async () => {
          callOrder.push("findMany");
          return [];
        }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        findMany: vi.fn(async () => []),
      },
    };

    await claimHostedLinqFirstContactAdmissionBudget({
      eventId: BASE_REQUEST.eventId,
      participantContact: BASE_PARTICIPANT_CONTACT,
      tx,
    });

    expect(callOrder[0]).toBe("$executeRaw");
    expect(lockSqlSegments.join("")).toContain("pg_advisory_xact_lock");
    expect(lockValues).toContain(`${BASE_PARTICIPANT_CONTACT.kind}:${BASE_PARTICIPANT_CONTACT.value}`);
    // The version-independent value must not embed any key-versioned lookup key.
    expect(lockValues.some((value) => typeof value === "string" && value.includes("blind:v"))).toBe(false);
  });

  it("records block decisions without storing rejected-message text", async () => {
    const createMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const prisma = {
      hostedLinqFirstContactAdmissionDecision: {
        createMany,
        findUnique: vi.fn().mockResolvedValueOnce({
          confidence: 0.95,
          decision: "block",
          eventId: "evt_rejected_message",
          source: "model",
        }),
      },
    };

    await expect(recordHostedLinqFirstContactAdmissionDecision({
      decision: {
        confidence: 0.95,
        kind: "block",
        source: "model",
      },
      eventId: "evt_rejected_message",
      prisma,
    })).resolves.toMatchObject({
      confidence: 0.95,
      kind: "block",
      source: "model",
    });

    expect(createMany).toHaveBeenCalledWith({
      data: {
        confidence: 0.95,
        decision: "block",
        eventId: "evt_rejected_message",
        source: "model",
      },
      skipDuplicates: true,
    });
  });

  it("returns the stored decision when a concurrent insert already won the event", async () => {
    const prisma = {
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
        findUnique: vi.fn().mockResolvedValueOnce({
          confidence: 0.99,
          decision: "block",
          eventId: BASE_REQUEST.eventId,
          source: "model",
        }),
      },
    };

    await expect(recordHostedLinqFirstContactAdmissionDecision({
      decision: {
        confidence: 0.9,
        kind: "allow",
        source: "model",
      },
      eventId: BASE_REQUEST.eventId,
      prisma,
    })).resolves.toMatchObject({
      confidence: 0.99,
      kind: "block",
      source: "model",
    });
    expect(prisma.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 0.9,
        decision: "allow",
        eventId: BASE_REQUEST.eventId,
        source: "model",
      },
      skipDuplicates: true,
    });
  });

  it("records block decisions without storing rejected-message text", async () => {
    const prisma = {
      hostedLinqFirstContactAdmissionDecision: {
        createMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
        findUnique: vi.fn().mockResolvedValueOnce({
          confidence: 0.94,
          decision: "block",
          eventId: BASE_REQUEST.eventId,
          source: "model",
        }),
      },
    };

    await expect(recordHostedLinqFirstContactAdmissionDecision({
      decision: {
        confidence: 0.94,
        kind: "block",
        source: "model",
      },
      eventId: BASE_REQUEST.eventId,
      prisma,
    })).resolves.toMatchObject({
      confidence: 0.94,
      kind: "block",
      source: "model",
    });

    expect(prisma.hostedLinqFirstContactAdmissionDecision.createMany).toHaveBeenCalledWith({
      data: {
        confidence: 0.94,
        decision: "block",
        eventId: BASE_REQUEST.eventId,
        source: "model",
      },
      skipDuplicates: true,
    });
  });
});
