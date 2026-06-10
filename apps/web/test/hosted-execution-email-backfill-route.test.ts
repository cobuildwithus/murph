import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBearerRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  createHostedMemberReplyAliasRoute: vi.fn(),
  getPrisma: vi.fn(),
  upsertHostedMemberReplyAliasLookupKeyTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-email-reply-alias", () => ({
  createHostedMemberReplyAliasRoute: mocks.createHostedMemberReplyAliasRoute,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  upsertHostedMemberReplyAliasLookupKeyTx: mocks.upsertHostedMemberReplyAliasLookupKeyTx,
}));

type BackfillRouteModule = typeof import(
  "../app/api/internal/hosted-execution/email/backfill-reply-aliases/route"
);
type MockPrismaClient = ReturnType<typeof createPrismaMock>;

let backfillRoute: BackfillRouteModule;
let prismaClient: MockPrismaClient;

const originalBackfillSecret = process.env.HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET;
const BACKFILL_URL =
  "https://join.example.test/api/internal/hosted-execution/email/backfill-reply-aliases";
const UNSUSPENDED_VERIFIED_EMAIL_MEMBER_WHERE = {
  suspendedAt: null,
  emailAuthorization: {
    is: {
      verifiedEmailVerifiedAt: {
        not: null,
      },
    },
  },
};
const MISSING_REPLY_ALIAS_WHERE = {
  ...UNSUSPENDED_VERIFIED_EMAIL_MEMBER_WHERE,
  OR: [
    {
      routing: {
        is: null,
      },
    },
    {
      routing: {
        is: {
          replyAliasLookupKey: null,
        },
      },
    },
  ],
};
const EXISTING_REPLY_ALIAS_WHERE = {
  ...UNSUSPENDED_VERIFIED_EMAIL_MEMBER_WHERE,
  routing: {
    is: {
      replyAliasLookupKey: {
        not: null,
      },
    },
  },
};

describe("hosted execution email reply-alias backfill route", () => {
  beforeAll(async () => {
    backfillRoute = await import(
      "../app/api/internal/hosted-execution/email/backfill-reply-aliases/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv(
      "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET",
      originalBackfillSecret,
    );
    process.env.HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET = "backfill-secret";
    prismaClient = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prismaClient);
    mocks.createHostedMemberReplyAliasRoute.mockImplementation(
      async ({ memberId }: { memberId: string }) => ({
        address: "murph+fixture@mail.example.test",
        replyAliasLookupKey: createFixtureReplyAliasLookupKey(memberId),
      }),
    );
    mocks.upsertHostedMemberReplyAliasLookupKeyTx.mockResolvedValue(undefined);
  });

  afterAll(() => {
    restoreEnv(
      "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET",
      originalBackfillSecret,
    );
  });

  it("dry-runs missing reply aliases without writing member routes", async () => {
    mockHostedMemberCounts({
      existing: 3,
      missingAfter: 2,
      missingBefore: 2,
      unsuspendedVerified: 5,
    });
    prismaClient.hostedMember.findMany.mockResolvedValue([
      { id: "member_1" },
      { id: "member_2" },
    ]);

    const response = await backfillRoute.POST(createBackfillRequest({
      apply: false,
      token: "backfill-secret",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).not.toHaveBeenCalled();
    expect(mocks.createHostedMemberReplyAliasRoute).toHaveBeenCalledTimes(2);
    expectBackfillQueriesToTargetMissingAliases();
    expect(body).toEqual({
      apply: false,
      backfilledReplyAliasCount: 0,
      existingReplyAliasCountBefore: 3,
      generatedReplyAliasCount: 2,
      missingReplyAliasCountAfter: 2,
      missingReplyAliasCountBefore: 2,
      ok: true,
      unsuspendedVerifiedEmailMemberCount: 5,
    });
    expect(JSON.stringify(body)).not.toContain("member_");
    expect(JSON.stringify(body)).not.toContain("murph+fixture@mail.example.test");
    expect(JSON.stringify(body)).not.toContain("0123456789abcdef0123456789abcdef");
    expect(JSON.stringify(body)).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("applies missing reply aliases inside one transaction", async () => {
    mockHostedMemberCounts({
      existing: 3,
      missingAfter: 0,
      missingBefore: 2,
      unsuspendedVerified: 5,
    });
    prismaClient.hostedMember.findMany.mockResolvedValue([
      { id: "member_1" },
      { id: "member_2" },
    ]);

    const response = await backfillRoute.POST(createBackfillRequest({
      apply: true,
      token: "backfill-secret",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prismaClient.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).toHaveBeenCalledTimes(2);
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).toHaveBeenNthCalledWith(1, {
      memberId: "member_1",
      prisma: prismaClient.transactionClient,
      replyAliasLookupKey: "0123456789abcdef0123456789abcdef",
    });
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).toHaveBeenNthCalledWith(2, {
      memberId: "member_2",
      prisma: prismaClient.transactionClient,
      replyAliasLookupKey: "abcdef0123456789abcdef0123456789",
    });
    expect(body).toEqual({
      apply: true,
      backfilledReplyAliasCount: 2,
      existingReplyAliasCountBefore: 3,
      generatedReplyAliasCount: 2,
      missingReplyAliasCountAfter: 0,
      missingReplyAliasCountBefore: 2,
      ok: true,
      unsuspendedVerifiedEmailMemberCount: 5,
    });
    expect(JSON.stringify(body)).not.toContain("member_");
    expect(JSON.stringify(body)).not.toContain("murph+fixture@mail.example.test");
    expect(JSON.stringify(body)).not.toContain("0123456789abcdef0123456789abcdef");
    expect(JSON.stringify(body)).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("rejects unauthorized requests before reading the database", async () => {
    const response = await backfillRoute.POST(createBackfillRequest({
      apply: true,
      token: "wrong-secret",
    }));

    expect(response.status).toBe(401);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_UNAUTHORIZED",
        message: "Unauthorized hosted email reply-alias backfill request.",
        retryable: false,
      },
    });
  });

  it("rejects invalid apply values before reading the database", async () => {
    const response = await backfillRoute.POST(
      createBearerRequest(BACKFILL_URL, "backfill-secret", {
        body: JSON.stringify({ apply: "yes" }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_APPLY_INVALID",
        message: "Hosted email reply-alias backfill apply must be a boolean.",
        retryable: false,
      },
    });
  });

  it("rejects duplicate generated lookup keys before writing", async () => {
    mockHostedMemberCounts({
      existing: 0,
      missingAfter: 2,
      missingBefore: 2,
      unsuspendedVerified: 2,
    });
    prismaClient.hostedMember.findMany.mockResolvedValue([
      { id: "member_1" },
      { id: "member_2" },
    ]);
    mocks.createHostedMemberReplyAliasRoute.mockResolvedValue({
      address: "murph+fixture@mail.example.test",
      replyAliasLookupKey: "duplicate-lookup-key",
    });

    const response = await backfillRoute.POST(createBackfillRequest({
      apply: true,
      token: "backfill-secret",
    }));

    expect(response.status).toBe(500);
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_ALIAS_COLLISION",
        message: "Hosted email reply-alias backfill generated a duplicate lookup key.",
        retryable: false,
      },
    });
  });

  it("fails closed when hosted email alias config is unavailable", async () => {
    mockHostedMemberCounts({
      existing: 0,
      missingAfter: 1,
      missingBefore: 1,
      unsuspendedVerified: 1,
    });
    prismaClient.hostedMember.findMany.mockResolvedValue([{ id: "member_1" }]);
    mocks.createHostedMemberReplyAliasRoute.mockResolvedValue(null);

    const response = await backfillRoute.POST(createBackfillRequest({
      apply: true,
      token: "backfill-secret",
    }));

    expect(response.status).toBe(500);
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_CONFIG_REQUIRED",
        message: "Hosted email reply-alias backfill requires hosted email alias configuration.",
        retryable: false,
      },
    });
  });
});

