import { readHostedVerifiedEmailFromEnv } from "@murphai/runtime-state";
import type { HostedExecutionUserEnvStatus } from "@murphai/hosted-execution";

import {
  ensureHostedEmailVerifiedSenderRouteAvailable,
  reconcileHostedEmailVerifiedSenderRoute,
  type HostedEmailConfig,
} from "../hosted-email.js";
import {
  createHostedUserEnvStore,
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
    private readonly bundleEncryptionKey: Uint8Array,
    private readonly bundleEncryptionKeyId: string,
    private readonly bundleEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
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
  ): Promise<HostedExecutionUserEnvStatus> {
    const currentUserEnv = await this.readUserEnv(userId);
    const nextUserEnv = applyHostedUserEnvUpdate({
      current: currentUserEnv,
      source: this.allowedUserEnvSource,
      update,
    });
    const previousVerifiedEmailAddress = readHostedVerifiedEmailFromEnv(currentUserEnv)?.address ?? null;
    const nextVerifiedEmailAddress = readHostedVerifiedEmailFromEnv(nextUserEnv)?.address ?? null;

    await ensureHostedEmailVerifiedSenderRouteAvailable({
      bucket: this.bucket,
      config: this.hostedEmailConfig,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
      userId,
      verifiedEmailAddress: nextVerifiedEmailAddress,
    });

    const userEnvStore = this.createUserEnvStore();

    if (Object.keys(nextUserEnv).length === 0) {
      await userEnvStore.clearUserEnv(userId);
      await reconcileHostedEmailVerifiedSenderRoute({
        bucket: this.bucket,
        config: this.hostedEmailConfig,
        key: this.bundleEncryptionKey,
        keyId: this.bundleEncryptionKeyId,
        keysById: this.bundleEncryptionKeysById,
        nextVerifiedEmailAddress,
        previousVerifiedEmailAddress,
        userId,
      });
      return {
        configuredUserEnvKeys: [],
        userId,
      };
    }

    const payload = encodeHostedUserEnvPayload({
      env: nextUserEnv,
    });

    if (!payload) {
      throw new Error("Expected a hosted user env payload for a non-empty hosted user env.");
    }

    await userEnvStore.writeUserEnv(userId, payload);
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket: this.bucket,
      config: this.hostedEmailConfig,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
      nextVerifiedEmailAddress,
      previousVerifiedEmailAddress,
      userId,
    });

    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(nextUserEnv),
      userId,
    };
  }

  private createUserEnvStore() {
    return createHostedUserEnvStore({
      bucket: this.bucket,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
    });
  }
}
