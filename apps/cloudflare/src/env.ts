import {
  requireHostedExecutionVercelOidcValidationEnvironment,
  type HostedExecutionVercelOidcValidationEnvironment,
} from "./auth-adapter.ts";
import {
  readHostedExecutionWorkerEnvironment,
  type HostedExecutionWorkerEnvironment,
} from "./hosted-execution-worker-env.ts";
import type {
  HostedWorkerCryptoEnv,
} from "./hosted-crypto/runtime-crypto-context.ts";
import {
  assertHostedLocalInternalProxyEnvironment,
} from "./local-loopback-proxy.ts";
import {
  readHostedWebCallbackSigningEnvironment,
  type HostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";
import type { StringEnvSource } from "./string-env.ts";

export type HostedExecutionEnvironment = HostedExecutionWorkerEnvironment & {
  hostedCrypto: HostedWorkerCryptoEnv;
  vercelOidcValidation: HostedExecutionVercelOidcValidationEnvironment;
  webCallbackSigning: HostedWebCallbackSigningEnvironment;
};

export function readHostedExecutionEnvironment(
  source: StringEnvSource = process.env,
): HostedExecutionEnvironment {
  assertHostedLocalInternalProxyEnvironment(source);
  const workerEnvironment = readHostedExecutionWorkerEnvironment(source);

  return {
    ...workerEnvironment,
    hostedCrypto: {
      ...(workerEnvironment.hostedCryptoAuthoritySignKeyVersion
        ? {
            HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
              workerEnvironment.hostedCryptoAuthoritySignKeyVersion,
          }
        : {}),
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
        workerEnvironment.hostedCryptoAuthoritySignPublicKeyPem,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        workerEnvironment.hostedCryptoCloudflareAutomationKeyId,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
        workerEnvironment.hostedCryptoCloudflareAutomationPrivateJwk,
      HOSTED_CRYPTO_ENV: workerEnvironment.hostedCryptoEnv,
      ...(source.NODE_ENV ? { NODE_ENV: source.NODE_ENV } : {}),
      ...(source.VERCEL_ENV ? { VERCEL_ENV: source.VERCEL_ENV } : {}),
    },
    vercelOidcValidation: requireHostedExecutionVercelOidcValidationEnvironment(source),
    webCallbackSigning: readHostedWebCallbackSigningEnvironment(source),
  };
}
