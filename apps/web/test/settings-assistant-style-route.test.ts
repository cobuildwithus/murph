import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  transaction: vi.fn(),
  upsertHostedMemberAssistantPreferencesTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));

vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  upsertHostedMemberAssistantPreferencesTx: mocks.upsertHostedMemberAssistantPreferencesTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type AssistantStyleRouteModule = typeof import("../app/api/settings/assistant-style/route");

let route: AssistantStyleRouteModule;

describe("assistant style settings route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/assistant-style/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));
    mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ tx: true }),
    );
    mocks.getPrisma.mockReturnValue({
      $transaction: mocks.transaction,
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantPersona: null,
      assistantPersonality: {
        detail: 5,
        humor: 3,
        push: 3,
      },
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: {
        mailboxItemId: "mailbox_item_preferences",
      },
      updated: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists validated assistant preferences and best-effort signals the runtime", async () => {
    const response = await route.POST(jsonRequest({
      tone: "formal",
      voice: "warm",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assistantPersona: null,
      assistantTone: "formal",
      assistantVoice: "warm",
      ok: true,
      runTriggered: true,
      updated: true,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.assertHostedMemberNotSuspended).toHaveBeenCalledWith({
      id: "member_123",
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        tone: "formal",
        voice: "warm",
      },
      prisma: { tx: true },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_preferences",
    });
  });

  it("persists persona, writing style, and voice in one preference write", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValueOnce({
      assistantPersona: "navy-seal-with-classic",
      assistantPersonality: { detail: 2, humor: 1, push: 10 },
      assistantTone: "formal",
      assistantVoice: "drill-sergeant",
      dispatch: { mailboxItemId: "mailbox_item_persona" },
      updated: true,
    });

    const response = await route.POST(jsonRequest({
      persona: "navy-seal-with-classic",
      tone: "formal",
      voice: "drill-sergeant",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assistantPersona: "navy-seal-with-classic",
      assistantTone: "formal",
      assistantVoice: "drill-sergeant",
      ok: true,
      runTriggered: true,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        persona: "navy-seal-with-classic",
        tone: "formal",
        voice: "drill-sergeant",
      },
      prisma: { tx: true },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("persists a persona-only Settings edit without touching tone or voice", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValueOnce({
      assistantPersona: "scientist-with-classic",
      assistantPersonality: { detail: 9, humor: 2, push: 4 },
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: { mailboxItemId: "mailbox_item_persona_only" },
      updated: true,
    });

    const response = await route.POST(jsonRequest({
      persona: "scientist-with-classic",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assistantPersona: "scientist-with-classic",
      assistantTone: "casual",
      assistantVoice: "warm",
      ok: true,
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: { persona: "scientist-with-classic" },
      prisma: { tx: true },
    });
  });

  it("returns an idempotent no-op response without signaling the runtime", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantPersona: null,
      assistantPersonality: {
        detail: 5,
        humor: 3,
        push: 3,
      },
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: null,
      updated: false,
    });

    const response = await route.POST(jsonRequest({
      tone: "formal",
      voice: "warm",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assistantPersona: null,
      assistantTone: "formal",
      assistantVoice: "warm",
      ok: true,
      runTriggered: false,
      updated: false,
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        tone: "formal",
        voice: "warm",
      },
      prisma: { tx: true },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("succeeds when the best-effort runtime signal fails", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(new Error("signal unavailable"));

    const response = await route.POST(jsonRequest({
      tone: "formal",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assistantPersona: null,
      assistantTone: "formal",
      assistantVoice: "warm",
      ok: true,
      runTriggered: true,
      updated: true,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_preferences",
    });
  });

  it("returns the durable save when the best-effort runtime signal hangs", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockReturnValue(new Promise(() => {}));

    const responsePromise = route.POST(jsonRequest({
      tone: "casual",
    }));
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runTriggered: true,
      updated: true,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_preferences",
    });
  });

  it("rejects invalid and legacy personas before opening the persistence transaction", async () => {
    const response = await route.POST(jsonRequest({ persona: "wise-elder" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_INVALID_PERSONA",
        message: "Choose a valid Murph persona.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown style fields instead of silently ignoring them", async () => {
    const response = await route.POST(jsonRequest({ personality: { humor: 5 } }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_UNKNOWN_FIELD",
        message: "Assistant style request contains an unknown field.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid tones before opening the persistence transaction", async () => {
    const response = await route.POST(jsonRequest({
      tone: "pirate",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_INVALID_TONE",
        message: "Choose a valid tone.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("rejects invalid voices before opening the persistence transaction", async () => {
    const response = await route.POST(jsonRequest({
      voice: "not-a-roster-id",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_INVALID_VOICE",
        message: "Choose a valid voice.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("rejects empty preference updates before opening the persistence transaction", async () => {
    const response = await route.POST(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_EMPTY_UPDATE",
        message: "Choose a persona, tone, or voice before continuing.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/settings/assistant-style", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
