import {
  MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS,
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LINQ_PRODUCTION_CANARY_GOAL_TITLE } from "@/src/lib/hosted-onboarding/linq-production-canary-contract";

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
      outcome: { ready: true, totalGoalCount: outcomeReads === 0 ? 0 : 1, matchingGoalCount: outcomeReads === 0 ? 0 : 1, matchingGoalIdCount: outcomeReads++ === 0 ? 0 : 1 },
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

  it("runs five reciprocal turns and proves a fresh canonical save and readback", async () => {
    vi.mocked(Date.now)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(5_000);
    mocks.now = [0, 15_000, 15_000, 30_000, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000];
    mocks.sendResults = [true, true, true, true, true];
    mocks.messages = [
      inboundMessage({ text: "An older reply.", timestampMs: 999 }),
      inboundMessage({ spaceId: "other_space", text: "unrelated" }),
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal, timestampMs: 2_000 }),
      inboundMessage({ text: "A retained earlier reply.", timestampMs: 2_000 }),
      inboundMessage({ text: "What would you most like to improve about your health?", timestampMs: 3_000 }),
      inboundMessage({ text: "Saved your walking goal.", timestampMs: 4_000 }),
      inboundMessage({ text: `Your saved goal is ${LINQ_PRODUCTION_CANARY_GOAL_TITLE}.`, timestampMs: 5_000 }),
    ];

    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toEqual({
      canonicalOutcome: { baselineGoalCount: 0, savedGoalCount: 1, readbackGoalCount: 1 },
      reset: {
        accountDeleted: true,
        admissionBudgetCount: 1,
        admissionDecisionCount: 1,
        deliveryClaimCount: 1,
      },
      turns: [
        { latencyMs: 15_000, stage: "welcome", turn: 1 },
        { latencyMs: 15_000, stage: "identity-question", turn: 2 },
        { latencyMs: 15_000, stage: "runtime-identity", turn: 3 },
        { latencyMs: 15_000, stage: "save-goal", turn: 4 },
        { latencyMs: 15_000, stage: "read-goal", turn: 5 },
      ],
    });
    expect(mocks.messages).toEqual([]);
    expect(mocks.spaceSend.mock.calls.slice(0, 3).map(([text]) => text)).toEqual([
      "Hey Murph",
      "Yes, ready.",
      "My name is Robin. I am 32 and a woman.",
    ]);
    expect(mocks.spaceSend.mock.calls[3]?.[0]).toContain(LINQ_PRODUCTION_CANARY_GOAL_TITLE);
    expect(mocks.spaceSend.mock.calls[4]?.[0]).not.toContain(LINQ_PRODUCTION_CANARY_GOAL_TITLE);
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
    mocks.now = [0, 20_000];
    mocks.sendResults = [true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
    ];

    const report = vi.fn();
    await expect(runLinqProductionCanary(TEST_ENV, report)).rejects.toHaveProperty(
      "name",
      "reply-latency-budget-exceeded; turn=1; metric=send_to_reply; elapsed_ms=20000; budget_ms=20000",
    );
    expect(report).toHaveBeenCalledWith({ latencyMs: 20_000, stage: "welcome", turn: 1 });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("reports an inter-reply-gap-only failure and still stops", async () => {
    mocks.now = [0, 10_000, 15_000, 30_000];
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
    mocks.now = [0, 1_000, 1_000, 2_000, 2_000, 48_000];
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
      { latencyMs: 1_000, stage: "welcome", turn: 1 },
      { latencyMs: 1_000, stage: "identity-question", turn: 2 },
      { latencyMs: 46_000, stage: "runtime-identity", turn: 3 },
    ]);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it.each([
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual,
    MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
  ])("rejects repeated opening copy on the runtime identity turn", async (reply) => {
    mocks.now = [0, 1_000, 1_000, 2_000, 2_000, 3_000];
    mocks.sendResults = [true, true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual }),
      inboundMessage({ text: reply }),
    ];
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: "reply-semantics-invalid",
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("does not mistake a non-identity second reply for the opening handoff", async () => {
    mocks.now = [0, 10_000, 10_000, 15_000];
    mocks.sendResults = [true, true];
    mocks.messages = [
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: "Here is a sleep plan." }),
    ];
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({
      name: "reply-semantics-invalid",
    });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(2);
  });

  it("identifies the unavailable turn after preserving earlier timing evidence", async () => {
    mocks.now = [0, 10_000, 10_000];
    mocks.sendResults = [true, true];
    mocks.messages = [inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE })];
    const report = vi.fn();
    await expect(runLinqProductionCanary(TEST_ENV, report)).rejects.toMatchObject({
      name: "reply-unavailable; turn=2; stage=identity-question; wait_limit_ms=90000",
    });
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ latencyMs: 10_000, stage: "welcome", turn: 1 });
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
      .mockResolvedValueOnce(outcomeResponse(outcome));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-cardinality-invalid; stage=save-goal" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(4);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("waits for a fresh publication before accepting the saved canonical goal", async () => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: false, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockImplementation(async () => outcomeResponse({ ready: true, matchingGoalCount: 1, matchingGoalIdCount: 1 }));
    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toHaveProperty("canonicalOutcome.savedGoalCount", 1);
    expect(mocks.delay).toHaveBeenCalledOnce();
  });

  it("does not accept a save claim when the canonical goal never appears", async () => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockImplementation(async () => outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-not-ready; stage=save-goal" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(4);
  });

  it("requires the delivered readback to name the saved goal", async () => {
    prepareCompleteConversation("I cannot find a saved walking goal.");
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "goal-readback-reply-invalid" });
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("rejects a readback that creates another canonical goal", async () => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse())
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 0, matchingGoalIdCount: 0 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 1, matchingGoalIdCount: 1 }))
      .mockResolvedValueOnce(outcomeResponse({ ready: true, matchingGoalCount: 2, matchingGoalIdCount: 2 }));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-cardinality-invalid; stage=read-goal" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(5);
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

  it.each([404, 503])("fails explicitly when the outcome route or control configuration is unavailable (%s)", async (status) => {
    prepareCompleteConversation();
    vi.mocked(fetch).mockResolvedValueOnce(resetResponse()).mockResolvedValueOnce(new Response(null, { status }));
    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toMatchObject({ name: "outcome-read-failed; stage=runtime-identity" });
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
  });
});

function prepareCompleteConversation(readback = LINQ_PRODUCTION_CANARY_GOAL_TITLE): void {
  mocks.now = [0, 1_000, 1_000, 2_000, 2_000, 3_000, 3_000, 4_000, 4_000, 5_000];
  mocks.sendResults = [true, true, true, true, true];
  mocks.messages = [
    MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
    MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.casual,
    "What would you most like to improve about your health?",
    "Your goal is saved.",
    readback,
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
