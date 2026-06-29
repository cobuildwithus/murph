import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

interface StoredHostedWebSession {
  computerHandoffViewportHeight: number | null;
  computerHandoffViewportObservedAt: Date | null;
  computerHandoffViewportWidth: number | null;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  lastSeenAt: Date | null;
  memberId: string;
  privyUserId: string;
  revokedAt: Date | null;
  revokeReason: string | null;
  tokenHash: string;
  updatedAt: Date;
}

interface HostedWebSessionCreateInput {
  data: {
    createdAt: Date;
    expiresAt: Date;
    id: string;
    lastSeenAt: Date | null;
    memberId: string;
    privyUserId: string;
    tokenHash: string;
    updatedAt: Date;
  };
}

interface HostedWebSessionWhere {
  id?: {
    not?: string;
    notIn?: string[];
  };
  memberId?: string;
  privyUserId?: string;
}

interface HostedWebSessionFindManyInput {
  orderBy: unknown;
  select: {
    id: true;
  };
  take: number;
  where: HostedWebSessionWhere;
}

interface HostedWebSessionFindUniqueInput {
  where: {
    tokenHash: string;
  };
}

interface HostedWebSessionUpdateManyInput {
  data: {
    revokedAt: Date;
    revokeReason: string;
    updatedAt: Date;
  };
  where: {
    revokedAt: null;
    tokenHash: string;
  };
}

let harness: ReturnType<typeof createPrismaHarness>;

