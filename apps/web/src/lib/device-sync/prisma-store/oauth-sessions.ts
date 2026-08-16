import { Prisma, PrismaClient } from "@prisma/client";

import { deviceSyncError } from "@murphai/device-syncd/errors";

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
import type { DeviceProviderApplicationBinding } from "../provider-applications/types";
import {
  requireDeviceProviderApplicationRevision,
  requireMemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications/types";
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
      binding: null,
      expectedOwnerId,
      expectedProvider,
      now,
      state,
    });
  }

  discardUnconsumedOAuthStateWithProviderApplication(
    state: string,
    now: string,
    binding: DeviceProviderApplicationBinding,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<DiscardUnconsumedOAuthStateResult> {
    const provider = requireMemberOwnedDeviceProviderApplicationProvider(
      binding.provider,
    );
    const revision = requireDeviceProviderApplicationRevision(binding.revision);
    if (!binding.applicationId.trim()) {
      throw new TypeError(
        "Member-owned provider application OAuth discard requires an application id.",
      );
    }
    if (expectedProvider && expectedProvider !== provider) {
      throw new TypeError(
        "Member-owned provider application OAuth discard provider mismatch.",
      );
    }
    return this.discardUnconsumedOAuthStateInternal({
      binding: {
        applicationId: binding.applicationId,
        provider,
        revision,
      },
      expectedOwnerId,
      expectedProvider: provider,
      now,
      state,
    });
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return createOAuthStateRecord(this.prisma, input, null);
  }

  async createOAuthStateWithProviderApplication(
    input: OAuthStateRecord,
    binding: DeviceProviderApplicationBinding,
  ): Promise<OAuthStateRecord> {
    const ownerId = input.ownerId;
    if (!ownerId) {
      throw new TypeError(
        "Member-owned provider application OAuth state requires an owner.",
      );
    }
    const provider = requireMemberOwnedDeviceProviderApplicationProvider(
      binding.provider,
    );
    const revision = requireDeviceProviderApplicationRevision(binding.revision);
    if (!binding.applicationId.trim()) {
      throw new TypeError(
        "Member-owned provider application OAuth state requires an application id.",
      );
    }
    if (input.provider !== provider) {
      throw new TypeError(
        "Member-owned provider application OAuth state provider mismatch.",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, ownerId);
      const application = await tx.deviceProviderApplication.findFirst({
        select: { id: true },
        where: {
          id: binding.applicationId,
          memberId: ownerId,
          provider,
          revision,
          setups: {
            some: {
              active: true,
              memberId: ownerId,
              provider,
              providerApplicationRevision: revision,
              status: "oauth_in_progress",
            },
          },
        },
      });
      if (!application) {
        throw deviceSyncError({
          code: "PROVIDER_APPLICATION_STALE",
          httpStatus: 409,
          message: "Private provider application changed and must be reauthorized.",
          retryable: false,
        });
      }
      return createOAuthStateRecord(tx, input, {
        applicationId: binding.applicationId,
        provider,
        revision,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  }

  async readOAuthStateProviderApplicationBinding(input: {
    expectedOwnerId: string;
    expectedProvider: string;
    now: string;
    state: string;
  }): Promise<DeviceProviderApplicationBinding | null> {
    const record = await this.prisma.deviceOauthSession.findFirst({
      select: {
        provider: true,
        providerApplicationId: true,
        providerApplicationRevision: true,
        userId: true,
      },
      where: {
        expiresAt: { gt: new Date(input.now) },
        provider: input.expectedProvider,
        state: input.state,
        userId: input.expectedOwnerId,
      },
    });
    if (!record) {
      return null;
    }
    if (
      record.providerApplicationId === null
      && record.providerApplicationRevision === null
    ) {
      return null;
    }
    if (
      !record.providerApplicationId
      || record.providerApplicationRevision === null
    ) {
      throw new TypeError(
        "Stored OAuth state has an incomplete provider application binding.",
      );
    }
    return {
      applicationId: record.providerApplicationId,
      provider: requireMemberOwnedDeviceProviderApplicationProvider(
        record.provider,
      ),
      revision: requireDeviceProviderApplicationRevision(
        record.providerApplicationRevision,
      ),
    };
  }

  consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.consumeOAuthStateInternal({
      binding: null,
      expectedOwnerId,
      expectedProvider,
      now,
      state,
    });
  }

  consumeOAuthStateWithProviderApplication(
    state: string,
    now: string,
    binding: DeviceProviderApplicationBinding,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    const provider = requireMemberOwnedDeviceProviderApplicationProvider(
      binding.provider,
    );
    const revision = requireDeviceProviderApplicationRevision(binding.revision);
    if (!binding.applicationId.trim()) {
      throw new TypeError(
        "Member-owned provider application OAuth consume requires an application id.",
      );
    }
    if (expectedProvider && expectedProvider !== provider) {
      throw new TypeError(
        "Member-owned provider application OAuth consume provider mismatch.",
      );
    }
    return this.consumeOAuthStateInternal({
      binding: {
        applicationId: binding.applicationId,
        provider,
        revision,
      },
      expectedOwnerId,
      expectedProvider: provider,
      now,
      state,
    });
  }

  private async consumeOAuthStateInternal(input: {
    binding: DeviceProviderApplicationBinding | null;
    expectedOwnerId?: string;
    expectedProvider?: string;
    now: string;
    state: string;
  }): Promise<ConsumeOAuthStateResult> {
    return this.prisma.$transaction(async (tx) => {
      // The hourly retention owner skips locked rows. Own this exact state
      // before classifying it so cleanup cannot turn a first consume into a
      // fabricated replay between the read and the conditional update.
      await tx.$queryRaw<Array<{ state: string }>>`
        SELECT oauth_session."state"
        FROM "device_oauth_session" AS oauth_session
        WHERE oauth_session."state" = ${input.state}
        FOR UPDATE OF oauth_session
      `;
      const record = await tx.deviceOauthSession.findUnique({
        where: {
          state: input.state,
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

      if (
        input.binding
        && (
          record.provider !== input.binding.provider
          || record.providerApplicationId !== input.binding.applicationId
          || record.providerApplicationRevision !== input.binding.revision
        )
      ) {
        throw deviceSyncError({
          code: "PROVIDER_APPLICATION_STALE",
          httpStatus: 409,
          message: "OAuth state does not match the private provider application.",
          retryable: false,
        });
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
        await lockHostedMemberRow(tx, record.userId);
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
    binding: DeviceProviderApplicationBinding | null;
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
      if (
        input.binding
        && (
          record.provider !== input.binding.provider
          || record.providerApplicationId !== input.binding.applicationId
          || record.providerApplicationRevision !== input.binding.revision
        )
      ) {
        throw deviceSyncError({
          code: "PROVIDER_APPLICATION_STALE",
          httpStatus: 409,
          message: "OAuth state does not match the private provider application.",
          retryable: false,
        });
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
  binding: DeviceProviderApplicationBinding | null,
): Promise<OAuthStateRecord> {
  await prisma.deviceOauthSession.create({
    data: {
      state: input.state,
      userId: input.ownerId ?? null,
      provider: input.provider,
      providerApplicationId: binding?.applicationId ?? null,
      providerApplicationRevision: binding?.revision ?? null,
      returnTo: input.returnTo,
      metadataJson: toPrismaJsonObject(input.metadata ?? {}),
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
    },
  });

  return input;
}
