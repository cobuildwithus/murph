import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedMemberReplyAliasRoute: vi.fn(),
  createHostedMemberReplyAliasRouteFromLookupKey: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberReplyAliasState: vi.fn(),
  resolveHostedMemberReplyAliasRegistrationTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedEmailLookupKeyReadCandidates: () => ["candidate-lookup-key"],
  normalizeHostedEmailAddress: (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase() ?? "";
    return normalized.includes("@") ? normalized : null;
  },
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-email-reply-alias", () => ({
  createHostedMemberReplyAliasRoute: mocks.createHostedMemberReplyAliasRoute,
  createHostedMemberReplyAliasRouteFromLookupKey:
    mocks.createHostedMemberReplyAliasRouteFromLookupKey,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberEmailAuthorization:
    mocks.readHostedMemberEmailAuthorization,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberReplyAliasState: mocks.readHostedMemberReplyAliasState,
  resolveHostedMemberReplyAliasRegistrationTx:
    mocks.resolveHostedMemberReplyAliasRegistrationTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import {
  sendHostedEmailPublicBootstrapChallenge,
} from "@/src/lib/hosted-onboarding/hosted-email-public-bootstrap";
import type {
  sendHostedResendPlainTextEmail,
} from "@/src/lib/hosted-onboarding/resend-plain-text-email";

type BootstrapSendInput = Parameters<typeof sendHostedResendPlainTextEmail>[0];

const NOW = new Date("2026-08-20T12:00:00.000Z");
const VERIFIED_ADDRESS = "member@example.test";
const TEST_ENV = {
  HOSTED_EMAIL_DOMAIN: "mail.example.test",
  HOSTED_EMAIL_LOCAL_PART: "assistant",
  HOSTED_EMAIL_SIGNING_SECRET: "test-signing-secret",
  HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <hello@example.test>",
  RESEND_API_KEY: "test-resend-key",
};

