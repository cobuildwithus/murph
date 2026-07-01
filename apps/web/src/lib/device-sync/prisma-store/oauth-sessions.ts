import { PrismaClient } from "@prisma/client";

import type { ConsumeOAuthStateResult, OAuthStateRecord } from "@murphai/device-syncd/types";

import { toJsonRecord } from "../shared";
import { toPrismaJsonObject } from "./prisma-json";

export class PrismaHostedOAuthSessionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    const result = await this.prisma.deviceOauthSession.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(now),
        },
      },
    });
    return result.count;
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    await this.prisma.deviceOauthSession.create({
      data: {
        state: input.state,
        userId: input.ownerId ?? null,
        provider: input.provider,
        returnTo: input.returnTo,
        metadataJson: toPrismaJsonObject(input.metadata ?? {}),
        createdAt: new Date(input.createdAt),
        expiresAt: new Date(input.expiresAt),
      },
    });

    return input;
  }

  async consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.deviceOauthSession.findUnique({
        where: {
          state,
        },
      });

      if (!record) {
        return {
          status: "missing",
        };
      }

      if (record.expiresAt.getTime() <= Date.parse(now)) {
        await tx.deviceOauthSession.deleteMany({
          where: {
            state,
          },
        });
        return {
          status: "missing",
        };
      }

      if (expectedProvider && record.provider !== expectedProvider) {
        return {
          status: "provider_mismatch",
          provider: record.provider,
        };
      }

      if (expectedOwnerId && record.userId !== expectedOwnerId) {
        return {
          status: "owner_mismatch",
        };
      }

      // Delete with a count check so duplicate callbacks or retries fail closed as
      // already-consumed/missing instead of surfacing as a transaction error.
      const deleteResult = await tx.deviceOauthSession.deleteMany({
        where: {
          state,
          provider: record.provider,
          ...(expectedOwnerId ? { userId: expectedOwnerId } : {}),
        },
      });

      if (deleteResult.count !== 1) {
        return {
          status: "missing",
        };
      }

      return {
        status: "consumed",
        record: {
          state: record.state,
          provider: record.provider,
          returnTo: record.returnTo,
          ownerId: record.userId,
          metadata: toJsonRecord(record.metadataJson),
          createdAt: record.createdAt.toISOString(),
          expiresAt: record.expiresAt.toISOString(),
        } satisfies OAuthStateRecord,
      };
    });
  }
}