describe("hosted app session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = createPrismaHarness();
    mocks.getPrisma.mockReturnValue(harness.prismaClient);
    mocks.readHostedMemberCoreState.mockResolvedValue(createHostedMember());
  });

  it("issues an opaque cookie while storing only the token hash in the member-locked transaction", async () => {
    const {
      issueHostedAppSession,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const now = new Date("2026-05-02T00:00:00.000Z");

    const result = await issueHostedAppSession({
      memberId: "member_123",
      now,
      privyUserId: "did:privy:user_123",
    });

    const storedSession = harness.records.find((record) => record.id === result.sessionId);
    expect(storedSession).toBeDefined();
    if (!storedSession) {
      throw new Error("Expected issued hosted web session to be stored.");
    }

    expect(result.sessionId).toMatch(/^hws_[A-Za-z0-9_-]+$/u);
    expect(result.cookie).toContain("murph-session=murph_session_");
    expect(result.cookie).toContain("Path=/");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain("Max-Age=2592000");
    expect(storedSession).toEqual(expect.objectContaining({
      createdAt: now,
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
      lastSeenAt: now,
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      revokedAt: null,
      updatedAt: now,
    }));
    expect(storedSession.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(storedSession.tokenHash).not.toContain("murph_session_");
    expect(harness.prismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5_000 });
    expect(harness.transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.rootHostedWebSession.create).not.toHaveBeenCalled();
    expect(harness.rootHostedWebSession.findMany).not.toHaveBeenCalled();
    expect(harness.rootHostedWebSession.deleteMany).not.toHaveBeenCalled();
    expect(harness.transactionHostedWebSession.findMany).toHaveBeenCalledTimes(1);
    expect(harness.transactionHostedWebSession.deleteMany).toHaveBeenCalledTimes(1);
    expect(harness.transactionClient.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      harness.transactionHostedWebSession.create.mock.invocationCallOrder[0],
    );
    expect(harness.transactionHostedWebSession.create.mock.invocationCallOrder[0]).toBeLessThan(
      harness.transactionHostedWebSession.findMany.mock.invocationCallOrder[0],
    );
    expect(harness.transactionHostedWebSession.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      harness.transactionHostedWebSession.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it("keeps hosted app session rows bounded per member and Privy user", async () => {
    const { issueHostedAppSession } = await import("@/src/lib/hosted-onboarding/app-session");
    const startTime = Date.parse("2026-01-01T00:00:00.000Z");
    const targetRows = Array.from({ length: 20 }, (_unused, index) =>
      buildStoredSession({
        createdAt: new Date(startTime + index * 86_400_000),
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        id: `hws_target_${index.toString().padStart(2, "0")}`,
        revokedAt: index === 0 || index === 19
          ? new Date("2026-04-01T00:00:00.000Z")
          : null,
      }));
    const otherMemberRow = buildStoredSession({
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      id: "hws_other_member",
      memberId: "member_456",
    });
    const otherPrivyRow = buildStoredSession({
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      id: "hws_other_privy",
      privyUserId: "did:privy:user_456",
    });
    harness.records.push(...targetRows, otherMemberRow, otherPrivyRow);

    const result = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2026-05-02T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });

    const targetSessionIds = harness.records
      .filter((record) => record.memberId === "member_123" && record.privyUserId === "did:privy:user_123")
      .map((record) => record.id);
    expect(targetSessionIds).toHaveLength(20);
    expect(targetSessionIds).toContain(result.sessionId);
    expect(targetSessionIds).toContain("hws_target_19");
    expect(targetSessionIds).not.toContain("hws_target_00");
    expect(harness.records.map((record) => record.id)).toContain("hws_other_member");
    expect(harness.records.map((record) => record.id)).toContain("hws_other_privy");
  });

  it("resolves a valid request cookie into a hosted member session", async () => {
    const {
      getHostedAppSessionFromRequest,
      issueHostedAppSession,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const result = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2099-01-01T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });

    const session = await getHostedAppSessionFromRequest(requestWithCookie(result.cookie));

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: harness.prismaClient,
    });
    expect(session).toEqual({
      computerHandoffViewportSize: null,
      expiresAt: new Date("2099-01-31T00:00:00.000Z"),
      member: createHostedMember(),
      privyUserId: "did:privy:user_123",
      sessionId: result.sessionId,
    });
  });

  it("resolves a saved computer handoff viewport size from the current web session", async () => {
    const {
      getHostedAppSessionFromRequest,
      issueHostedAppSession,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const result = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2099-01-01T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });
    const record = findStoredSession(result.sessionId);
    record.computerHandoffViewportHeight = 843;
    record.computerHandoffViewportWidth = 391;

    const session = await getHostedAppSessionFromRequest(requestWithCookie(result.cookie));

    expect(session?.computerHandoffViewportSize).toEqual({
      height: 844,
      width: 392,
    });
  });

  it("rejects expired or revoked stored sessions without reading member state", async () => {
    const {
      getHostedAppSessionFromRequest,
      issueHostedAppSession,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const expired = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2099-01-01T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });
    const expiredRecord = findStoredSession(expired.sessionId);
    expiredRecord.expiresAt = new Date("2020-01-01T00:00:00.000Z");

    await expect(getHostedAppSessionFromRequest(requestWithCookie(expired.cookie))).resolves.toBeNull();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();

    const revoked = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2099-02-01T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });
    const revokedRecord = findStoredSession(revoked.sessionId);
    revokedRecord.revokedAt = new Date("2099-02-02T00:00:00.000Z");

    await expect(getHostedAppSessionFromRequest(requestWithCookie(revoked.cookie))).resolves.toBeNull();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
  });

  it("revokes the hashed request cookie and returns a clearing cookie", async () => {
    const {
      issueHostedAppSession,
      revokeHostedAppSessionFromRequest,
    } = await import("@/src/lib/hosted-onboarding/app-session");
    const issueResult = await issueHostedAppSession({
      memberId: "member_123",
      now: new Date("2099-01-01T00:00:00.000Z"),
      privyUserId: "did:privy:user_123",
    });
    const now = new Date("2099-01-02T00:00:00.000Z");

    const clearCookie = await revokeHostedAppSessionFromRequest({
      now,
      reason: "logout",
      request: requestWithCookie(issueResult.cookie),
    });

    const revokedRecord = findStoredSession(issueResult.sessionId);
    expect(revokedRecord.revokedAt).toEqual(now);
    expect(revokedRecord.revokeReason).toBe("logout");
    expect(clearCookie).toBe("murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });
});

function createPrismaHarness(records: StoredHostedWebSession[] = []) {
  const rootHostedWebSession = createHostedWebSessionDelegate(records);
  const transactionHostedWebSession = createHostedWebSessionDelegate(records);
  const transactionClient = {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    hostedWebSession: transactionHostedWebSession,
  };
  const prismaClient = {
    $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
    ),
    hostedWebSession: rootHostedWebSession,
  };

  return {
    prismaClient,
    records,
    rootHostedWebSession,
    transactionClient,
    transactionHostedWebSession,
  };
}

