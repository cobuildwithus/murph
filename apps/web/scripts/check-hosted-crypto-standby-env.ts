import { pathToFileURL } from "node:url";

import {
  assertHostedCryptoStandbyKeyringJsons,
} from "@murphai/runtime-state";

type EnvSource = Readonly<Record<string, string | undefined>>;

export const HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR =
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON must not be configured in the Web runtime.";

export function listHostedCryptoStandbyEnvErrors(
  source: EnvSource = process.env,
  input: { requireCompletePreload?: boolean } = {},
): string[] {
  if (
    !input.requireCompletePreload
    && source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON?.trim()
  ) {
    return [HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR];
  }

  try {
    assertHostedCryptoStandbyKeyringJsons({
      authorityVerifyKeyringJson:
        source.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
      cloudflarePrivateKeyringJson:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
      cloudflarePublicKeyringJson:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON,
      requireCompletePreload: input.requireCompletePreload,
    });
    return [];
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : "Hosted crypto standby keyrings are invalid.",
    ];
  }
}

export function assertHostedCryptoStandbyEnv(
  source: EnvSource = process.env,
  input: { requireCompletePreload?: boolean } = {},
): void {
  const errors = listHostedCryptoStandbyEnvErrors(source, input);
  if (errors.length > 0) {
    throw new TypeError(errors.join(" "));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const allowedArgs = new Set(["--require-complete-preload"]);
  const unknownArg = args.find((arg) => !allowedArgs.has(arg));
  if (unknownArg) {
    console.error("Hosted crypto standby env check received an unknown option.");
    process.exitCode = 1;
  } else {
    try {
      assertHostedCryptoStandbyEnv(process.env, {
        requireCompletePreload: args.includes("--require-complete-preload"),
      });
      console.log("Hosted crypto standby environment preflight passed.");
    } catch (error) {
      console.error(
        error instanceof Error
          ? error.message
          : "Hosted crypto standby environment preflight failed.",
      );
      process.exitCode = 1;
    }
  }
}
