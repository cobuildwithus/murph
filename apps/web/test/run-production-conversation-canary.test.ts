import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";
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
      inboundMessage({ text: "A useful next question.", timestampMs: 2_000 }),
      inboundMessage({ text: "A retained earlier reply.", timestampMs: 2_000 }),
      inboundMessage({ text: "Start with a consistent wake time.", timestampMs: 3_000 }),
    ];

    await expect(runLinqProductionCanary(TEST_ENV)).resolves.toEqual({
      reset: {
        accountDeleted: true,
        admissionBudgetCount: 1,
        admissionDecisionCount: 1,
        deliveryClaimCount: 1,
      },
      turns: [
        { latencyMs: 15_000, turn: 1 },
        { latencyMs: 15_000, turn: 2 },
        { latencyMs: 15_000, turn: 3 },
      ],
    });
    expect(mocks.messages).toEqual([]);
    expect(mocks.spaceSend).toHaveBeenCalledTimes(3);
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

    await expect(runLinqProductionCanary(TEST_ENV)).rejects.toHaveProperty(
      "name",
      "reply-latency-budget-exceeded; turn=1; metric=send_to_reply; elapsed_ms=20000; budget_ms=20000",
    );
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
