import {
  createHostedRunnerSecretsReader,
  type R2BucketLike,
} from "../bundle-store.js";
import {
  decodeHostedRunnerSecretsPayload,
} from "../runner-secrets.js";

export class RunnerSecretsService {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly runnerSecretsEncryptionKey: Uint8Array,
    private readonly runnerSecretsEncryptionKeyId: string,
    private readonly runnerSecretsEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
    private readonly resolveRunnerSecretsEncryptionKeyById: (keyId: string) => Promise<Uint8Array | null>,
    private readonly allowedRunnerSecretsSource: Readonly<Record<string, string | undefined>>,
  ) {}

  async readRunnerSecrets(userId: string): Promise<Record<string, string>> {
    return decodeHostedRunnerSecretsPayload(
      await this.createRunnerSecretsReader().readRunnerSecrets(userId),
      this.allowedRunnerSecretsSource,
    );
  }

  private createRunnerSecretsReader() {
    return createHostedRunnerSecretsReader({
      bucket: this.bucket,
      key: this.runnerSecretsEncryptionKey,
      keyId: this.runnerSecretsEncryptionKeyId,
      keysById: this.runnerSecretsEncryptionKeysById,
      resolveKeyById: this.resolveRunnerSecretsEncryptionKeyById,
    });
  }
}
