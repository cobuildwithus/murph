import { readFile } from "node:fs/promises";
import {
  MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS,
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_DEFAULT_RUNNER_IDLE_TTL_MS } from "@murphai/hosted-execution/contracts";

const mocks = vi.hoisted(() => ({
  messages: [] as Array<[Record<string, unknown>, Record<string, unknown>]>,
  now: [] as number[],
  sendResults: [] as boolean[],
  spaceSend: vi.fn(),
  stop: vi.fn(),
  delay: vi.fn(),
}));

vi.mock("node:timers/promises", () => ({ setTimeout: mocks.delay }));

vi.mock("node:perf_hooks", () => ({
  performance: {
    now: () => {
      const value = mocks.now.shift();
      if (value === undefined) {
        throw new Error("Missing test clock value.");
      }
      return value;
    },
  },
}));

vi.mock("@spectrum-ts/core", () => ({
  Spectrum: vi.fn(async () => ({
    messages: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const value = mocks.messages.shift();
          return value ? { done: false as const, value } : { done: true as const };
        },
      }),
    },
    stop: mocks.stop,
  })),
}));

vi.mock("@spectrum-ts/imessage", () => ({
  imessage: Object.assign(
    () => ({
      space: {
        create: vi.fn(async () => ({
          id: "space_canary",
          send: mocks.spaceSend,
        })),
      },
      user: vi.fn(async () => ({ id: "target_canary" })),
    }),
    { config: vi.fn(() => ({ provider: "imessage" })) },
  ),
}));

import {
  CANARY_OUTCOME_WAIT_MS,
  CANARY_REPLY_WAIT_MS,
  CANARY_RESET_TIMEOUT_MS,
  runLinqProductionCanary,
} from "@/scripts/run-production-conversation-canary";

const TEST_ENV = {
  HOSTED_WEB_PRODUCTION_BASE_URL: "https://example.test/",
  MURPH_LINQ_PRODUCTION_CANARY_RESET_SECRET: "test-reset-secret",
  MURPH_LINQ_PRODUCTION_CANARY_TARGET_PHONE_NUMBER: "+15555550123",
  NODE_ENV: "test" as const,
  SPECTRUM_PROJECT_ID: "test-project",
  SPECTRUM_PROJECT_SECRET: "test-project-secret",
};

