import { readFile } from "node:fs/promises";

import {
  generateHostedUserRecipientKeyPair,
  HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
  HOSTED_CRYPTO_COMPLETE_STANDBY_PRELOAD_ERROR,
} from "@murphai/runtime-state";
import { describe, expect, it } from "vitest";

import {
  assertHostedCryptoStandbyEnv,
  HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR,
  listHostedCryptoStandbyEnvErrors,
} from "../scripts/check-hosted-crypto-standby-env";

describe("hosted crypto standby environment preflight", () => {
  it("accepts structurally valid Web standby keyrings", () => {
    expect(listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v1",
      HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
        "authority-v2": {
          publicKeyPem:
            "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
          status: "verify_only",
        },
      }),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        JSON.stringify({
          "cloudflare-automation:v2": {
            publicJwk: {
              crv: "P-256",
              kty: "EC",
              x: "standby-public-x",
              y: "standby-public-y",
            },
            recipient: "cloudflare-automation-secret",
            recipientKeyId: "cloudflare-automation:v2",
            status: "disabled",
          },
        }),
      HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "authority-v1",
    })).toEqual([]);
  });

  it("fails with a field-only error before a malformed Vercel ring can build", () => {
    const errors = listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON:
        '{"vercel-keyring-secret-canary"',
    });

    expect(errors).toEqual([HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR]);
    expect(errors.join(" ")).not.toContain("vercel-keyring-secret-canary");
  });

  it("rejects a private keyring in the Web runtime", () => {
    const errors = listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
        "web-private-keyring-secret-canary",
    });

    expect(errors).toEqual([HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR]);
    expect(errors.join(" ")).not.toContain("web-private-keyring-secret-canary");
  });

  it("rejects sibling private material from Web public-ring payloads", async () => {
    const standbyRecipient = await generateHostedUserRecipientKeyPair();
    const publicRingWithPrivateSibling = JSON.stringify({
      "cloudflare-automation:v2": {
        privateJwk: { d: "web-public-ring-private-canary" },
        publicJwk: standbyRecipient.publicKeyJwk,
        recipient: "cloudflare-automation-secret",
        status: "disabled",
      },
    });
    const normalErrors = listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        publicRingWithPrivateSibling,
    });
    const completeErrors = listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
        "authority-v2": {
          publicKeyPem:
            "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
          status: "verify_only",
        },
      }),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
        JSON.stringify({
          "cloudflare-automation:v2": {
            privateJwk: standbyRecipient.privateKeyJwk,
            recipient: "cloudflare-automation-secret",
            status: "decrypt_only",
          },
        }),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        publicRingWithPrivateSibling,
      HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "authority-v1",
      HOSTED_CRYPTO_STANDBY_AUTHORITY_KEY_VERSION: "authority-v2",
      HOSTED_CRYPTO_STANDBY_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v2",
    }, { requireCompletePreload: true });

    expect(normalErrors).toEqual([
      HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
    ]);
    expect(completeErrors).toEqual([
      HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
    ]);
    expect([...normalErrors, ...completeErrors].join(" ")).not.toContain(
      "web-public-ring-private-canary",
    );
  });

  it.each([
    [
      "an active public standby",
      {
        "cloudflare-automation:v2": {
          publicJwk: {
            crv: "P-256",
            kty: "EC",
            x: "public-x",
            y: "public-y",
          },
          recipient: "cloudflare-automation-secret",
          status: "active",
        },
      },
    ],
    [
      "a public standby missing a coordinate",
      {
        "cloudflare-automation:v2": {
          publicJwk: {
            crv: "P-256",
            kty: "EC",
            x: "public-x",
          },
          recipient: "cloudflare-automation-secret",
          status: "disabled",
        },
      },
    ],
  ])("rejects %s before a Vercel build", (_name, keyring) => {
    expect(listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        JSON.stringify(keyring),
    })).toEqual([HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR]);
  });

  it("rejects a public standby that collides with the active recipient", () => {
    expect(listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        JSON.stringify({
          "cloudflare-automation:v1": {
            publicJwk: {
              crv: "P-256",
              kty: "EC",
              x: "standby-public-x",
              y: "standby-public-y",
            },
            recipient: "cloudflare-automation-secret",
            status: "disabled",
          },
        }),
    })).toEqual([HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR]);
  });

  it("requires and matches all three payloads for pre-mutation acceptance", async () => {
    expect(() => assertHostedCryptoStandbyEnv(
      {},
      { requireCompletePreload: true },
    )).toThrow(HOSTED_CRYPTO_COMPLETE_STANDBY_PRELOAD_ERROR);

    const standbyRecipient = await generateHostedUserRecipientKeyPair();
    expect(() => assertHostedCryptoStandbyEnv(
      {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
          "cloudflare-automation:v1",
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-v2": {
            publicKeyPem:
              "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----",
            status: "verify_only",
          },
        }),
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: standbyRecipient.privateKeyJwk,
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
          }),
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              publicJwk: standbyRecipient.publicKeyJwk,
              recipient: "cloudflare-automation-secret",
              status: "disabled",
            },
          }),
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "authority-v1",
        HOSTED_CRYPTO_STANDBY_AUTHORITY_KEY_VERSION: "authority-v2",
        HOSTED_CRYPTO_STANDBY_CLOUDFLARE_AUTOMATION_KEY_ID:
          "cloudflare-automation:v2",
      },
      { requireCompletePreload: true },
    )).not.toThrow();
  });

  it("runs the standby check before the production Next build", async () => {
    const packageJson = await readFile("apps/web/package.json", "utf8");
    expect(packageJson).toContain(
      '"prebuild": "pnpm --dir ../../packages/runtime-state build"',
    );

    const preflightIndex = packageJson.indexOf("pnpm hosted-crypto:env-check");
    const nextBuildIndex = packageJson.indexOf(
      "bash scripts/run-production-next-build.sh",
    );

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(nextBuildIndex).toBeGreaterThan(preflightIndex);
  });
});
