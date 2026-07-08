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

      const stateRecord = {
        state: record.state,
        provider: record.provider,
        returnTo: record.returnTo,
        ownerId: record.userId,
        metadata: toJsonRecord(record.metadataJson),
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      } satisfies OAuthStateRecord;

      if (record.consumedAt !== null) {
        return {
          status: "replayed",
          record: stateRecord,
        };
      }

      // Mark with a count check instead of deleting so redelivered callbacks
      // and concurrent consumers resolve as replays of the earlier delivery
      // instead of failing as unknown. Consumed rows stay until the normal
      // expiry sweep removes them.
      const consumeResult = await tx.deviceOauthSession.updateMany({
        data: {
          consumedAt: new Date(now),
        },
        where: {
          state,
          consumedAt: null,
        },
      });

      if (consumeResult.count !== 1) {
        return {
          status: "replayed",
          record: stateRecord,
        };
      }

      return {
        status: "consumed",
        record: stateRecord,
      };
    });
  }
}
