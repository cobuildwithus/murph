import { pathToFileURL } from "node:url";

import {
  assertHostedCryptoCompleteStandbyKeyringJsons,
  assertHostedCryptoStandbyKeyringJsons,
} from "@murphai/runtime-state";

type EnvSource = Readonly<Record<string, string | undefined>>;

export const HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR =
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON must not be configured in the Web runtime.";

export async function listHostedCryptoStandbyEnvErrors(
  source: EnvSource = process.env,
  input: { requireCompletePreload?: boolean } = {},
): Promise<string[]> {
  if (
    !input.requireCompletePreload
    && source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON?.trim()
  ) {
    return [HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR];
  }

  try {
    const keyringInput = {
      activeAuthorityKeyVersionName:
        source.HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION,
      activeCloudflareRecipientKeyId:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
      authorityVerifyKeyringJson:
        source.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
      cloudflarePrivateKeyringJson:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
      cloudflarePublicKeyringJson:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON,
      proposedAuthorityKeyVersionName:
        source.HOSTED_CRYPTO_STANDBY_AUTHORITY_KEY_VERSION,
      proposedCloudflareRecipientKeyId:
        source.HOSTED_CRYPTO_STANDBY_CLOUDFLARE_AUTOMATION_KEY_ID,
    };
    if (input.requireCompletePreload) {
      await assertHostedCryptoCompleteStandbyKeyringJsons(keyringInput);
    } else {
      assertHostedCryptoStandbyKeyringJsons(keyringInput);
    }
    return [];
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : "Hosted crypto standby keyrings are invalid.",
    ];
  }
}

export async function assertHostedCryptoStandbyEnv(
  source: EnvSource = process.env,
  input: { requireCompletePreload?: boolean } = {},
): Promise<void> {
  const errors = await listHostedCryptoStandbyEnvErrors(source, input);
  if (errors.length > 0) {
    throw new TypeError(errors.join(" "));
  }
}

async function runHostedCryptoStandbyEnvCheck(args: string[]): Promise<void> {
  const allowedArgs = new Set(["--require-complete-preload"]);
  const unknownArg = args.find((arg) => !allowedArgs.has(arg));
  if (unknownArg) {
    console.error("Hosted crypto standby env check received an unknown option.");
    process.exitCode = 1;
  } else {
    try {
      await assertHostedCryptoStandbyEnv(process.env, {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runHostedCryptoStandbyEnvCheck(process.argv.slice(2));
}
