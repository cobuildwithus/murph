import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rootHostedWebSession = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const transactionHostedWebSession = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const transactionClient = {
    $queryRaw: vi.fn(),
    hostedWebSession: transactionHostedWebSession,
  };
  const prismaClient = {
    $transaction: vi.fn(),
    hostedWebSession: rootHostedWebSession,
  };

  return {
    getPrisma: vi.fn(),
    prismaClient,
    readHostedMemberCoreState: vi.fn(),
    rootHostedWebSession,
    transactionHostedWebSession,
    transactionClient,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

describe("hosted app session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.transactionClient) => Promise<unknown>) =>
        callback(mocks.transactionClient),
    );
    mocks.rootHostedWebSession.create.mockResolvedValue({});
    mocks.rootHostedWebSession.deleteMany.mockResolvedValue({ count: 0 });
    mocks.rootHostedWebSession.findMany.mockResolvedValue([]);
    mocks.rootHostedWebSession.findUnique.mockResolvedValue(null);
    mocks.rootHostedWebSession.updateMany.mockResolvedValue({ count: 1 });
    mocks.transactionHostedWebSession.create.mockResolvedValue({});
    mocks.transactionHostedWebSession.deleteMany.mockResolvedValue({ count: 0 });
    mocks.transactionHostedWebSession.findMany.mockResolvedValue([
      { id: "hws_existing_19" },
      { id: "hws_existing_18" },
    ]);
    mocks.transactionHostedWebSession.findUnique.mockResolvedValue(null);
    mocks.transactionHostedWebSession.updateMany.mockResolvedValue({ count: 1 });
    mocks.transactionClient.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.readHostedMemberCoreState.mockResolvedValue(createHostedMember());
  });

  it("issues an opaque cookie while storing only the token hash in a bounded transaction", async () => {
    const {
      HOSTED_APP_SESSION_COOKIE_NAME,
      getHostedAppSessionActiveLimit,
      getHostedAppSessionMaxAgeSeconds,
      issueHostedAppSession,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const now = new Date("2026-05-02T00:00:00.000Z");

    const result = await issueHostedAppSession({
      memberId: "member_123",
      now,
      privyUserId: "did:privy:user_123",
    });

    expect(result.sessionId).toMatch(/^hws_[A-Za-z0-9_-]+$/u);
    expect(result.cookie).toContain(`${HOSTED_APP_SESSION_COOKIE_NAME}=murph_session_`);
    expect(result.cookie).toContain("Path=/");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain(`Max-Age=${getHostedAppSessionMaxAgeSeconds()}`);
    expect(mocks.prismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000 });
    expect(mocks.transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.rootHostedWebSession.create).not.toHaveBeenCalled();
    expect(mocks.rootHostedWebSession.deleteMany).not.toHaveBeenCalled();
    expect(mocks.rootHostedWebSession.findMany).not.toHaveBeenCalled();
    expect(mocks.transactionHostedWebSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdAt: now,
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        id: result.sessionId,
        lastSeenAt: now,
        memberId: "member_123",
        privyUserId: "did:privy:user_123",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        updatedAt: now,
      }),
    });
    expect(mocks.transactionHostedWebSession.create.mock.calls[0]?.[0]?.data.tokenHash).not.toContain("murph_session_");
    expect(mocks.transactionClient.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transactionHostedWebSession.create.mock.invocationCallOrder[0],
    );
    expect(mocks.transactionHostedWebSession.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transactionHostedWebSession.findMany.mock.invocationCallOrder[0],
    );
    expect(mocks.transactionHostedWebSession.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transactionHostedWebSession.deleteMany.mock.invocationCallOrder[0],
    );

    expect(mocks.transactionHostedWebSession.findMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: now,
        },
        id: {
          not: result.sessionId,
        },
        memberId: "member_123",
        privyUserId: "did:privy:user_123",
        revokedAt: null,
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: {
        id: true,
      },
      take: getHostedAppSessionActiveLimit() - 1,
    });
    expect(mocks.transactionHostedWebSession.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: now,
        },
        id: {
          notIn: [
            result.sessionId,
            "hws_existing_19",
            "hws_existing_18",
          ],
        },
        memberId: "member_123",
        privyUserId: "did:privy:user_123",
        revokedAt: null,
      },
    });
  });

  it("resolves a valid request cookie into a hosted member session", async () => {
    const {
      HOSTED_APP_SESSION_COOKIE_NAME,
      getHostedAppSessionFromRequest,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const expiresAt = new Date("2026-06-01T00:00:00.000Z");
    mocks.rootHostedWebSession.findUnique.mockResolvedValue({
      expiresAt,
      id: "hws_123",
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      revokedAt: null,
    });

    const session = await getHostedAppSessionFromRequest(
      new Request("https://join.example.test/settings", {
        headers: {
          cookie: `${HOSTED_APP_SESSION_COOKIE_NAME}=murph_session_${"a".repeat(43)}`,
        },
      }),
    );

    expect(mocks.rootHostedWebSession.findUnique).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.any(Object),
    });
    expect(session).toEqual({
      expiresAt,
      member: createHostedMember(),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
  });

  it("rejects expired or revoked stored sessions without reading member state", async () => {
    const {
      HOSTED_APP_SESSION_COOKIE_NAME,
      getHostedAppSessionFromRequest,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    mocks.rootHostedWebSession.findUnique.mockResolvedValue({
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      id: "hws_123",
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      revokedAt: null,
    });

    await expect(getHostedAppSessionFromRequest(
      new Request("https://join.example.test/settings", {
        headers: {
          cookie: `${HOSTED_APP_SESSION_COOKIE_NAME}=murph_session_${"a".repeat(43)}`,
        },
      }),
    )).resolves.toBeNull();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();

    mocks.rootHostedWebSession.findUnique.mockResolvedValue({
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      id: "hws_123",
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      revokedAt: new Date("2026-05-03T00:00:00.000Z"),
    });

    await expect(getHostedAppSessionFromRequest(
      new Request("https://join.example.test/settings", {
        headers: {
          cookie: `${HOSTED_APP_SESSION_COOKIE_NAME}=murph_session_${"b".repeat(43)}`,
        },
      }),
    )).resolves.toBeNull();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
  });

  it("revokes the hashed request cookie and returns a clearing cookie", async () => {
    const {
      HOSTED_APP_SESSION_COOKIE_NAME,
      revokeHostedAppSessionFromRequest,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const now = new Date("2026-05-02T00:00:00.000Z");

    const clearCookie = await revokeHostedAppSessionFromRequest({
      now,
      reason: "logout",
      request: new Request("https://join.example.test/settings", {
        headers: {
          cookie: `${HOSTED_APP_SESSION_COOKIE_NAME}=murph_session_${"c".repeat(43)}`,
        },
      }),
    });

    expect(mocks.rootHostedWebSession.updateMany).toHaveBeenCalledWith({
      where: {
        revokedAt: null,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      data: {
        revokedAt: now,
        revokeReason: "logout",
        updatedAt: now,
      },
    });
    expect(clearCookie).toBe(`${HOSTED_APP_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});

function createHostedMember() {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-05-02T00:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
  };
}