function createBackfillRequest(input: { apply: boolean; token: string }) {
  return createBearerRequest(BACKFILL_URL, input.token, {
    body: JSON.stringify({
      apply: input.apply,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function createPrismaMock() {
  const transactionClient = {
    label: "transaction-client",
  };

  return {
    hostedMember: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    transactionClient,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(transactionClient)
    ),
  };
}

function expectBackfillQueriesToTargetMissingAliases(): void {
  expect(prismaClient.hostedMember.findMany).toHaveBeenCalledWith({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
    where: MISSING_REPLY_ALIAS_WHERE,
  });
  expect(prismaClient.hostedMember.count).toHaveBeenNthCalledWith(1, {
    where: UNSUSPENDED_VERIFIED_EMAIL_MEMBER_WHERE,
  });
  expect(prismaClient.hostedMember.count).toHaveBeenNthCalledWith(2, {
    where: EXISTING_REPLY_ALIAS_WHERE,
  });
  expect(prismaClient.hostedMember.count).toHaveBeenNthCalledWith(3, {
    where: MISSING_REPLY_ALIAS_WHERE,
  });
  expect(prismaClient.hostedMember.count).toHaveBeenNthCalledWith(4, {
    where: UNSUSPENDED_VERIFIED_EMAIL_MEMBER_WHERE,
  });
  expect(prismaClient.hostedMember.count).toHaveBeenNthCalledWith(5, {
    where: EXISTING_REPLY_ALIAS_WHERE,
  });
  expect(prismaClient.hostedMember.count).toHaveBeenNthCalledWith(6, {
    where: MISSING_REPLY_ALIAS_WHERE,
  });
}

function mockHostedMemberCounts(input: {
  existing: number;
  missingAfter: number;
  missingBefore: number;
  unsuspendedVerified: number;
}) {
  prismaClient.hostedMember.count
    .mockResolvedValueOnce(input.unsuspendedVerified)
    .mockResolvedValueOnce(input.existing)
    .mockResolvedValueOnce(input.missingBefore)
    .mockResolvedValueOnce(input.unsuspendedVerified)
    .mockResolvedValueOnce(input.existing + (input.missingBefore - input.missingAfter))
    .mockResolvedValueOnce(input.missingAfter);
}

function createFixtureReplyAliasLookupKey(memberId: string): string {
  if (memberId === "member_2") {
    return "abcdef0123456789abcdef0123456789";
  }

  return "0123456789abcdef0123456789abcdef";
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
