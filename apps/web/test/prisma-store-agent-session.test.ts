import { describe, expect, it, vi } from "vitest";

const { randomBytesMock } = vi.hoisted(() => ({
  randomBytesMock: vi.fn((length: number) => Buffer.from(Array.from({ length }, (_, index) => index))),
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomBytes: randomBytesMock,
  };
});

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

type MutableAgentSession = {
  id: string;
  userId: string;
  label: string | null;
  tokenHash: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  replacedBySessionId: string | null;
};

function createSessionStore(seed: MutableAgentSession[]) {
  const sessions = new Map<string, MutableAgentSession>(
    seed.map((session) => [
      session.id,
      {
        ...session,
      },
    ]),
  );

  const deviceAgentSession = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const session = normalizeSessionRecord(data);
      sessions.set(session.id, session);
      return cloneSession(session);
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.id === "string") {
        return cloneSession(sessions.get(where.id) ?? null);
      }

      if (typeof where.tokenHash === "string") {
        return cloneSession(findSessionByTokenHash(sessions, where.tokenHash) ?? null);
      }

      return null;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      for (const session of sessions.values()) {
        if (matchesWhere(session, where)) {
          return cloneSession(session);
        }
      }

      return null;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (typeof where.id !== "string") {
        throw new TypeError("Expected session id.");
      }

      const session = sessions.get(where.id);

      if (!session) {
        throw new TypeError("Session not found.");
      }

      applyUpdate(session, data);
      return cloneSession(session);
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;

      for (const session of sessions.values()) {
        if (!matchesWhere(session, where)) {
          continue;
        }

        applyUpdate(session, data);
        count += 1;
      }

      return { count };
    },
  };

  const tx = {
    deviceAgentSession,
    $queryRaw: async () => undefined,
  };

  const prisma = {
    deviceAgentSession,
    $queryRaw: async () => undefined,
    $transaction: async <TResult>(callback: (transaction: typeof tx) => Promise<TResult>) => callback(tx),
  };

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: prisma as never,
    codec: {
      keyVersion: "v1",
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  });

  return {
    sessions,
    store,
  };
}

