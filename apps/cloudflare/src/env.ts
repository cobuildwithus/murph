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
  const workerEnvironment = readHostedExecutionWorkerEnvironment(source, {
    allowHostedWebHttpHosts: readHostedLocalProxyHttpHostAllowlist(source),
  });

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
      ...(workerEnvironment.hostedCryptoAuthorityVerifyKeyringJson
        ? {
            HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON:
              workerEnvironment.hostedCryptoAuthorityVerifyKeyringJson,
          }
        : {}),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        workerEnvironment.hostedCryptoCloudflareAutomationKeyId,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
        workerEnvironment.hostedCryptoCloudflareAutomationPrivateJwk,
      ...(workerEnvironment.hostedCryptoCloudflareAutomationPrivateKeyringJson
        ? {
            HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
              workerEnvironment.hostedCryptoCloudflareAutomationPrivateKeyringJson,
          }
        : {}),
      HOSTED_CRYPTO_ENV: workerEnvironment.hostedCryptoEnv,
      ...(source.NODE_ENV ? { NODE_ENV: source.NODE_ENV } : {}),
      ...(source.VERCEL_ENV ? { VERCEL_ENV: source.VERCEL_ENV } : {}),
    },
    vercelOidcValidation: requireHostedExecutionVercelOidcValidationEnvironment(source),
    webCallbackSigning: readHostedWebCallbackSigningEnvironment(source),
  };
}

function readHostedLocalProxyHttpHostAllowlist(
  source: StringEnvSource,
): readonly string[] | undefined {
  const localInternalProxyBaseUrl =
    source.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL?.trim();

  if (
    !localInternalProxyBaseUrl
    || source.ALLOW_LOCAL_INTERNAL_PROXY?.trim() !== "true"
    || source.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?.trim() !== "development"
  ) {
    return undefined;
  }

  const url = new URL(localInternalProxyBaseUrl);

  return url.protocol.toLowerCase() === "http:" ? [url.hostname] : undefined;
}