describe("production conversation canary runner", () => {
  it("fits every bounded observation and reply inside the workflow deadline", async () => {
    const workflow = await readFile(new URL("../../../.github/workflows/linq-production-canary.yml", import.meta.url), "utf8");
    const timeout = workflow.match(/timeout-minutes: (\d+)/u);
    expect(timeout).not.toBeNull();
    const journeyBudget = CANARY_RESET_TIMEOUT_MS
      + 3 * CANARY_OUTCOME_WAIT_MS + 5 * CANARY_REPLY_WAIT_MS;
    expect(Number(timeout?.[1]) * 60_000).toBeGreaterThanOrEqual(journeyBudget + 120_000);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    mocks.messages = [];
    mocks.now = [];
    mocks.sendResults = [];
    mocks.spaceSend.mockClear();
    mocks.spaceSend.mockImplementation(async () => mocks.sendResults.shift() ?? false);
    mocks.stop.mockClear();
    mocks.stop.mockResolvedValue(undefined);
    mocks.delay.mockReset();
    mocks.delay.mockResolvedValue(undefined);
    let outcomeReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(JSON.stringify(url.pathname.endsWith("/outcome") ? {
      ok: true,
      outcome: { ready: true, totalGoalCount: outcomeReads < 2 ? 0 : 1, matchingGoalCount: outcomeReads < 2 ? 0 : 1, matchingGoalIdCount: outcomeReads++ < 2 ? 0 : 1 },
    } : {
      ok: true,
      reset: {
        accountDeleted: true,
        admissionBudgetCount: 1,
        admissionDecisionCount: 1,
        deliveryClaimCount: 1,
      },
    }), { status: 200 })));
  });

  it("separates sender acknowledgement time from total reply latency", async () => {
    mocks.now = [0, 5_000, 6_000];
    mocks.sendResults = [true];
    mocks.messages = [inboundMessage({ text: "Unexpected response." })];
    const report = vi.fn();
    await expect(runLinqProductionCanary(TEST_ENV, report)).rejects.toMatchObject({ name: expect.stringContaining("reply-semantics-invalid") });
    expect(report).toHaveBeenCalledWith({
      latencyMs: 6_000, senderSendMs: 5_000, stage: "welcome", turn: 1,
    });
  });

  it("runs a natural proposal and acceptance with canonical checks outside the conversation", async () => {
    vi.mocked(Date.now)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(5_000);
    mocks.now = [0, 0, 15_000, 15_000, 15_000, 30_000, 30_000, 30_000, 45_000, 60_000, 60_000, 75_000, 90_000, 90_000, 105_000];
    mocks.sendResults = [true, true, true, true, true];
    mocks.messages = [
      inboundMessage({ text: "An older reply.", timestampMs: 999 }),
      inboundMessage({ spaceId: "other_space", text: "unrelated" }),
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal, timestampMs: 2_000 }),
      inboundMessage({ text: "A retained earlier reply.", timestampMs: 2_000 }),
      inboundMessage({ text: "What would you most like to improve about your health?", timestampMs: 3_000 }),
      inboundMessage({ text: "How about twenty minutes before lunch on weekdays for a week?", timestampMs: 4_000 }),
      inboundMessage({ text: "Your walking plan is set for tomorrow.", timestampMs: 5_000 }),
    ];

    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toEqual({
      canonicalOutcome: { baselineGoalCount: 0, savedGoalCount: 1, proposalGoalCount: 0 },
      reset: {
        accountDeleted: true,
        admissionBudgetCount: 1,
        admissionDecisionCount: 1,
        deliveryClaimCount: 1,
      },
      turns: [
        { latencyMs: 15_000, senderSendMs: 0, stage: "welcome", turn: 1 },
        { latencyMs: 15_000, senderSendMs: 0, stage: "identity-question", turn: 2 },
        { latencyMs: 15_000, senderSendMs: 0, stage: "runtime-identity", turn: 3 },
        { latencyMs: 15_000, senderSendMs: 0, stage: "goal-proposal", turn: 4 },
        { latencyMs: 15_000, senderSendMs: 0, stage: "accept-goal", turn: 5 },
      ],
    });
    expect(mocks.messages).toEqual([]);
    expect(mocks.spaceSend.mock.calls.slice(0, 3).map(([text]) => text)).toEqual([
      "Hey Murph let's get started with my health!",
      "Yes, ready.",
      "My name is Robin. I am 32 and a woman.",
    ]);
    expect(mocks.spaceSend.mock.calls[3]?.[0]).toContain("Could you help me set a walking goal");
    expect(mocks.spaceSend.mock.calls[4]?.[0]).toBe("Yes, that sounds good. Let’s start on the next weekday.");
    for (const [prompt] of mocks.spaceSend.mock.calls) {
      expect(prompt).not.toMatch(/exact title|save it now|tell me when|read my saved goals/iu);
    }
    expect(vi.mocked(fetch).mock.calls.slice(1).map(([url, options]) => ({
      path: new URL(String(url)).pathname,
      method: options?.method,
      headers: options?.headers,
    }))).toEqual(Array.from({ length: 3 }, () => ({
      path: "/api/internal/hosted-onboarding/linq/production-canary/outcome",
      method: "GET",
      headers: { authorization: "Bearer test-reset-secret" },
    })));
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("rejects an unconfirmed provider send and still stops", async () => {
    mocks.now = [0];
    mocks.sendResults = [false];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
    ];

    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: "send-unconfirmed",
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("reports an exact-boundary send-to-reply failure and still stops", async () => {
    mocks.now = [0, 0, 20_000];
    mocks.sendResults = [true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
    ];

    const report = vi.fn();
    await expect(runLinqProductionCanary(TEST_ENV, report)).rejects.toHaveProperty(
      "name",
      "reply-latency-budget-exceeded; turn=1; metric=send_to_reply; elapsed_ms=20000; budget_ms=20000",
    );
    expect(report).toHaveBeenCalledWith({ latencyMs: 20_000, senderSendMs: 0, stage: "welcome", turn: 1 });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("reports an inter-reply-gap-only failure and still stops", async () => {
    mocks.now = [0, 0, 10_000, 15_000, 15_000, 30_000];
    mocks.sendResults = [true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: "A later reply." }),
    ];

    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toHaveProperty(
      "name",
      "reply-latency-budget-exceeded; turn=2; metric=inter_reply_gap; elapsed_ms=20000; budget_ms=20000",
    );
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("reports a slow first runtime identity reply without truncating its latency", async () => {
    mocks.now = [0, 0, 1_000, 1_000, 1_000, 2_000, 2_000, 2_000, 48_000];
    mocks.sendResults = [true, true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual }),
      inboundMessage({ text: "What would you most like to improve about your health?" }),
    ];
    const report = vi.fn();
    await expect(runLinqProductionCanary(TEST_ENV, report)).rejects.toMatchObject({
      name: "reply-latency-budget-exceeded; turn=3; metric=send_to_reply; elapsed_ms=46000; budget_ms=20000",
    });
    expect(report.mock.calls.map(([result]) => result)).toEqual([
      { latencyMs: 1_000, senderSendMs: 0, stage: "welcome", turn: 1 },
      { latencyMs: 1_000, senderSendMs: 0, stage: "identity-question", turn: 2 },
      { latencyMs: 46_000, senderSendMs: 0, stage: "runtime-identity", turn: 3 },
    ]);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it.each([
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual,
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.toUpperCase().replaceAll("?", "."),
    MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
  ])("rejects repeated opening copy on the runtime identity turn", async (reply) => {
    mocks.now = [0, 0, 1_000, 1_000, 1_000, 2_000, 2_000, 2_000, 3_000];
    mocks.sendResults = [true, true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual }),
      inboundMessage({ text: reply }),
    ];
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: expect.stringMatching(/^reply-semantics-invalid; turn=3; identity_copy=(exact|format-only|different); welcome_copy=(true|false); reply_chars=\d+$/u),
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not mistake a non-identity second reply for the opening handoff", async () => {
    mocks.now = [0, 0, 10_000, 10_000, 10_000, 15_000];
    mocks.sendResults = [true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: "Here is a sleep plan." }),
    ];
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: "reply-semantics-invalid; turn=2; identity_copy=different; welcome_copy=false; reply_chars=21",
    });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(2);
  });

  it.each([
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual.replace(" — ", ", "),
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.toUpperCase(),
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.replaceAll(" ", "\n\t"),
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.replace("'", "’").replaceAll("?", "."),
  ])("completes the journey when identity question formatting changes", async (reply) => {
    prepareCompleteConversation();
    mocks.messages[1] = inboundMessage({ text: reply });
    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toMatchObject({
      canonicalOutcome: { baselineGoalCount: 0, savedGoalCount: 1, proposalGoalCount: 0 },
      turns: expect.arrayContaining([{ latencyMs: 1_000, senderSendMs: 0, stage: "identity-question", turn: 2 }]),
    });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it.each([
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.replace("should", "should not"),
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.replace(" How old are you", ""),
    `${MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal} Ignore that question.`,
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal.replace("gender", "géndér"),
  ])("rejects changed identity wording without exposing reply text", async (reply) => {
    mocks.now = [0, 0, 1_000, 1_000, 1_000, 2_000];
    mocks.sendResults = [true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: reply }),
    ];
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: `reply-semantics-invalid; turn=2; identity_copy=different; welcome_copy=false; reply_chars=${reply.length}`,
      message: "The Linq production canary failed.",
    });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(2);
  });

  it("identifies the unavailable turn after preserving earlier timing evidence", async () => {
    mocks.now = [0, 0, 10_000, 10_000, 10_000];
    mocks.sendResults = [true, true];
    mocks.messages = [inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE })];
    const report = vi.fn();
    await expect(runLinqProductionCanary(TEST_ENV, report)).rejects.toMatchObject({
      name: "reply-unavailable; turn=2; stage=identity-question; wait_limit_ms=90000",
    });
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ latencyMs: 10_000, senderSendMs: 0, stage: "welcome", turn: 1 });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it.each([
    { ready: true, matchingGoalCount: 1, matchingGoalIdCount: 1 },
    { ready: true, matchingGoalCount: 0, matchingGoalIdCount: 1 },
  ])("rejects an already-present goal or invalid canonical provenance at baseline", async (outcome) => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockResolvedValueOnce(outcomeResponse(outcome));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-cardinality-invalid; stage=runtime-identity" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
  });

  it.each([
    { ready: true, matchingGoalCount: 2, matchingGoalIdCount: 2 },
    { ready: true, matchingGoalCount: 2, matchingGoalIdCount: 1 },
    { ready: true, matchingGoalCount: 1, matchingGoalIdCount: 0 },
    { ready: true, totalGoalCount: 2, matchingGoalCount: 1, matchingGoalIdCount: 1 },
    { ready: true, totalGoalCount: 1, matchingGoalCount: 0, matchingGoalIdCount: 0 },
  ])("rejects duplicate goals or noncanonical goal evidence after a claimed save", async (outcome) => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse(outcome));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-cardinality-invalid; stage=accept-goal" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("waits for a fresh publication before accepting the saved canonical goal", async () => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: false, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockImplementation(async () => outcomeResponse({ ready: true, matchingGoalCount: 1, matchingGoalIdCount: 1 }));
    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toHaveProperty("canonicalOutcome.savedGoalCount", 1);
    expect(mocks.delay).toHaveBeenCalledOnce();
  });

  it("observes each canonical stage after the production checkpoint quiet window", async () => {
    prepareCompleteConversation();
    const clock = mockCanaryObservationClock();
    let stage = 0;
    let stageStartedAt = 0;
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockImplementation(async () => {
      if (clock.elapsedMs() - stageStartedAt < HOSTED_EXECUTION_DEFAULT_RUNNER_IDLE_TTL_MS + 5_000) {
        return outcomeResponse({ ready: false, matchingGoalCount: 0, matchingGoalIdCount: 0 });
      }
      const count = stage++ < 2 ? 0 : 1;
      stageStartedAt = clock.elapsedMs();
      return outcomeResponse({ ready: true, matchingGoalCount: count, matchingGoalIdCount: count });
    });

    const result = await runLinqProductionCanary(TEST_ENV);
    expect(result.canonicalOutcome).toEqual({ baselineGoalCount: 0, savedGoalCount: 1, proposalGoalCount: 0 });
    expect(result.turns.map((turn) => turn.latencyMs)).toEqual([1_000, 1_000, 1_000, 1_000, 1_000]);
    expect(clock.elapsedMs()).toBe(3 * (HOSTED_EXECUTION_DEFAULT_RUNNER_IDLE_TTL_MS + 5_000));
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
  });

  it("still stops at the observation deadline when publication never becomes ready", async () => {
    prepareCompleteConversation();
    const clock = mockCanaryObservationClock();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockImplementation(async () =>
      outcomeResponse({ ready: false, matchingGoalCount: 0, matchingGoalIdCount: 0 }));

    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-not-ready; stage=runtime-identity" });
    expect(clock.elapsedMs()).toBe(HOSTED_EXECUTION_DEFAULT_RUNNER_IDLE_TTL_MS + 120_000);
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not accept a confirmation when the canonical goal never appears", async () => {
    prepareCompleteConversation();
    mockCanaryObservationClock();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockImplementation(async () => outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-not-ready; stage=accept-goal" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
  });

  it("rejects a goal created before the person accepts the proposal", async () => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 1, matchingGoalIdCount: 1 }));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-cardinality-invalid; stage=goal-proposal" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed outcome metadata without logging its content", async () => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, outcome: { ready: true, matchingGoalCount: "synthetic-private-content", matchingGoalIdCount: 0 },
    })));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: "outcome-response-invalid; stage=runtime-identity", message: "The Linq production canary failed.",
    });
  });

  it.each([401, 403, 404, 500])("fails explicitly for a non-retryable outcome status (%s)", async (status) => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockResolvedValueOnce(new Response(null, { status }));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: `outcome-read-failed; stage=runtime-identity; http_status=${status}` });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
  });

  it("retries an unavailable observer without repeating any message or reset", async () => {
    prepareCompleteConversation();
    const cancel = vi.fn();
    const unavailable = new Response(new ReadableStream({ cancel }), { status: 503 });
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockResolvedValueOnce(unavailable);

    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toHaveProperty("canonicalOutcome.savedGoalCount", 1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.delay).toHaveBeenCalledOnce();
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it.each(["headers", "body"])("retries a timed-out %s read within the original observation deadline", async (phase) => {
    prepareCompleteConversation();
    const clock = mockCanaryObservationClock();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockImplementationOnce(async (_url, options) => {
        const failAfterTimeout = async () => {
          clock.advance(10_000);
          options?.signal?.throwIfAborted();
          throw new Error("Expected the request deadline to expire.");
        };
        if (phase === "headers") return failAfterTimeout();
        const response = outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 });
        vi.spyOn(response, "json").mockImplementation(failAfterTimeout);
        return response;
      });

    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toHaveProperty("canonicalOutcome.proposalGoalCount", 0);
    expect(clock.elapsedMs()).toBe(11_000);
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
  });

  it.each(["unavailable", "timeout"])("fails at the original deadline when the observer stays %s", async (mode) => {
    prepareCompleteConversation();
    const clock = mockCanaryObservationClock();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockImplementation(async (_url, options) => {
        if (mode === "unavailable") return new Response(null, { status: 503 });
        clock.advance(Math.min(10_000, CANARY_OUTCOME_WAIT_MS - clock.elapsedMs()));
        options?.signal?.throwIfAborted();
        throw new Error("Expected the request deadline to expire.");
      });

    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-not-ready; stage=runtime-identity" });
    expect(clock.elapsedMs()).toBe(CANARY_OUTCOME_WAIT_MS);
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not accept evidence returned after the observation deadline", async () => {
    prepareCompleteConversation();
    const clock = mockCanaryObservationClock();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockImplementationOnce(async () => {
        clock.advance(CANARY_OUTCOME_WAIT_MS);
        return outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 });
      });
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-not-ready; stage=runtime-identity" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
  });

  it("keeps non-timeout transport failures content-free", async () => {
    prepareCompleteConversation();
    const privateError = new Error("synthetic-private-content");
    privateError.name = "synthetic-private-name";
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockRejectedValueOnce(privateError);
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: "outcome-read-failed; stage=runtime-identity", message: "The Linq production canary failed.",
    });
  });
});

