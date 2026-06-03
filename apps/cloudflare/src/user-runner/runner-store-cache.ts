import type { R2BucketLike } from "../bundle-store.js";
import type { HostedExecutionEnvironment } from "../env.js";
import {
  isHostedUserCryptoContextExpired,
  requireHostedUserCryptoContextFromEnvironment,
  type HostedUserCryptoContext,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import { withSerializedLock } from "../serialized-lock.js";
import { toStringEnvSource } from "../string-env.js";
import { RunnerSecretsService } from "./runner-secrets.js";

export interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

export class RunnerStoreCache {
  private runnerStores: RunnerUserStores | null = null;
  private runtimeCryptoContextLock: Promise<void> | null = null;

  constructor(
    private readonly input: {
      bucket: R2BucketLike;
      env: HostedExecutionEnvironment;
      runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
    },
  ) {}

  async ensure(
    userId: string,
    input: { webControlTimeoutMs?: number } = {},
  ): Promise<RunnerUserStores> {
    const cached = this.readReusable(userId);
    if (cached && !this.runtimeCryptoContextLock) {
      return cached;
    }

    return this.withRuntimeCryptoContextLock(async () => {
      const lockedCached = this.readReusable(userId);
      if (lockedCached) {
        return lockedCached;
      }

      return this.refresh(userId, input);
    });
  }

  clearIfUser(userId: string): void {
    if (this.runnerStores?.userId === userId) {
      this.runnerStores = null;
    }
  }

  readRuntimeConfigSource(): Readonly<Record<string, string | undefined>> {
    return {
      ...this.readWorkerStringEnvSource(),
      ...this.readAllowedRunnerSecretsSource(),
    };
  }

  private readReusable(userId: string): RunnerUserStores | null {
    return this.runnerStores?.userId === userId
      && !isHostedUserCryptoContextExpired(this.runnerStores.crypto)
      ? this.runnerStores
      : null;
  }

  private async refresh(
    userId: string,
    input: { webControlTimeoutMs?: number } = {},
  ): Promise<RunnerUserStores> {
    const stores = await this.createStores(userId, input);
    this.runnerStores = stores;
    return stores;
  }

  private async createStores(
    userId: string,
    input: { webControlTimeoutMs?: number } = {},
  ): Promise<RunnerUserStores> {
    const crypto = await requireHostedUserCryptoContextFromEnvironment({
      bucket: this.input.bucket,
      domain: "runtime",
      environment: input.webControlTimeoutMs === undefined
        ? this.input.env
        : {
            ...this.input.env,
            webControlTimeoutMs: input.webControlTimeoutMs,
          },
      reason: "runner-store-refresh",
      userId,
    });

    return {
      crypto,
      runnerSecrets: this.createRunnerSecretsService(crypto),
      userId,
    };
  }

  private createRunnerSecretsService(crypto: HostedUserCryptoContext): RunnerSecretsService {
    return new RunnerSecretsService(
      this.input.bucket,
      crypto.rootKey,
      crypto.rootKeyId,
      crypto.keysById,
      crypto.resolveKeyById,
      this.readAllowedRunnerSecretsSource(),
    );
  }

  private readAllowedRunnerSecretsSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS:
        this.input.env.allowedRunnerSecretKeys ?? undefined,
    };
  }

  private readWorkerStringEnvSource(): Readonly<Record<string, string | undefined>> {
    return toStringEnvSource(this.input.runnerRuntimeEnvSource);
  }

  private async withRuntimeCryptoContextLock<T>(run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.runtimeCryptoContextLock,
        set: (value) => {
          this.runtimeCryptoContextLock = value;
        },
      },
      run,
    );
  }
}
