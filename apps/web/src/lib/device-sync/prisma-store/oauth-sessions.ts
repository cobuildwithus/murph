import { Prisma, PrismaClient } from "@prisma/client";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import type { ConsumeOAuthStateResult, OAuthStateRecord } from "@murphai/device-syncd/types";

import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
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

      if (record.expiresAt.getTime() <= Date.parse(input.now)) {
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
          consumedAt: new Date(input.now),
        },
        where: {
          state: input.state,
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