function mockCanaryObservationClock(): { elapsedMs(): number; advance(durationMs: number): void } {
  let elapsedMs = 0;
  const deadlines: Array<{ at: number; controller: AbortController }> = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((durationMs) => {
    const controller = new AbortController();
    deadlines.push({ at: elapsedMs + durationMs, controller });
    return controller.signal;
  });
  const advance = (durationMs: number) => {
    elapsedMs += durationMs;
    for (const deadline of deadlines) {
      if (elapsedMs >= deadline.at) deadline.controller.abort(new DOMException("Synthetic deadline elapsed", "TimeoutError"));
    }
  };
  mocks.delay.mockImplementation(async (durationMs: number, _value: unknown, options: { signal: AbortSignal }) => {
    advance(durationMs);
    options.signal.throwIfAborted();
  });
  return { elapsedMs: () => elapsedMs, advance };
}

function prepareCompleteConversation(): void {
  mocks.now = [0, 0, 1_000, 1_000, 1_000, 2_000, 2_000, 2_000, 3_000, 3_000, 3_000, 4_000, 4_000, 4_000, 5_000];
  mocks.sendResults = [true, true, true, true, true];
  mocks.messages = [
    MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual,
    "What would you most like to improve about your health?",
    "How about a twenty-minute walk before lunch on weekdays?",
    "Your walking plan is set for tomorrow.",
  ].map((text) => inboundMessage({ text }));
}

function outcomeResponse(outcome: { ready: boolean; totalGoalCount?: number; matchingGoalCount: number; matchingGoalIdCount: number }): Response {
  return new Response(JSON.stringify({ ok: true, outcome: { totalGoalCount: outcome.matchingGoalCount, ...outcome } }));
}

function resetResponse(): Response {
  return new Response(JSON.stringify({ ok: true, reset: {
    accountDeleted: true, admissionBudgetCount: 1, admissionDecisionCount: 1, deliveryClaimCount: 1,
  } }));
}

function inboundMessage(input: {
  spaceId?: string;
  text: string;
  timestampMs?: number;
}): [Record<string, unknown>, Record<string, unknown>] {
  return [
    { id: input.spaceId ?? "space_canary" },
    {
      content: { text: input.text, type: "text" },
      direction: "inbound",
      platform: "imessage",
      sender: { id: "target_canary" },
      timestamp: new Date(input.timestampMs ?? 1_000),
    },
  ];
}