describe("PrismaDeviceSyncControlPlaneStore agent sessions", () => {
  it("creates hosted agent sessions with the hosted random id shape", async () => {
    const { sessions, store } = createSessionStore([]);
    const suffix = hostedRandomSuffix(12);

    const created = await store.createAgentSession({
      user: {
        id: "user-123",
        email: "user@example.test",
        name: "Example User",
        source: "trusted-header",
      },
      label: "Mac mini",
      tokenHash: "hash-created",
      now: "2026-03-25T00:00:00.000Z",
      expiresAt: "2026-03-26T00:00:00.000Z",
    });

    expect(created.id).toBe(`dsa_${suffix}`);
    expect(created.id).not.toMatch(/^[a-z0-9-]+_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(sessions.get(created.id)).toMatchObject({
      id: `dsa_${suffix}`,
      userId: "user-123",
      tokenHash: "hash-created",
      label: "Mac mini",
    });
  });

  it("revokes expired sessions during bearer lookup", async () => {
    const { sessions, store } = createSessionStore([
      {
        id: "dsa_expired",
        userId: "user-123",
        label: "Old agent",
        tokenHash: "hash-expired",
        createdAt: new Date("2026-03-24T00:00:00.000Z"),
        updatedAt: new Date("2026-03-24T00:00:00.000Z"),
        expiresAt: new Date("2026-03-24T12:00:00.000Z"),
        lastSeenAt: new Date("2026-03-24T11:00:00.000Z"),
        revokedAt: null,
        revokeReason: null,
        replacedBySessionId: null,
      },
    ]);

    const result = await store.authenticateAgentSessionByTokenHash("hash-expired", "2026-03-25T00:00:00.000Z");

    expect(result.status).toBe("expired");
    expect(result.session).toMatchObject({
      id: "dsa_expired",
      revokedAt: "2026-03-25T00:00:00.000Z",
      revokeReason: "expired",
    });
    expect(sessions.get("dsa_expired")).toMatchObject({
      revokeReason: "expired",
      replacedBySessionId: null,
    });
    expect(sessions.get("dsa_expired")?.revokedAt?.toISOString()).toBe("2026-03-25T00:00:00.000Z");
  });

  it("rotates active sessions into a replacement record", async () => {
    const { sessions, store } = createSessionStore([
      {
        id: "dsa_active",
        userId: "user-123",
        label: "Mac mini",
        tokenHash: "hash-active",
        createdAt: new Date("2026-03-25T00:00:00.000Z"),
        updatedAt: new Date("2026-03-25T00:00:00.000Z"),
        expiresAt: new Date("2026-03-26T00:00:00.000Z"),
        lastSeenAt: new Date("2026-03-25T00:00:00.000Z"),
        revokedAt: null,
        revokeReason: null,
        replacedBySessionId: null,
      },
    ]);
    const suffix = hostedRandomSuffix(12);

    const rotated = await store.rotateAgentSession({
      sessionId: "dsa_active",
      tokenHash: "hash-rotated",
      now: "2026-03-25T01:00:00.000Z",
      expiresAt: "2026-03-26T01:00:00.000Z",
    });

    const prior = sessions.get("dsa_active");
    const replacement = sessions.get(rotated.id);

    expect(rotated).toMatchObject({
      id: `dsa_${suffix}`,
      userId: "user-123",
      label: "Mac mini",
      expiresAt: "2026-03-26T01:00:00.000Z",
      revokedAt: null,
      revokeReason: null,
      replacedBySessionId: null,
    });
    expect(rotated.id).not.toBe("dsa_active");
    expect(rotated.id).not.toMatch(/^[a-z0-9-]+_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(prior?.revokedAt?.toISOString()).toBe("2026-03-25T01:00:00.000Z");
    expect(prior).toMatchObject({
      revokeReason: "rotated",
      replacedBySessionId: `dsa_${suffix}`,
    });
    expect(replacement).toMatchObject({
      id: `dsa_${suffix}`,
      tokenHash: "hash-rotated",
      userId: "user-123",
    });
  });
});

function findSessionByTokenHash(
  sessions: Map<string, MutableAgentSession>,
  tokenHash: string,
): MutableAgentSession | null {
  for (const session of sessions.values()) {
    if (session.tokenHash === tokenHash) {
      return session;
    }
  }

  return null;
}

function matchesWhere(session: MutableAgentSession, where: Record<string, unknown>): boolean {
  if (typeof where.id === "string" && session.id !== where.id) {
    return false;
  }

  if (typeof where.tokenHash === "string" && session.tokenHash !== where.tokenHash) {
    return false;
  }

  if ("revokedAt" in where && where.revokedAt === null && session.revokedAt !== null) {
    return false;
  }

  if (isRecord(where.expiresAt) && where.expiresAt.gt instanceof Date && !(session.expiresAt > where.expiresAt.gt)) {
    return false;
  }

  return true;
}

function applyUpdate(session: MutableAgentSession, data: Record<string, unknown>): void {
  if (data.updatedAt instanceof Date) {
    session.updatedAt = new Date(data.updatedAt);
  }

  if (data.expiresAt instanceof Date) {
    session.expiresAt = new Date(data.expiresAt);
  }

  if ("label" in data) {
    session.label = data.label === null || typeof data.label === "string" ? data.label : session.label;
  }

  if ("tokenHash" in data && typeof data.tokenHash === "string") {
    session.tokenHash = data.tokenHash;
  }

  if ("lastSeenAt" in data) {
    session.lastSeenAt = data.lastSeenAt instanceof Date ? new Date(data.lastSeenAt) : null;
  }

  if ("revokedAt" in data) {
    session.revokedAt = data.revokedAt instanceof Date ? new Date(data.revokedAt) : null;
  }

  if ("revokeReason" in data) {
    session.revokeReason = data.revokeReason === null || typeof data.revokeReason === "string" ? data.revokeReason : session.revokeReason;
  }

  if ("replacedBySessionId" in data) {
    session.replacedBySessionId =
      data.replacedBySessionId === null || typeof data.replacedBySessionId === "string"
        ? data.replacedBySessionId
        : session.replacedBySessionId;
  }
}

function normalizeSessionRecord(data: Record<string, unknown>): MutableAgentSession {
  if (
    typeof data.id !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.tokenHash !== "string" ||
    !(data.createdAt instanceof Date) ||
    !(data.updatedAt instanceof Date) ||
    !(data.expiresAt instanceof Date)
  ) {
    throw new TypeError("Invalid session record.");
  }

  return {
    id: data.id,
    userId: data.userId,
    label: typeof data.label === "string" ? data.label : null,
    tokenHash: data.tokenHash,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
    expiresAt: new Date(data.expiresAt),
    lastSeenAt: data.lastSeenAt instanceof Date ? new Date(data.lastSeenAt) : null,
    revokedAt: data.revokedAt instanceof Date ? new Date(data.revokedAt) : null,
    revokeReason: typeof data.revokeReason === "string" ? data.revokeReason : null,
    replacedBySessionId: typeof data.replacedBySessionId === "string" ? data.replacedBySessionId : null,
  };
}

function cloneSession(session: MutableAgentSession | null): MutableAgentSession | null {
  if (!session) {
    return null;
  }

  return {
    ...session,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
    expiresAt: new Date(session.expiresAt),
    lastSeenAt: session.lastSeenAt ? new Date(session.lastSeenAt) : null,
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
  };
}

function hostedRandomSuffix(length: number): string {
  return Buffer.from(Array.from({ length }, (_, index) => index)).toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
