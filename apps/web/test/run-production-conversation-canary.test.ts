import {
  MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS,
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messages: [] as Array<[Record<string, unknown>, Record<string, unknown>]>,
  now: [] as number[],
  sendResults: [] as boolean[],
  spaceSend: vi.fn(),
  stop: vi.fn(),
}));

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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      reset: {
        accountDeleted: true,
        admissionBudgetCount: 1,
        admissionDecisionCount: 1,
        deliveryClaimCount: 1,
      },
    }), { status: 200 })));
  });

  it("runs three reciprocal turns, ignores stale and unrelated messages, and stops", async () => {
    vi.mocked(Date.now)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);
    mocks.now = [0, 15_000, 15_000, 30_000, 30_000, 45_000];
    mocks.sendResults = [true, true, true];
    mocks.messages = [
      inboundMessage({ text: "An older reply.", timestampMs: 999 }),
      inboundMessage({ spaceId: "other_space", text: "unrelated" }),
      inboundMessage({ text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE }),
      inboundMessage({ text: MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS.formal, timestampMs: 2_000 }),
      inboundMessage({ text: "A retained earlier reply.", timestampMs: 2_000 }),
      inboundMessage({ text: "What would you most like to improve about your health?", timestampMs: 3_000 }),
    ];

    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toEqual({
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
      ],
    });
    expect(mocks.messages).toEqual([]);
    expect(mocks.spaceSend.mock.calls.map(([text]) => text)).toEqual([
      "Hey Murph",
      "Yes, ready.",
      "My name is Robin. I am 32 and a woman.",
    ]);
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
});

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
