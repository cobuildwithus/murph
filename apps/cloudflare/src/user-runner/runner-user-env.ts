import {
  createHostedUserEnvStore,
  type R2BucketLike,
} from "../bundle-store.js";
import {
  decodeHostedUserEnvPayload,
} from "../user-env.js";

export class RunnerUserEnvService {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly userEnvEncryptionKey: Uint8Array,
    private readonly userEnvEncryptionKeyId: string,
    private readonly userEnvEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly allowedUserEnvSource: Readonly<Record<string, string | undefined>>,
  ) {}

  async readUserEnv(userId: string): Promise<Record<string, string>> {
    return decodeHostedUserEnvPayload(
      await this.createUserEnvStore().readUserEnv(userId),
      this.allowedUserEnvSource,
    );
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