describe("hosted public email bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      verifiedEmail: {
        address: VERIFIED_ADDRESS,
        lookupKey: "candidate-lookup-key",
        verifiedAt: NOW,
      },
    });
    mocks.createHostedMemberReplyAliasRoute.mockResolvedValue({
      address: "assistant+fallback@mail.example.test",
      replyAliasLookupKey: "fallback-alias-key",
    });
    mocks.readHostedMemberReplyAliasState.mockResolvedValue({
      generation: 2,
      lookupKey: "current-alias-key",
    });
    mocks.resolveHostedMemberReplyAliasRegistrationTx.mockResolvedValue({
      generation: 2,
      lookupKey: "current-alias-key",
    });
    mocks.createHostedMemberReplyAliasRouteFromLookupKey.mockResolvedValue({
      address: "assistant+current@mail.example.test",
      replyAliasLookupKey: "current-alias-key",
    });
  });

  it("sends only the fixed private continuation to the current verified inbox", async () => {
    const database = createPrismaMock();
    const sendEmail = vi.fn(async (input: BootstrapSendInput) => {
      void input;
      return { providerMessageId: "email_123" };
    });

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: " MEMBER@example.test ",
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toMatchObject({
      providerMessageId: "email_123",
      status: "sent",
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const email = sendEmail.mock.calls[0]?.[0];
    expect(email).toMatchObject({
      idempotencyKey: expect.stringMatching(/^hosted-email-public-bootstrap\/heba_/u),
      replyTo: "assistant+current@mail.example.test",
      subject: "Start a private conversation with Murph",
      to: [VERIFIED_ADDRESS],
    });
    expect(email?.text).toContain("Murph did not read or save the original message");
    expect(email?.text).toContain("Your reply—not the original email—will be the first message Murph processes.");
    expect(database.attempts).toHaveLength(1);
    expect(database.attempts[0]).toMatchObject({
      candidateEmailLookupKey: "candidate-lookup-key",
      memberId: "member_123",
      providerMessageId: "email_123",
      status: "sent",
    });
  });

  it("drops unknown senders without creating an attempt or sending mail", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    const database = createPrismaMock();
    const sendEmail = vi.fn();

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: "unknown@example.test",
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toEqual({
      reason: "member_not_found",
      status: "suppressed",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(database.attempts).toEqual([]);
  });

  it("suppresses inactive members before durable provider admission", async () => {
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
    const database = createPrismaMock();
    const sendEmail = vi.fn();

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: VERIFIED_ADDRESS,
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toEqual({ reason: "inactive", status: "suppressed" });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(database.attempts).toEqual([]);
  });

  it("suppresses a repeated attempt during the member cooldown", async () => {
    const database = createPrismaMock([{
      candidateEmailLookupKey: "candidate-lookup-key",
      claimedAt: new Date(NOW.getTime() - 60_000),
      id: "heba_existing",
      memberId: "member_123",
      status: "sent",
    }]);
    const sendEmail = vi.fn();

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: VERIFIED_ADDRESS,
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toEqual({ reason: "cooldown", status: "suppressed" });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(database.attempts).toHaveLength(1);
  });

  it("enforces the rolling member daily limit before provider admission", async () => {
    const database = createPrismaMock(Array.from({ length: 3 }, (_, index) => ({
      candidateEmailLookupKey: "candidate-lookup-key",
      claimedAt: new Date(NOW.getTime() - (index + 1) * 60 * 60_000),
      id: `heba_daily_${index}`,
      memberId: "member_123",
      status: "sent",
    })));
    const sendEmail = vi.fn();

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: VERIFIED_ADDRESS,
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toEqual({ reason: "daily_limit", status: "suppressed" });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(database.attempts).toHaveLength(3);
  });

  it("enforces the exact global hourly limit before provider admission", async () => {
    const database = createPrismaMock(Array.from({ length: 100 }, (_, index) => ({
      candidateEmailLookupKey: "candidate-lookup-key",
      claimedAt: new Date(NOW.getTime() - 30 * 60_000),
      id: `heba_global_${index}`,
      memberId: `member_other_${index}`,
      status: "sent",
    })));
    const sendEmail = vi.fn();

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: VERIFIED_ADDRESS,
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toEqual({ reason: "global_limit", status: "suppressed" });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(database.attempts).toHaveLength(100);
  });

  it("terminalizes an uncertain provider call without issuing another send", async () => {
    const database = createPrismaMock();
    const sendEmail = vi.fn(async () => {
      throw new Error("transport outcome unknown");
    });

    await expect(sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: VERIFIED_ADDRESS,
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toMatchObject({
      providerMessageId: null,
      status: "ambiguous",
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    expect(database.attempts).toHaveLength(1);
    expect(database.attempts[0]?.status).toBe("ambiguous");
  });

  it("abandons the claim if verified-email authority rotates before provider entry", async () => {
    const database = createPrismaMock();
    const sendEmail = vi.fn();

    await expect(sendHostedEmailPublicBootstrapChallenge({
      beforeProviderEntry: async () => {
        database.authorizationLookupKey = "rotated-lookup-key";
      },
      candidateAddress: VERIFIED_ADDRESS,
      env: TEST_ENV,
      now: NOW,
      prisma: database.client as never,
      sendEmail,
    })).resolves.toEqual({
      reason: "authority_changed",
      status: "suppressed",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(database.attempts).toHaveLength(1);
    expect(database.attempts[0]?.status).toBe("abandoned");
  });
});

interface TestAttempt {
  candidateEmailLookupKey: string;
  claimedAt: Date;
  completedAt?: Date | null;
  expiresAt?: Date;
  id: string;
  memberId: string;
  providerEntryAt?: Date | null;
  providerMessageId?: string | null;
  status: string;
}

function createPrismaMock(initialAttempts: TestAttempt[] = []) {
  const attempts = initialAttempts.map((attempt) => ({ ...attempt }));
  const state = {
    authorizationLookupKey: "candidate-lookup-key",
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => [{ id: "member_123" }]),
    hostedEmailPublicBootstrapAttempt: {
      create: vi.fn(async ({ data }: { data: TestAttempt }) => {
        attempts.push({ ...data });
        return data;
      }),
      findFirst: vi.fn(async ({ where }: { where: { claimedAt: { gte: Date }; memberId: string } }) =>
        attempts.find((attempt) =>
          attempt.memberId === where.memberId
          && attempt.claimedAt >= where.claimedAt.gte
        ) ?? null),
      findMany: vi.fn(async ({ take, where }: {
        take: number;
        where: { claimedAt: { gte: Date }; memberId?: string };
      }) => attempts.filter((attempt) =>
        attempt.claimedAt >= where.claimedAt.gte
        && (!where.memberId || attempt.memberId === where.memberId)
      ).slice(0, take)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        attempts.find((attempt) => attempt.id === where.id) ?? null),
      updateMany: vi.fn(async ({ data, where }: {
        data: Partial<TestAttempt>;
        where: { id: string; memberId?: string; status?: string | { in: string[] } };
      }) => {
        const attempt = attempts.find((candidate) =>
          candidate.id === where.id
          && (!where.memberId || candidate.memberId === where.memberId)
          && matchesStatus(candidate.status, where.status)
        );
        if (!attempt) {
          return { count: 0 };
        }
        Object.assign(attempt, data);
        return { count: 1 };
      }),
    },
    hostedMemberEmailAuthorization: {
      findUnique: vi.fn(async () => ({
        verifiedEmailLookupKey: state.authorizationLookupKey,
        verifiedEmailVerifiedAt: NOW,
      })),
    },
  };
  const client = {
    ...tx,
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  };

  return {
    attempts,
    client,
    get authorizationLookupKey() {
      return state.authorizationLookupKey;
    },
    set authorizationLookupKey(value: string) {
      state.authorizationLookupKey = value;
    },
  };
}

function matchesStatus(
  current: string,
  expected: string | { in: string[] } | undefined,
): boolean {
  if (!expected) {
    return true;
  }
  return typeof expected === "string"
    ? current === expected
    : expected.in.includes(current);
}
