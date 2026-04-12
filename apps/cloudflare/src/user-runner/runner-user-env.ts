import { readHostedVerifiedEmailFromEnv } from "@murphai/runtime-state";
import type { CloudflareHostedUserEnvStatus } from "@murphai/cloudflare-hosted-control";

import {
  ensureHostedEmailVerifiedSenderRouteAvailable,
  reconcileHostedEmailVerifiedSenderRoute,
  type HostedEmailConfig,
} from "../hosted-email.js";
import {
  createHostedUserEnvStore,
  type HostedUserEnvStore,
  type R2BucketLike,
} from "../bundle-store.js";
import {
  applyHostedUserEnvUpdate,
  decodeHostedUserEnvPayload,
  encodeHostedUserEnvPayload,
  listHostedUserEnvKeys,
  type HostedUserEnvUpdate,
} from "../user-env.js";

export class RunnerUserEnvService {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly userEnvEncryptionKey: Uint8Array,
    private readonly userEnvEncryptionKeyId: string,
    private readonly userEnvEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly emailRouteEncryptionKey: Uint8Array,
    private readonly emailRouteEncryptionKeyId: string,
    private readonly emailRouteEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly allowedUserEnvSource: Readonly<Record<string, string | undefined>>,
    private readonly hostedEmailConfig: HostedEmailConfig,
  ) {}

  async readUserEnv(userId: string): Promise<Record<string, string>> {
    return decodeHostedUserEnvPayload(
      await this.createUserEnvStore().readUserEnv(userId),
      this.allowedUserEnvSource,
    );
  }

  async updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<CloudflareHostedUserEnvStatus> {
    const currentUserEnv = await this.readUserEnv(userId);
    const nextUserEnv = applyHostedUserEnvUpdate({
      current: currentUserEnv,
      source: this.allowedUserEnvSource,
      update,
    });
    const previousVerifiedEmailAddress = readHostedVerifiedEmailFromEnv(currentUserEnv)?.address ?? null;
    const nextVerifiedEmailAddress = readHostedVerifiedEmailFromEnv(nextUserEnv)?.address ?? null;
    const configuredUserEnvKeys = listHostedUserEnvKeys(nextUserEnv);

    await ensureHostedEmailVerifiedSenderRouteAvailable({
      bucket: this.bucket,
      config: this.hostedEmailConfig,
      key: this.emailRouteEncryptionKey,
      keyId: this.emailRouteEncryptionKeyId,
      keysById: this.emailRouteEncryptionKeysById,
      userId,
      verifiedEmailAddress: nextVerifiedEmailAddress,
    });

    const userEnvStore = this.createUserEnvStore();
    const shouldDeactivateVerifiedEmailRoute = Boolean(
      previousVerifiedEmailAddress && !nextVerifiedEmailAddress,
    );
    let mutationAttempted = false;

    try {
      if (shouldDeactivateVerifiedEmailRoute) {
        mutationAttempted = true;
        await this.reconcileVerifiedEmailRoute({
          nextVerifiedEmailAddress,
          previousVerifiedEmailAddress,
          userId,
        });
      }

      mutationAttempted = true;
      await this.persistHostedUserEnv(userEnvStore, userId, nextUserEnv);

      if (!shouldDeactivateVerifiedEmailRoute) {
        mutationAttempted = true;
        await this.reconcileVerifiedEmailRoute({
          nextVerifiedEmailAddress,
          previousVerifiedEmailAddress,
          userId,
        });
      }
    } catch (error) {
      if (!mutationAttempted) {
        throw error;
      }

      try {
        await this.restoreHostedUserEnvState({
          currentUserEnv,
          nextVerifiedEmailAddress,
          previousVerifiedEmailAddress,
          store: userEnvStore,
          userId,
        });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Hosted user env update failed and rollback also failed for ${userId}.`,
        );
      }

      throw error;
    }

    return {
      configuredUserEnvKeys,
      userId,
    };
  }

  private async persistHostedUserEnv(
    store: HostedUserEnvStore,
    userId: string,
    env: Record<string, string>,
  ): Promise<void> {
    if (Object.keys(env).length === 0) {
      await store.clearUserEnv(userId);
      return;
    }

    const payload = encodeHostedUserEnvPayload({
      env,
    });

    if (!payload) {
      throw new Error("Expected a hosted user env payload for a non-empty hosted user env.");
    }

    await store.writeUserEnv(userId, payload);
  }

  private async restoreHostedUserEnvState(input: {
    currentUserEnv: Record<string, string>;
    nextVerifiedEmailAddress: string | null;
    previousVerifiedEmailAddress: string | null;
    store: HostedUserEnvStore;
    userId: string;
  }): Promise<void> {
    if (input.previousVerifiedEmailAddress !== input.nextVerifiedEmailAddress) {
      await this.reconcileVerifiedEmailRoute({
        nextVerifiedEmailAddress: input.previousVerifiedEmailAddress,
        previousVerifiedEmailAddress: input.nextVerifiedEmailAddress,
        userId: input.userId,
      });
    }

    await this.persistHostedUserEnv(input.store, input.userId, input.currentUserEnv);
  }

  private async reconcileVerifiedEmailRoute(input: {
    nextVerifiedEmailAddress: string | null;
    previousVerifiedEmailAddress: string | null;
    userId: string;
  }): Promise<void> {
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket: this.bucket,
      config: this.hostedEmailConfig,
      key: this.emailRouteEncryptionKey,
      keyId: this.emailRouteEncryptionKeyId,
      keysById: this.emailRouteEncryptionKeysById,
      nextVerifiedEmailAddress: input.nextVerifiedEmailAddress,
      previousVerifiedEmailAddress: input.previousVerifiedEmailAddress,
      userId: input.userId,
    });
  }

  private createUserEnvStore() {
    return createHostedUserEnvStore({
      bucket: this.bucket,
      key: this.userEnvEncryptionKey,
      keyId: this.userEnvEncryptionKeyId,
      keysById: this.userEnvEncryptionKeysById,
    });
  }
}
