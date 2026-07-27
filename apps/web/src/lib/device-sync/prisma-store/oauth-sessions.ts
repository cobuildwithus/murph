import { PrismaClient, type Prisma } from "@prisma/client";

import {
  DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY,
  type ConsumeOAuthStateResult,
  type OAuthStateRecord,
} from "@murphai/device-syncd/types";

import { toJsonRecord } from "../shared";
import { toPrismaJsonObject } from "./prisma-json";

export class PrismaHostedOAuthSessionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    const pendingStates = await this.prisma.deviceOauthSession.findMany({
      select: {
        state: true,
      },
      where: {
        expiresAt: {
          lte: new Date(now),
        },
        metadataJson: {
          path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
          equals: true,
        },
      },
    });

    const result = await this.prisma.deviceOauthSession.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(now),
        },
        ...(pendingStates.length > 0
          ? { state: { notIn: pendingStates.map((record) => record.state) } }
          : {}),
      },
    });
    return result.count;
  }

  async createOAuthState(
    input: OAuthStateRecord,
    prisma: Prisma.TransactionClient | PrismaClient = this.prisma,
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

  async replaceStagedConnectionStartOAuthState(
    input: OAuthStateRecord,
    prisma: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await prisma.deviceOauthSession.updateMany({
      data: {
        createdAt: new Date(input.createdAt),
        expiresAt: new Date(input.expiresAt),
        metadataJson: toPrismaJsonObject({
          ...(input.metadata ?? {}),
          [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
        }),
        provider: input.provider,
        returnTo: input.returnTo,
      },
      where: {
        metadataJson: {
          path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
          equals: true,
        },
        state: input.state,
        userId: input.ownerId ?? null,
      },
    });
    return result.count === 1;
  }

  async consumeStagedConnectionStart(
    input: {
      ownerId: string;
      provider: string;
      state: string;
    },
    prisma: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await prisma.deviceOauthSession.deleteMany({
      where: {
        metadataJson: {
          path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
          equals: true,
        },
        provider: input.provider,
        state: input.state,
        userId: input.ownerId,
      },
    });
    return result.count === 1;
  }

  async hasStagedConnectionStart(
    input: {
      ownerId: string;
      provider: string;
      state: string;
    },
    prisma: Prisma.TransactionClient,
  ): Promise<boolean> {
    const count = await prisma.deviceOauthSession.count({
      where: {
        metadataJson: {
          path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
          equals: true,
        },
        provider: input.provider,
        state: input.state,
        userId: input.ownerId,
      },
    });
    return count === 1;
  }

  async findStagedConnectionStartOwner(
    state: string,
    prisma: Prisma.TransactionClient,
  ): Promise<string | null> {
    const record = await prisma.deviceOauthSession.findUnique({
      select: {
        metadataJson: true,
        userId: true,
      },
      where: {
        state,
      },
    });
    return (
      record?.userId
      && toJsonRecord(record.metadataJson)[
        DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY
      ] === true
    )
      ? record.userId
      : null;
  }

  async hasConsumedStagedConnectionStart(
    input: {
      ownerId: string;
      provider: string;
      state: string;
    },
    prisma: Prisma.TransactionClient,
  ): Promise<boolean> {
    const count = await prisma.deviceOauthSession.count({
      where: {
        consumedAt: { not: null },
        metadataJson: {
          path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
          equals: true,
        },
        provider: input.provider,
        state: input.state,
        userId: input.ownerId,
      },
    });
    return count === 1;
  }

  async completeStagedOAuthConnectionCallback(
    input: {
      ownerId: string;
      provider: string;
      state: string;
    },
    prisma: Prisma.TransactionClient,
  ): Promise<boolean> {
    const record = await prisma.deviceOauthSession.findUnique({
      select: {
        consumedAt: true,
        metadataJson: true,
        provider: true,
        userId: true,
      },
      where: {
        state: input.state,
      },
    });
    const metadata = toJsonRecord(record?.metadataJson);
    if (
      !record
      || record.consumedAt === null
      || record.provider !== input.provider
      || record.userId !== input.ownerId
      || metadata[DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY] !== true
    ) {
      return false;
    }

    delete metadata[DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY];
    const result = await prisma.deviceOauthSession.updateMany({
      data: {
        metadataJson: toPrismaJsonObject(metadata),
      },
      where: {
        consumedAt: { not: null },
        metadataJson: {
          path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
          equals: true,
        },
        provider: input.provider,
        state: input.state,
        userId: input.ownerId,
      },
    });
    return result.count === 1;
  }

  async consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.prisma.$transaction((tx) =>
      this.consumeOAuthStateTx(
        state,
        now,
        expectedProvider,
        expectedOwnerId,
        tx,
      )
    );
  }

  async consumeOAuthStateTx(
    state: string,
    now: string,
    expectedProvider: string | undefined,
    expectedOwnerId: string | undefined,
    prisma: Prisma.TransactionClient,
  ): Promise<ConsumeOAuthStateResult> {
    const record = await prisma.deviceOauthSession.findUnique({
      where: {
        state,
      },
    });

    if (!record) {
      return {
        status: "missing",
      };
    }

    const pending = toJsonRecord(record.metadataJson)[
      DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY
    ] === true;

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
    const expired = record.expiresAt.getTime() <= Date.parse(now);

    if (record.consumedAt !== null && (pending || !expired)) {
      return {
        status: "replayed",
        record: stateRecord,
      };
    }

    if (expired) {
      if (!pending) {
        await prisma.deviceOauthSession.deleteMany({
          where: {
            state,
          },
        });
      }
      return {
        status: "missing",
      };
    }

    // Mark with a count check instead of deleting so redelivered callbacks
    // and concurrent consumers resolve as replays of the earlier delivery
    // instead of failing as unknown. Consumed rows stay until the normal
    // expiry sweep removes them. Pending consumed rows are preserved by that
    // sweep until the callback completes its lifecycle marker.
    const consumeResult = await prisma.deviceOauthSession.updateMany({
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
  }
}
