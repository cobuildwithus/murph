import { createHostedRunnerSecretsReader, type R2BucketLike } from "../bundle-store.ts";
import type { HostedExecutionEnvironment } from "../env.ts";
import { readHostedRunnerAllowedSecretKeys } from "../hosted-env-policy.ts";
import {
  requireHostedUserCryptoContextFromEnvironment,
  type HostedUserCryptoContext,
} from "../hosted-crypto/runtime-user-crypto-context.ts";
import { decodeHostedRunnerSecretsPayload } from "../runner-secrets.ts";

export interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  readRunnerSecrets(): Promise<Record<string, string>>;
  userId: string;
}

/** Load one invocation's member inputs. The crypto owner controls key lifetime. */
export async function loadRunnerStores(input: {
  bucket: R2BucketLike;
  env: HostedExecutionEnvironment;
  userId: string;
  webControlTimeoutMs?: number;
}): Promise<RunnerUserStores> {
  const crypto = await requireHostedUserCryptoContextFromEnvironment({
    bucket: input.bucket,
    domain: "runtime",
    environment: input.webControlTimeoutMs === undefined
      ? input.env
      : { ...input.env, webControlTimeoutMs: input.webControlTimeoutMs },
    reason: "runner-store-refresh",
    userId: input.userId,
  });
  const allowedSecrets = {
    HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: input.env.allowedRunnerSecretKeys ?? undefined,
  };
  return {
    crypto,
    userId: input.userId,
    async readRunnerSecrets() {
      if (readHostedRunnerAllowedSecretKeys(allowedSecrets).size === 0) {
        return {};
      }
      const reader = createHostedRunnerSecretsReader({
        bucket: input.bucket,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        resolveKeyById: crypto.resolveKeyById,
      });
      return decodeHostedRunnerSecretsPayload(await reader.readRunnerSecrets(input.userId), allowedSecrets);
    },
  };
}
