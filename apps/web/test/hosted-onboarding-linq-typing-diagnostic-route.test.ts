import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const target = {
  chatIdPresent: true,
  ingressAgeMs: 1000,
  latestIngressMatched: true,
  routedChatIdPresent: true,
  routedChatMatched: true,
  source: "latest-linq-ingress",
} as const;

const plan = {
  chatId: "chat_123",
  delaysMs: [0, 4_000],
  stop: false,
  stopDelayMs: null,
  target,
  timeoutMs: 100,
};

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getPrisma: vi.fn(() => ({ prisma: true })),
  parseHostedLinqTypingDiagnosticRequest: vi.fn(() => ({
    delaysMs: [0, 4_000],
    mode: "deferred",
    stop: false,
    stopDelayMs: null,
    timeoutMs: 100,
  })),
  prepareHostedLinqTypingDiagnostic: vi.fn(),
  runHostedLinqTypingDiagnosticBurst: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-typing-diagnostic", () => ({
  parseHostedLinqTypingDiagnosticRequest: mocks.parseHostedLinqTypingDiagnosticRequest,
  prepareHostedLinqTypingDiagnostic: mocks.prepareHostedLinqTypingDiagnostic,
  runHostedLinqTypingDiagnosticBurst: mocks.runHostedLinqTypingDiagnosticBurst,
}));

type HostedLinqTypingDiagnosticRouteModule =
  typeof import("../app/api/internal/hosted-onboarding/linq/typing-diagnostic/route");

let route: HostedLinqTypingDiagnosticRouteModule;

describe("hosted Linq typing diagnostic route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-onboarding/linq/typing-diagnostic/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron_secret";
    mocks.prepareHostedLinqTypingDiagnostic.mockResolvedValue(plan);
    mocks.runHostedLinqTypingDiagnosticBurst.mockResolvedValue({
      attempts: [],
      ok: true,
      target,
    });
  });

  it("requires the internal bearer secret", async () => {
    const response = await route.POST(
      new Request("https://join.example.test/api/internal/hosted-onboarding/linq/typing-diagnostic", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.prepareHostedLinqTypingDiagnostic).not.toHaveBeenCalled();
  });

  it("schedules a deferred diagnostic without returning the raw chat id", async () => {
    const response = await route.POST(
      new Request("https://join.example.test/api/internal/hosted-onboarding/linq/typing-diagnostic", {
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer cron_secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload).toEqual({
      mode: "deferred",
      ok: true,
      scheduled: true,
      target,
      totalAttempts: 2,
    });
    expect(mocks.prepareHostedLinqTypingDiagnostic).toHaveBeenCalledWith({
      prisma: { prisma: true },
      request: expect.objectContaining({
        mode: "deferred",
      }),
    });
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));

    await mocks.after.mock.calls[0]?.[0]();

    expect(mocks.runHostedLinqTypingDiagnosticBurst).toHaveBeenCalledWith({
      plan,
    });
    expect(JSON.stringify(payload)).not.toContain("chat_123");
  });

  it("runs inline diagnostics when requested", async () => {
    mocks.parseHostedLinqTypingDiagnosticRequest.mockReturnValueOnce({
      delaysMs: [0],
      mode: "inline",
      stop: false,
      stopDelayMs: null,
      timeoutMs: 100,
    });
    mocks.runHostedLinqTypingDiagnosticBurst.mockResolvedValueOnce({
      attempts: [
        {
          attempt: 1,
          delayMs: 0,
          elapsedMs: 25,
          errorName: null,
          httpStatus: 204,
          ok: true,
          operation: "start",
        },
      ],
      ok: true,
      target,
    });

    const response = await route.POST(
      new Request("https://join.example.test/api/internal/hosted-onboarding/linq/typing-diagnostic", {
        body: JSON.stringify({ mode: "inline" }),
        headers: {
          authorization: "Bearer cron_secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attempts: [
        {
          attempt: 1,
          delayMs: 0,
          elapsedMs: 25,
          errorName: null,
          httpStatus: 204,
          ok: true,
          operation: "start",
        },
      ],
      mode: "inline",
      ok: true,
      scheduled: false,
      target,
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runHostedLinqTypingDiagnosticBurst).toHaveBeenCalledWith({
      plan,
      signal: expect.any(AbortSignal),
    });
  });
});
