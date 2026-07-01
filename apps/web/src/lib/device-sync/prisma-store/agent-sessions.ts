import { createHash, randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import type { AuthenticatedHostedUser } from "../auth";
import { generateHostedRandomPrefixedId, maybeIsoTimestamp, toIsoTimestamp } from "../shared";
import type {
  HostedAgentSessionAuthResult,
  HostedAgentSessionRecord,
} from "./types";

type HostedAgentSessionPrismaRecord = Prisma.DeviceAgentSessionGetPayload<Prisma.DeviceAgentSessionDefaultArgs>;

export class PrismaHostedAgentSessionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createAgentSession(input: {
    user: AuthenticatedHostedUser;
    label?: string | null;
    tokenHash: string;
    now?: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    const now = input.now ?? toIsoTimestamp(new Date());
    const record = await this.prisma.deviceAgentSession.create({
      data: {
        id: generateHostedRandomPrefixedId("dsa"),
        userId: input.user.id,
        label: input.label ?? null,
        tokenHash: input.tokenHash,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        expiresAt: new Date(input.expiresAt),
        lastSeenAt: new Date(now),
      },
    });

    return mapHostedAgentSessionRecord(record);
  }

  async authenticateAgentSessionByTokenHash(tokenHash: string, now: string): Promise<HostedAgentSessionAuthResult> {
    const nowDate = new Date(now);
    const touched = await this.prisma.deviceAgentSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: nowDate,
        },
      },
      data: {
        lastSeenAt: nowDate,
      },
    });
    const record = await this.prisma.deviceAgentSession.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!record) {
      return {
        status: "missing",
        session: null,
      };
    }

    if (touched.count === 1 && !record.revokedAt && record.expiresAt.getTime() > nowDate.getTime()) {
      return {
        status: "active",
        session: mapHostedAgentSessionRecord(record),
      };
    }

    if (record.revokedAt) {
      return {
        status: "revoked",
        session: mapHostedAgentSessionRecord(record),
      };
    }

    if (record.expiresAt.getTime() <= nowDate.getTime()) {
      return {
        status: "expired",
        session: await this.revokeAgentSession({
          sessionId: record.id,
          now,
          reason: "expired",
        }),
      };
    }

    return {
      status: "missing",
      session: null,
    };
  }

  async touchAgentSession(input: {
    sessionId: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const touched = await tx.deviceAgentSession.updateMany({
        where: {
          id: input.sessionId,
          revokedAt: null,
          expiresAt: {
            gt: new Date(input.now),
          },
        },
        data: {
          expiresAt: new Date(input.expiresAt),
          lastSeenAt: new Date(input.now),
          updatedAt: new Date(input.now),
        },
      });

      if (touched.count !== 1) {
        throw createInactiveAgentSessionError();
      }

      const record = await tx.deviceAgentSession.findUnique({
        where: {
          id: input.sessionId,
        },
      });

      if (!record) {
        throw createInactiveAgentSessionError();
      }

      return mapHostedAgentSessionRecord(record);
    });
  }

  async rotateAgentSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    const replacementSessionId = generateHostedRandomPrefixedId("dsa");

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceAgentSession.findFirst({
        where: {
          id: input.sessionId,
          revokedAt: null,
          expiresAt: {
            gt: new Date(input.now),
          },
        },
      });

      if (!existing) {
        throw createInactiveAgentSessionError();
      }

      const revoked = await tx.deviceAgentSession.updateMany({
        where: {
          id: input.sessionId,
          revokedAt: null,
          expiresAt: {
            gt: new Date(input.now),
          },
        },
        data: {
          revokedAt: new Date(input.now),
          revokeReason: "rotated",
          replacedBySessionId: replacementSessionId,
          updatedAt: new Date(input.now),
        },
      });

      if (revoked.count !== 1) {
        throw createInactiveAgentSessionError();
      }

      const record = await tx.deviceAgentSession.create({
        data: {
          id: replacementSessionId,
          userId: existing.userId,
          label: existing.label,
          tokenHash: input.tokenHash,
          createdAt: new Date(input.now),
          updatedAt: new Date(input.now),
          expiresAt: new Date(input.expiresAt),
          lastSeenAt: new Date(input.now),
        },
      });

      return mapHostedAgentSessionRecord(record);
    });
  }

  async revokeAgentSession(input: {
    sessionId: string;
    now: string;
    reason: string;
    replacedBySessionId?: string | null;
  }): Promise<HostedAgentSessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.deviceAgentSession.updateMany({
        where: {
          id: input.sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(input.now),
          revokeReason: input.reason,
          ...(input.replacedBySessionId !== undefined
            ? {
                replacedBySessionId: input.replacedBySessionId,
              }
            : {}),
          updatedAt: new Date(input.now),
        },
      });

      const record = await tx.deviceAgentSession.findUnique({
        where: {
          id: input.sessionId,
        },
      });

      return record ? mapHostedAgentSessionRecord(record) : null;
    });
  }
}

function mapHostedAgentSessionRecord(record: HostedAgentSessionPrismaRecord): HostedAgentSessionRecord {
  return {
    id: record.id,
    userId: record.userId,
    label: record.label,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    lastSeenAt: maybeIsoTimestamp(record.lastSeenAt),
    revokedAt: maybeIsoTimestamp(record.revokedAt),
    revokeReason: record.revokeReason ?? null,
    replacedBySessionId: record.replacedBySessionId ?? null,
  } satisfies HostedAgentSessionRecord;
}

export function generateHostedAgentBearerToken(): { token: string; tokenHash: string } {
  const token = `hbds_agent_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

function createInactiveAgentSessionError() {
  return deviceSyncError({
    code: "AGENT_AUTH_INVALID",
    message: "Hosted device-sync agent bearer token is no longer active.",
    retryable: false,
    httpStatus: 401,
  });
}
