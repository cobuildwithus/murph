import { PrismaClient } from "@prisma/client";

import type { ConsumeOAuthStateResult, OAuthStateRecord } from "@murphai/device-syncd/public-ingress";

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
        userId: typeof input.metadata?.ownerId === "string" ? input.metadata.ownerId : null,
        provider: input.provider,
        returnTo: input.returnTo,
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
        await tx.deviceOauthSession.delete({
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

      await tx.deviceOauthSession.delete({
        where: {
          state,
        },
      });

      return {
        status: "consumed",
        record: {
          state: record.state,
          provider: record.provider,
          returnTo: record.returnTo,
          metadata: record.userId ? { ownerId: record.userId } : {},
          createdAt: record.createdAt.toISOString(),
          expiresAt: record.expiresAt.toISOString(),
        } satisfies OAuthStateRecord,
      };
    });
  }
}
