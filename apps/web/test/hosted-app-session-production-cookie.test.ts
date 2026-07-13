import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const hostedWebSession = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  };
  const transactionClient = {
    $queryRaw: vi.fn(),
    hostedWebSession,
  };
  const prismaClient = {
    $transaction: vi.fn(),
    hostedWebSession,
  };

  return {
    getPrisma: vi.fn(),
    hostedWebSession,
    prismaClient,
    transactionClient,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

describe("hosted app session production cookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.transactionClient) => Promise<unknown>) =>
        callback(mocks.transactionClient),
    );
    mocks.hostedWebSession.create.mockResolvedValue({});
    mocks.hostedWebSession.deleteMany.mockResolvedValue({ count: 0 });
    mocks.hostedWebSession.findMany.mockResolvedValue([]);
    mocks.transactionClient.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  });

  it("uses the __Host cookie name and Secure flag in production", async () => {
    const {
      issueHostedAppSession,
      revokeHostedAppSessionFromRequest,
    } = await import("@/src/lib/hosted-onboarding/app-session");

    const result = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2026-05-02T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });
    const clearCookie = await revokeHostedAppSessionFromRequest({
      now: new Date("2026-05-02T00:00:00.000Z"),
      reason: "logout",
      request: new Request("https://join.example.test/settings"),
    });

    expect(result.cookie).toContain(
      `__Host-murph-session=murph_session_v2.${result.sessionId}.`,
    );
    expect(result.cookie).toContain("Path=/");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain("Secure");
    expect(clearCookie).toBe(
      "__Host-murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });
});
