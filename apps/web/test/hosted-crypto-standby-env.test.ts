import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import {
  generateHostedUserRecipientKeyPair,
  HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
  HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
  HOSTED_CRYPTO_COMPLETE_STANDBY_PRELOAD_ERROR,
} from "@murphai/runtime-state";
import { describe, expect, it } from "vitest";

import {
  assertHostedCryptoStandbyEnv,
  HOSTED_CLOUDFLARE_PRIVATE_WEB_RUNTIME_ERROR,
  listHostedCryptoStandbyEnvErrors,
} from "../scripts/check-hosted-crypto-standby-env";

describe("hosted crypto standby environment preflight", () => {
  it("accepts structurally valid Web standby keyrings", async () => {
    await expect(listHostedCryptoStandbyEnvErrors({
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
    })).resolves.toEqual([]);
  });

  it("fails with a field-only error before a malformed Vercel ring can build", async () => {
    const errors = await listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON:
        '{"vercel-keyring-secret-canary"',
    });

    expect(errors).toEqual([HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR]);
    expect(errors.join(" ")).not.toContain("vercel-keyring-secret-canary");
  });

  it("rejects a private keyring in the Web runtime", async () => {
    const errors = await listHostedCryptoStandbyEnvErrors({
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
    const normalErrors = await listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        publicRingWithPrivateSibling,
    });
    const completeErrors = await listHostedCryptoStandbyEnvErrors({
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

  it("rejects private material hidden by duplicate raw JSON members", async () => {
    const standbyRecipient = await generateHostedUserRecipientKeyPair();
    const publicJwkJson = JSON.stringify(standbyRecipient.publicKeyJwk);
    const safeEntry = `{"publicJwk":${publicJwkJson},"recipient":"cloudflare-automation-secret","status":"disabled"}`;
    const rawPublicRings = [
      `{"cloudflare-automation:v2":{"privateJwk":{"d":"duplicate-json-private-canary"},"publicJwk":${publicJwkJson},"recipient":"cloudflare-automation-secret","status":"disabled"},"cloudflare-automation:v2":${safeEntry}}`,
      `{"cloudflare-automation:v2":{"publicJwk":{"d":"duplicate-json-private-canary"},"publicJwk":${publicJwkJson},"recipient":"cloudflare-automation-secret","status":"disabled"}}`,
    ];
    const completeBase = {
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
      HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "authority-v1",
      HOSTED_CRYPTO_STANDBY_AUTHORITY_KEY_VERSION: "authority-v2",
      HOSTED_CRYPTO_STANDBY_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v2",
    };

    for (const rawPublicRing of rawPublicRings) {
      const normalErrors = await listHostedCryptoStandbyEnvErrors({
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
          "cloudflare-automation:v1",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON: rawPublicRing,
      });
      const completeErrors = await listHostedCryptoStandbyEnvErrors({
        ...completeBase,
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
          rawPublicRing,
      }, { requireCompletePreload: true });

      expect(normalErrors).toEqual([
        HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
      ]);
      expect(completeErrors).toEqual([
        HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR,
      ]);
      expect([...normalErrors, ...completeErrors].join(" ")).not.toContain(
        "duplicate-json-private-canary",
      );
    }
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
  ])("rejects %s before a Vercel build", async (_name, keyring) => {
    await expect(listHostedCryptoStandbyEnvErrors({
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON:
        JSON.stringify(keyring),
    })).resolves.toEqual([HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR]);
  });

  it("rejects a public standby that collides with the active recipient", async () => {
    await expect(listHostedCryptoStandbyEnvErrors({
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
    })).resolves.toEqual([HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR]);
  });

  it("requires and matches all three payloads for pre-mutation acceptance", async () => {
    await expect(
      assertHostedCryptoStandbyEnv({}, { requireCompletePreload: true }),
    ).rejects.toThrow(HOSTED_CRYPTO_COMPLETE_STANDBY_PRELOAD_ERROR);

    const standbyRecipient = await generateHostedUserRecipientKeyPair();
    const authorityPublicKeyPem = await generateP256SigningPublicKeyPem();
    const completeEnv = {
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
        "cloudflare-automation:v1",
      HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
        "authority-v2": {
          publicKeyPem: authorityPublicKeyPem,
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
    };
    await expect(
      assertHostedCryptoStandbyEnv(
        completeEnv,
        { requireCompletePreload: true },
      ),
    ).resolves.toBeUndefined();

    const invalidAuthorityErrors =
      await listHostedCryptoStandbyEnvErrors({
        ...completeEnv,
        HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
          "authority-v2": {
            publicKeyPem:
              "-----BEGIN PUBLIC KEY-----\noperator-private-canary\n-----END PUBLIC KEY-----",
            status: "verify_only",
          },
        }),
      }, { requireCompletePreload: true });
    const invalidPrivateErrors =
      await listHostedCryptoStandbyEnvErrors({
        ...completeEnv,
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
          JSON.stringify({
            "cloudflare-automation:v2": {
              privateJwk: {
                ...standbyRecipient.privateKeyJwk,
                d: "operator-private-canary",
              },
              recipient: "cloudflare-automation-secret",
              status: "decrypt_only",
            },
          }),
      }, { requireCompletePreload: true });
    expect(invalidAuthorityErrors).toEqual([
      HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR,
    ]);
    expect(invalidPrivateErrors).toEqual([
      HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR,
    ]);
    expect([...invalidAuthorityErrors, ...invalidPrivateErrors].join(" "))
      .not.toContain("operator-private-canary");
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

async function generateP256SigningPublicKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const base64 = Buffer.from(spki).toString("base64");
  return `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
}