function createHostedWebSessionDelegate(records: StoredHostedWebSession[]) {
  const create = vi.fn(async (input: HostedWebSessionCreateInput): Promise<StoredHostedWebSession> => {
    const record = {
      ...input.data,
      computerHandoffViewportHeight: null,
      computerHandoffViewportObservedAt: null,
      computerHandoffViewportWidth: null,
      revokedAt: null,
      revokeReason: null,
    };
    records.push(record);
    return record;
  });
  const findMany = vi.fn(async (input: HostedWebSessionFindManyInput): Promise<Array<{ id: string }>> => {
    assertHostedWebSessionCapOrderBy(input.orderBy);
    return records
      .filter((record) => storedSessionMatchesWhere(record, input.where))
      .sort(compareStoredSessionsDescending)
      .slice(0, input.take)
      .map((record) => ({ id: record.id }));
  });
  const deleteMany = vi.fn(async (input: { where: HostedWebSessionWhere }): Promise<{ count: number }> => {
    let count = 0;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (record && storedSessionMatchesWhere(record, input.where)) {
        records.splice(index, 1);
        count += 1;
      }
    }
    return { count };
  });
  const findUnique = vi.fn(async (input: HostedWebSessionFindUniqueInput): Promise<StoredHostedWebSession | null> =>
    records.find((record) => record.tokenHash === input.where.tokenHash) ?? null,
  );
  const updateMany = vi.fn(async (input: HostedWebSessionUpdateManyInput): Promise<{ count: number }> => {
    let count = 0;
    for (const record of records) {
      if (record.tokenHash === input.where.tokenHash && record.revokedAt === input.where.revokedAt) {
        record.revokedAt = input.data.revokedAt;
        record.revokeReason = input.data.revokeReason;
        record.updatedAt = input.data.updatedAt;
        count += 1;
      }
    }
    return { count };
  });

  return {
    create,
    deleteMany,
    findMany,
    findUnique,
    updateMany,
  };
}

function assertHostedWebSessionCapOrderBy(orderBy: unknown): void {
  if (!Array.isArray(orderBy) || orderBy.length !== 2) {
    throw new Error("Hosted web session cap query must order by createdAt desc, then id desc.");
  }

  const [createdAtOrder, idOrder] = orderBy;
  if (
    !isRecord(createdAtOrder)
    || createdAtOrder.createdAt !== "desc"
    || !isRecord(idOrder)
    || idOrder.id !== "desc"
  ) {
    throw new Error("Hosted web session cap query must order by createdAt desc, then id desc.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedSessionMatchesWhere(record: StoredHostedWebSession, where: HostedWebSessionWhere): boolean {
  assertSupportedWhere(where);

  if (where.memberId !== undefined && record.memberId !== where.memberId) {
    return false;
  }
  if (where.privyUserId !== undefined && record.privyUserId !== where.privyUserId) {
    return false;
  }
  if (where.id?.not !== undefined && record.id === where.id.not) {
    return false;
  }
  if (where.id?.notIn !== undefined && where.id.notIn.includes(record.id)) {
    return false;
  }
  return true;
}

function assertSupportedWhere(where: HostedWebSessionWhere): void {
  const supportedWhereKeys = new Set(["id", "memberId", "privyUserId"]);
  for (const key of Object.keys(where)) {
    if (!supportedWhereKeys.has(key)) {
      throw new Error(`Unsupported hosted web session where key: ${key}`);
    }
  }

  if (where.id) {
    const supportedIdKeys = new Set(["not", "notIn"]);
    for (const key of Object.keys(where.id)) {
      if (!supportedIdKeys.has(key)) {
        throw new Error(`Unsupported hosted web session id where key: ${key}`);
      }
    }
  }
}

function compareStoredSessionsDescending(left: StoredHostedWebSession, right: StoredHostedWebSession): number {
  const createdAtOrder = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }
  return right.id.localeCompare(left.id);
}

function findStoredSession(sessionId: string): StoredHostedWebSession {
  const record = harness.records.find((candidate) => candidate.id === sessionId);
  if (!record) {
    throw new Error(`Expected stored session ${sessionId}.`);
  }
  return record;
}

function buildStoredSession(input: {
  createdAt: Date;
  expiresAt?: Date;
  id: string;
  memberId?: string;
  privyUserId?: string;
  revokedAt?: Date | null;
}): StoredHostedWebSession {
  return {
    computerHandoffViewportHeight: null,
    computerHandoffViewportObservedAt: null,
    computerHandoffViewportWidth: null,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt ?? new Date("2099-01-01T00:00:00.000Z"),
    id: input.id,
    lastSeenAt: input.createdAt,
    memberId: input.memberId ?? "member_123",
    privyUserId: input.privyUserId ?? "did:privy:user_123",
    revokedAt: input.revokedAt ?? null,
    revokeReason: input.revokedAt ? "test" : null,
    tokenHash: `hash_${input.id}`,
    updatedAt: input.createdAt,
  };
}

function requestWithCookie(cookie: string): Request {
  return new Request("https://join.example.test/settings", {
    headers: {
      cookie,
    },
  });
}

function createHostedMember() {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-05-02T00:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
  };
}
