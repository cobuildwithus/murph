import { Prisma, PrismaClient } from "@prisma/client";

import {
  DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
  type ConsumeOAuthStateResult,
  type DiscardUnconsumedOAuthStateResult,
  type OAuthStateConsumeClaim,
  type OAuthStateRecord,
} from "@murphai/device-syncd/types";

import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  readHostedMemberSuspensionAfterLockTx,
} from "../../hosted-onboarding/shared";
import { toJsonRecord } from "../shared";
import { toPrismaJsonObject } from "./prisma-json";

export class PrismaHostedOAuthSessionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async deleteExpiredOAuthStates(_now?: string): Promise<number> {
    return 0;
  }

  async resolveOAuthStateWithoutProviderAuthority(
    claim: OAuthStateConsumeClaim,
  ): Promise<boolean> {
    const finalized = await this.prisma.deviceOauthSession.deleteMany({
      where: {
        consumedAt: new Date(claim.consumedAt),
        state: claim.state,
      },
    });
    return finalized.count === 1;
  }

  discardUnconsumedOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<DiscardUnconsumedOAuthStateResult> {
    return this.discardUnconsumedOAuthStateInternal({
      expectedOwnerId,
      expectedProvider,
      now,
      state,
    });
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return createOAuthStateRecord(this.prisma, input);
  }

  consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.consumeOAuthStateInternal({
      expectedOwnerId,
      expectedProvider,
      now,
      state,
    });
  }

  private async consumeOAuthStateInternal(input: {
    expectedOwnerId?: string;
    expectedProvider?: string;
    now: string;
    state: string;
  }): Promise<ConsumeOAuthStateResult> {
    const ownerHint = await this.prisma.deviceOauthSession.findUnique({
      select: { userId: true },
      where: { state: input.state },
    });
    if (!ownerHint) {
      return { status: "missing" };
    }

    return this.prisma.$transaction(async (tx) => {
      if (ownerHint.userId) {
        await lockHostedMemberRow(tx, ownerHint.userId);
      }

      // The hourly retention owner skips locked rows. Own this exact state
      // after the member lock so every member-bound OAuth mutation follows
      // member-then-state ordering. The locked reread below rejects a deleted
      // and recreated state instead of trusting the unlocked owner hint.
      await tx.$queryRaw<Array<{ state: string }>>`
        SELECT oauth_session."state"
        FROM "device_oauth_session" AS oauth_session
        WHERE oauth_session."state" = ${input.state}
        FOR UPDATE OF oauth_session
      `;
      const record = await tx.deviceOauthSession.findUnique({
        where: {
          state: input.state,
          userId: ownerHint.userId,
        },
      });

      if (!record) {
        return {
          status: "missing",
        };
      }

      if (
        record.consumedAt === null
        && record.expiresAt.getTime() <= Date.parse(input.now)
      ) {
        await tx.deviceOauthSession.deleteMany({
          where: {
            state: input.state,
          },
        });
        return {
          status: "missing",
        };
      }

      if (
        input.expectedProvider
        && record.provider !== input.expectedProvider
      ) {
        return {
          status: "provider_mismatch",
          provider: record.provider,
        };
      }

      if (input.expectedOwnerId && record.userId !== input.expectedOwnerId) {
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

      // Once provider work may have started, only the exact consume epoch may
      // remove the claim. In particular, a duplicate callback that reaches
      // this store after suspension must not erase the first callback's
      // durable provider-cleanup ownership.
      if (record.consumedAt !== null) {
        return {
          status: Date.parse(input.now) >= Math.max(
            record.expiresAt.getTime(),
            record.consumedAt.getTime()
              + DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
          )
            ? "recovery_required"
            : "replayed",
          consumedAt: record.consumedAt.toISOString(),
          record: stateRecord,
        };
      }

      if (record.userId) {
        const ownerStatus = await readHostedMemberSuspensionAfterLockTx(
          tx,
          record.userId,
        );
        if (ownerStatus !== "active") {
          await tx.deviceOauthSession.deleteMany({
            where: {
              consumedAt: null,
              state: input.state,
            },
          });
          return { status: "missing" };
        }
      }

      // Mark with a count check instead of deleting so redelivered callbacks
      // and concurrent consumers resolve as replays of the earlier delivery
      // instead of failing as unknown. Consumed rows stay until the normal
      // exact finalization removes them after provider completion or durable
      // cleanup ownership is established.
      const consumeResult = await tx.deviceOauthSession.updateMany({
        data: {
          consumedAt: new Date(input.now),
        },
        where: {
          state: input.state,
          consumedAt: null,
        },
      });

      if (consumeResult.count !== 1) {
        const replay = await tx.deviceOauthSession.findUnique({
          select: { consumedAt: true },
          where: { state: input.state },
        });
        if (!replay?.consumedAt) {
          return { status: "missing" };
        }
        return {
          status: "replayed",
          consumedAt: replay.consumedAt.toISOString(),
          record: stateRecord,
        };
      }

      return {
        status: "consumed",
        consumedAt: input.now,
        record: stateRecord,
      };
    });
  }

  private async discardUnconsumedOAuthStateInternal(input: {
    expectedOwnerId?: string;
    expectedProvider?: string;
    now: string;
    state: string;
  }): Promise<DiscardUnconsumedOAuthStateResult> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.deviceOauthSession.findUnique({
        where: { state: input.state },
      });
      if (!record) {
        return { status: "missing" };
      }
      if (
        record.consumedAt === null
        && record.expiresAt.getTime() <= Date.parse(input.now)
      ) {
        await tx.deviceOauthSession.deleteMany({
          where: { consumedAt: null, state: input.state },
        });
        return { status: "missing" };
      }
      if (input.expectedProvider && record.provider !== input.expectedProvider) {
        return { status: "provider_mismatch", provider: record.provider };
      }
      if (input.expectedOwnerId && record.userId !== input.expectedOwnerId) {
        return { status: "owner_mismatch" };
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
          status: Date.parse(input.now) >= Math.max(
            record.expiresAt.getTime(),
            record.consumedAt.getTime()
              + DEVICE_SYNC_OAUTH_CALLBACK_PROCESSING_LEASE_MS,
          )
            ? "recovery_required"
            : "replayed",
          consumedAt: record.consumedAt.toISOString(),
          record: stateRecord,
        };
      }

      if (record.userId) {
        await lockHostedMemberRow(tx, record.userId);
        const ownerStatus = await readHostedMemberSuspensionAfterLockTx(tx, record.userId);
        if (ownerStatus !== "active") {
          await tx.deviceOauthSession.deleteMany({
            where: { consumedAt: null, state: input.state },
          });
          return { status: "missing" };
        }
      }

      const discarded = await tx.deviceOauthSession.deleteMany({
        where: { consumedAt: null, state: input.state },
      });
      if (discarded.count !== 1) {
        const replay = await tx.deviceOauthSession.findUnique({
          select: { consumedAt: true },
          where: { state: input.state },
        });
        if (!replay?.consumedAt) {
          return { status: "missing" };
        }
        return {
          status: "replayed",
          consumedAt: replay.consumedAt.toISOString(),
          record: stateRecord,
        };
      }
      return { status: "discarded", record: stateRecord };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  }
}

async function createOAuthStateRecord(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: OAuthStateRecord,
): Promise<OAuthStateRecord> {
  await prisma.deviceOauthSession.create({
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
