import { readFileSync } from "node:fs";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertHostedMemberAssistantPreferencesTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  projectHostedMemberAssistantPreferences: (member: {
    assistantPersona: string | null;
    assistantTone: string | null;
    assistantVoice: string | null;
  }) => ({
    persona: member.assistantPersona,
    personality: { detail: null, humor: null, push: null, unhinged: null },
    tone: member.assistantTone,
    voice: member.assistantVoice,
  }),
  upsertHostedMemberAssistantPreferencesTx:
    mocks.upsertHostedMemberAssistantPreferencesTx,
}));

type InitialOnboardingModule = typeof import(
  "@/src/lib/hosted-onboarding/initial-onboarding"
);

let onboarding: InitialOnboardingModule;

describe("cross-platform initial onboarding state", () => {
  beforeAll(async () => {
    onboarding = await import("@/src/lib/hosted-onboarding/initial-onboarding");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantPersona: "navy-seal-with-classic",
      assistantTone: "formal",
      assistantVoice: "drill-sergeant",
      dispatch: { mailboxItemId: "mailbox_preferences" },
    });
  });

  it("lets the first surface complete and makes a stale second surface a no-op", async () => {
    const member = createMember();
    const tx = createTransaction(member);
    const first = await onboarding.completeHostedInitialOnboardingTx({
      memberId: "member_123",
      now: new Date("2026-08-04T12:00:00.000Z"),
      prisma: tx as never,
      request: { action: "skip" },
    });
    const stale = await onboarding.completeHostedInitialOnboardingTx({
      memberId: "member_123",
      now: new Date("2026-08-04T12:00:01.000Z"),
      prisma: tx as never,
      request: {
        action: "save",
        preferences: {
          persona: "navy-seal-with-classic",
          tone: "formal",
          voice: "drill-sergeant",
        },
      },
    });

    expect(first).toMatchObject({ completedNow: true, status: "completed" });
    expect(stale).toMatchObject({
      completedNow: false,
      preferences: { persona: null, tone: null, voice: null },
      status: "completed",
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(tx.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("saves all style choices and completion in one owning transaction", async () => {
    const tx = createTransaction(createMember());
    const result = await onboarding.completeHostedInitialOnboardingTx({
      memberId: "member_123",
      now: new Date("2026-08-04T12:00:00.000Z"),
      prisma: tx as never,
      request: {
        action: "save",
        preferences: {
          persona: "navy-seal-with-classic",
          tone: "formal",
          voice: "drill-sergeant",
        },
      },
    });

    expect(result).toMatchObject({
      completedNow: true,
      dispatch: { mailboxItemId: "mailbox_preferences" },
      preferences: {
        persona: "navy-seal-with-classic",
        tone: "formal",
        voice: "drill-sergeant",
      },
      status: "completed",
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-08-04T12:00:00.000Z",
      preferences: {
        persona: "navy-seal-with-classic",
        tone: "formal",
        voice: "drill-sergeant",
      },
      prisma: tx,
    });
  });

  it("accepts only exact save and skip request shapes", () => {
    expect(onboarding.parseHostedInitialOnboardingCompletionRequest({
      action: "skip",
    })).toEqual({ action: "skip" });
    expect(onboarding.parseHostedInitialOnboardingCompletionRequest({
      action: "save",
      preferences: {
        persona: "classic",
        tone: "formal",
        voice: "upbeat",
      },
    })).toEqual({
      action: "save",
      preferences: {
        persona: "classic",
        tone: "formal",
        voice: "upbeat",
      },
    });
    expect(() => onboarding.parseHostedInitialOnboardingCompletionRequest({
      action: "skip",
      preferences: {},
    })).toThrow("Skipped onboarding cannot include preferences");
    expect(() => onboarding.parseHostedInitialOnboardingCompletionRequest({
      action: "save",
      preferences: {
        persona: "classic",
        tone: "formal",
        voice: "not-a-voice",
      },
    })).toThrow("Choose a valid Murph persona, tone, and voice");
  });

  it("backfills pre-existing members while leaving the new-column default nullable", () => {
    const migration = readFileSync(
      new URL(
        "../prisma/migrations/20260804170000_add_initial_onboarding_completion/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      'ADD COLUMN "initial_onboarding_completed_at" TIMESTAMP(3)',
    );
    expect(migration).not.toMatch(/DEFAULT/iu);
    expect(migration).toContain(
      'SET "initial_onboarding_completed_at" = "created_at"',
    );
  });
});

function createMember() {
  return {
    assistantDetail: null,
    assistantHumor: null,
    assistantPersona: null,
    assistantPush: null,
    assistantTone: null,
    assistantUnhinged: null,
    assistantVoice: null,
    initialOnboardingCompletedAt: null as Date | null,
  };
}

function createTransaction(member: ReturnType<typeof createMember>) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    hostedMember: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...member })),
      update: vi.fn().mockImplementation(async (input: {
        data: { initialOnboardingCompletedAt: Date };
      }) => {
        member.initialOnboardingCompletedAt = input.data.initialOnboardingCompletedAt;
        return { ...member };
      }),
    },
  };
}
