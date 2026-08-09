import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  readHostedDeployAutomationEnvironment,
} from "../scripts/deploy-automation.js";

import {
  fetchHostedWorkerRuntimeRoots,
  fetchHostedWorkerRuntimeRoot,
  unwrapHostedWorkerRuntimeRoots,
} from "../src/hosted-crypto/runtime-crypto-context.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests,
  requireHostedUserCryptoContextFromEnvironment,
} from "../src/hosted-crypto/runtime-user-crypto-context.ts";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "../src/internal-hosts.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

test("Cloudflare hosted runtime crypto context verifies signatures and unwraps ingress/runtime roots", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 100 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    domain: "runtime",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: runtimeRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });

  const unwrapped = await unwrapHostedWorkerRuntimeRoots({
    context: {
      envelopes: { ingress, runtime },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    },
    env,
  });

  assert.deepEqual(unwrapped.ingress.rootKey, ingressRoot);
  assert.deepEqual(unwrapped.runtime.rootKey, runtimeRoot);

  await expect(
    unwrapHostedWorkerRuntimeRoots({
      context: {
        envelopes: { ingress: { ...ingress, updatedAt: "2026-05-01T00:01:00.000Z" }, runtime },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      },
      env,
    }),
  ).rejects.toThrow(/authority signature is invalid/u);

  await expect(
    unwrapHostedWorkerRuntimeRoots({
      context: {
        envelopes: { ingress, runtime },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      },
      env: { ...env, HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "other-key" },
    }),
  ).rejects.toThrow(/not available for decrypt/u);
});

test("rendered production standby keyrings preserve active envelope reads", async () => {
  const activeRecipient = await generateP256EcdhKeyPair();
  const standbyRecipient = await generateP256EcdhKeyPair();
  const activeSigner = await generateP256SigningKeyPair();
  const standbySigner = await generateP256SigningKeyPair();
  const activeAuthorityKeyVersion =
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const standbyAuthorityKeyVersion =
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/2";
  const requiredSecretFixtures = Object.fromEntries(
    HOSTED_WORKER_REQUIRED_SECRET_NAMES.map((name) => [
      name,
      `${name.toLowerCase()}-fixture-value`,
    ]),
  );
  const deploySource = {
    ...requiredSecretFixtures,
    CF_BUNDLES_BUCKET: "hosted-bundles",
    CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
    CF_PUBLIC_BASE_URL: "https://hosted-worker.example.test",
    CF_WORKER_NAME: "hosted-worker",
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: activeAuthorityKeyVersion,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: activeSigner.publicKeyPem,
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
      [standbyAuthorityKeyVersion]: {
        publicKeyPem: standbySigner.publicKeyPem,
        status: "verify_only",
      },
    }),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      "cloudflare-automation:v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      activeRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON: JSON.stringify({
      "cloudflare-automation:v2": {
        privateJwk: standbyRecipient.privateJwk,
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
    }),
    HOSTED_CRYPTO_ENV: "production",
    HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-fixture",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: JSON.stringify(
      activeSigner.privateJwk,
    ),
  };
  const renderedConfig = buildHostedWranglerDeployConfig(
    readHostedDeployAutomationEnvironment(deploySource),
  ) as { vars: Record<string, string> };
  const renderedSecrets = buildHostedWorkerSecretsPayload(deploySource);
  const environment = readHostedExecutionEnvironment(
    createHostedExecutionTestEnv({
      ...renderedConfig.vars,
      ...renderedSecrets,
    }),
  );
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 90);
  const ingress = await createSignedWorkerEnvelope({
    cryptoEnv: "production",
    domain: "ingress",
    keyVersionName: activeAuthorityKeyVersion,
    publicJwk: activeRecipient.publicJwk,
    recipientKeyId: "cloudflare-automation:v1",
    rootKey: ingressRoot,
    signer: activeSigner.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    cryptoEnv: "production",
    domain: "runtime",
    keyVersionName: activeAuthorityKeyVersion,
    publicJwk: activeRecipient.publicJwk,
    recipientKeyId: "cloudflare-automation:v1",
    rootKey: runtimeRoot,
    signer: activeSigner.privateKey,
    userId: "user-1",
  });

  const unwrapped = await unwrapHostedWorkerRuntimeRoots({
    context: {
      envelopes: { ingress, runtime },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    },
    env: environment.hostedCrypto,
  });

  assert.deepEqual(unwrapped.ingress.rootKey, ingressRoot);
  assert.deepEqual(unwrapped.runtime.rootKey, runtimeRoot);
});

test("Cloudflare hosted runtime crypto context can verify and decrypt rotated keyring entries", async () => {
  const oldCloudflareRecipient = await generateP256EcdhKeyPair();
  const activeCloudflareRecipient = await generateP256EcdhKeyPair();
  const oldSigner = await generateP256SigningKeyPair();
  const activeSigner = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "authority-v2",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: activeSigner.publicKeyPem,
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: JSON.stringify({
      "authority-v1": {
        publicKeyPem: oldSigner.publicKeyPem,
        status: "verify_only",
      },
    }),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v2",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      activeCloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON: JSON.stringify({
      "cf-key-v1": {
        privateJwk: oldCloudflareRecipient.privateJwk,
        recipient: "cloudflare-automation-secret",
        status: "decrypt_only",
      },
    }),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 20);
  const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 80);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: "authority-v1",
    publicJwk: oldCloudflareRecipient.publicJwk,
    recipientKeyId: "cf-key-v1",
    rootKey: ingressRoot,
    signer: oldSigner.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    domain: "runtime",
    keyVersionName: "authority-v1",
    publicJwk: oldCloudflareRecipient.publicJwk,
    recipientKeyId: "cf-key-v1",
    rootKey: runtimeRoot,
    signer: oldSigner.privateKey,
    userId: "user-1",
  });

  const unwrapped = await unwrapHostedWorkerRuntimeRoots({
    context: {
      envelopes: { ingress, runtime },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    },
    env,
  });

  assert.deepEqual(unwrapped.ingress.rootKey, ingressRoot);
  assert.deepEqual(unwrapped.runtime.rootKey, runtimeRoot);
});

test("Cloudflare hosted runtime crypto context requires an authority key version in production", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const keyVersionName =
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "production",
  };
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName,
    cryptoEnv: "production",
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    signer: signer.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    domain: "runtime",
    keyVersionName,
    cryptoEnv: "production",
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: Uint8Array.from({ length: 32 }, (_, index) => 100 + index),
    signer: signer.privateKey,
    userId: "user-1",
  });

  await expect(
    unwrapHostedWorkerRuntimeRoots({
      context: {
        envelopes: { ingress, runtime },
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      },
      env,
    }),
  ).rejects.toThrow(/HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION is required in production/u);
});

test("Cloudflare hosted runtime crypto context normalizes production environment markers", async () => {
  const scenarios = [
    {
      cryptoEnv: "prod",
      env: {
        HOSTED_CRYPTO_ENV: "prod",
      },
    },
    {
      cryptoEnv: "test",
      env: {
        HOSTED_CRYPTO_ENV: "test",
        NODE_ENV: "production",
      },
    },
    {
      cryptoEnv: "test",
      env: {
        HOSTED_CRYPTO_ENV: "test",
        VERCEL_ENV: "production",
      },
    },
    {
      cryptoEnv: "production",
      env: {
        HOSTED_CRYPTO_ENV: "production",
      },
    },
  ] as const;

  for (const scenario of scenarios) {
    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const env = {
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      ...scenario.env,
    };
    const ingress = await createSignedWorkerEnvelope({
      domain: "ingress",
      keyVersionName,
      cryptoEnv: scenario.cryptoEnv,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      signer: signer.privateKey,
      userId: "user-1",
    });
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      cryptoEnv: scenario.cryptoEnv,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: Uint8Array.from({ length: 32 }, (_, index) => 100 + index),
      signer: signer.privateKey,
      userId: "user-1",
    });

    await expect(
      unwrapHostedWorkerRuntimeRoots({
        context: {
          envelopes: { ingress, runtime },
          schema: "murph.hosted-runtime-crypto-context.v1",
          userId: "user-1",
        },
        env,
      }),
    ).rejects.toThrow(/HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION is required in production/u);
  }
});

test("Cloudflare hosted runtime crypto context is fetched from signed web control", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const callbackSigner = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => 10 + index);
  const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 150 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const runtime = await createSignedWorkerEnvelope({
    domain: "runtime",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: runtimeRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
    assert.equal(headers.has("x-hosted-execution-signature"), true);
    return new Response(JSON.stringify({
      envelopes: { ingress, runtime },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });

  const unwrapped = await fetchHostedWorkerRuntimeRoots({
    baseUrl: "https://web.example.test",
    callbackSigning: {
      keyId: "callback:v1",
      privateKeyJwkJson: JSON.stringify(callbackSigner.privateJwk),
    },
    cryptoEnv: env,
    fetchImpl: fetchMock,
    timeoutMs: null,
    userId: "user-1",
  });

  assert.deepEqual(unwrapped.ingress.rootKey, ingressRoot);
  assert.deepEqual(unwrapped.runtime.rootKey, runtimeRoot);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("Cloudflare hosted runtime crypto context fetches just the ingress root when asked for mailbox decrypt", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => 40 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
    assert.equal(headers.has("x-hosted-execution-signature"), true);
    return new Response(JSON.stringify({
      envelopes: { ingress },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });

  const unwrapped = await fetchHostedWorkerRuntimeRoot({
    baseUrl: "https://web.example.test",
    callbackSigning: {
      keyId: "callback:v1",
      privateKeyJwkJson: JSON.stringify(signer.privateJwk),
    },
    cryptoEnv: env,
    domain: "ingress",
    fetchImpl: fetchMock,
    timeoutMs: null,
    userId: "user-1",
  });

  assert.deepEqual(unwrapped.rootKey, ingressRoot);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("Cloudflare runtime user crypto context caches verified envelope JSON without reusing plaintext roots", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  vi.useFakeTimers();

  try {
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 150 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args;
      assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
      assert.equal(headers.has("x-hosted-execution-signature"), true);
      return new Response(JSON.stringify({
        cacheMaxAgeMs: 5 * 60 * 1000,
        cryptoContextVersion: "hccv_test_runtime_context",
        envelopes: { runtime },
        fetchedAt: new Date().toISOString(),
        ignored: "not cached",
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });

    const first = await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache",
      userId: "user-1",
    });

    assert.equal(first.cacheMaxAgeMs, 60_000);
    assert.deepEqual(first.rootKey, runtimeRoot);
    first.rootKey.fill(0);

    vi.setSystemTime(new Date("2026-05-01T00:00:30.000Z"));
    const second = await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache",
      userId: "user-1",
    });

    assert.deepEqual(second.rootKey, runtimeRoot);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-05-01T00:01:01.000Z"));
    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache",
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context does not cache failed web-control responses", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();

  try {
    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 100 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response(JSON.stringify({ error: "hosted_member_not_active" }), {
          status: 403,
        });
      }
      return new Response(JSON.stringify({
        cacheMaxAgeMs: 5 * 60 * 1000,
        cryptoContextVersion: "hccv_test_runtime_context_after_failure",
        envelopes: { runtime },
        fetchedAt: new Date().toISOString(),
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });

    await expect(requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-failed-cache",
      userId: "user-1",
    })).rejects.toMatchObject({ status: 403 });

    const context = await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-failed-cache",
      userId: "user-1",
    });

    assert.deepEqual(context.rootKey, runtimeRoot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context refetches when cached envelope verification fails", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  vi.useFakeTimers();

  try {
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const staleSigner = await generateP256SigningKeyPair();
    const freshSigner = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const staleRuntimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 20 + index);
    const freshRuntimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 80 + index);
    const staleRuntime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: staleRuntimeRoot,
      signer: staleSigner.privateKey,
      userId: "user-1",
    });
    const freshRuntime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: freshRuntimeRoot,
      signer: freshSigner.privateKey,
      userId: "user-1",
    });
    const staleEnvironment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
        staleSigner.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const freshEnvironment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
        freshSigner.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const fetchMock = vi.fn(async () => {
      const runtime = fetchMock.mock.calls.length === 1 ? staleRuntime : freshRuntime;
      const cryptoContextVersion = fetchMock.mock.calls.length === 1
        ? "hccv_stale_runtime_context"
        : "hccv_fresh_runtime_context";

      return new Response(JSON.stringify({
        cacheMaxAgeMs: 5 * 60 * 1000,
        cryptoContextVersion,
        envelopes: { runtime },
        fetchedAt: new Date().toISOString(),
        schema: "murph.hosted-runtime-crypto-context.v1",
        userId: "user-1",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });

    const stale = await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment: staleEnvironment,
      fetchImpl: fetchMock,
      reason: "test-cache-fallback",
      userId: "user-1",
    });

    assert.deepEqual(stale.rootKey, staleRuntimeRoot);

    vi.setSystemTime(new Date("2026-05-01T00:00:30.000Z"));
    const fresh = await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment: freshEnvironment,
      fetchImpl: fetchMock,
      reason: "test-cache-fallback",
      userId: "user-1",
    });

    assert.deepEqual(fresh.rootKey, freshRuntimeRoot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context refetches when cached envelope parsing fails", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();

  try {
    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 40 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      cacheMaxAgeMs: 5 * 60 * 1000,
      cryptoContextVersion: "hccv_test_runtime_context",
      envelopes: { runtime },
      fetchedAt: new Date().toISOString(),
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-parse-failure",
      userId: "user-1",
    });

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw new SyntaxError("corrupt cached envelope");
    });

    try {
      const context = await requireHostedUserCryptoContextFromEnvironment({
        domain: "runtime",
        environment,
        fetchImpl: fetchMock,
        reason: "test-cache-parse-failure",
        userId: "user-1",
      });

      assert.deepEqual(context.rootKey, runtimeRoot);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      parseSpy.mockRestore();
    }
  } finally {
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context clamps future fetchedAt before returning decrypted roots", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  vi.useFakeTimers();

  try {
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 180 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      cacheMaxAgeMs: 5 * 60 * 1000,
      cryptoContextVersion: "hccv_test_future_runtime_context",
      envelopes: { runtime },
      fetchedAt: "2026-05-01T00:05:00.000Z",
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    const context = await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-future-fetched-at",
      userId: "user-1",
    });

    assert.equal(context.cacheMaxAgeMs, 60_000);
    assert.equal(context.fetchedAtMs, Date.parse("2026-05-01T00:00:00.000Z"));
    assert.deepEqual(context.rootKey, runtimeRoot);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context skips oversized envelope cache entries", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  vi.useFakeTimers();

  try {
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 60 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const oversizedVersion = `hccv_${"a".repeat(70 * 1024)}`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      cacheMaxAgeMs: 5 * 60 * 1000,
      cryptoContextVersion: oversizedVersion,
      envelopes: { runtime },
      fetchedAt: new Date().toISOString(),
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-size",
      userId: "user-1",
    });
    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-size",
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context does not cache envelopes older than the capped TTL", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  vi.useFakeTimers();

  try {
    vi.setSystemTime(new Date("2026-05-01T00:02:00.000Z"));

    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 90 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      cacheMaxAgeMs: 5 * 60 * 1000,
      cryptoContextVersion: "hccv_test_old_runtime_context",
      envelopes: { runtime },
      fetchedAt: "2026-05-01T00:00:00.000Z",
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-old-context",
      userId: "user-1",
    });
    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-old-context",
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare runtime user crypto context caches the verified canonical envelope shape", async () => {
  clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  vi.useFakeTimers();

  try {
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const keyVersionName =
      "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 120 + index);
    const runtime = await createSignedWorkerEnvelope({
      domain: "runtime",
      keyVersionName,
      publicJwk: cloudflareRecipient.publicJwk,
      rootKey: runtimeRoot,
      signer: signer.privateKey,
      userId: "user-1",
    });
    const runtimeWithUnsignedExtra = {
      ...runtime,
      unsignedExtra: "a".repeat(70 * 1024),
    };
    const environment = readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: keyVersionName,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/gu, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      cacheMaxAgeMs: 5 * 60 * 1000,
      cryptoContextVersion: "hccv_test_canonical_runtime_context",
      envelopes: { runtime: runtimeWithUnsignedExtra },
      fetchedAt: new Date().toISOString(),
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));

    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-canonical-envelope",
      userId: "user-1",
    });
    await requireHostedUserCryptoContextFromEnvironment({
      domain: "runtime",
      environment,
      fetchImpl: fetchMock,
      reason: "test-cache-canonical-envelope",
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
  }
});

test("Cloudflare hosted runtime crypto context can use the local internal web-control host", async () => {
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const env = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
      cloudflareRecipient.privateJwk,
    ),
    HOSTED_CRYPTO_ENV: "test",
  };
  const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => 70 + index);
  const ingress = await createSignedWorkerEnvelope({
    domain: "ingress",
    keyVersionName: env.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    publicJwk: cloudflareRecipient.publicJwk,
    rootKey: ingressRoot,
    signer: signer.privateKey,
    userId: "user-1",
  });
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    assert.equal(
      String(url),
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`,
    );
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), "user-1");
    assert.equal(headers.has("x-hosted-execution-signature"), true);
    return new Response(JSON.stringify({
      envelopes: { ingress },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "user-1",
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });

  const unwrapped = await fetchHostedWorkerRuntimeRoot({
    baseUrl: CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
    callbackSigning: {
      keyId: "callback:v1",
      privateKeyJwkJson: JSON.stringify(signer.privateJwk),
    },
    cryptoEnv: env,
    domain: "ingress",
    allowHttpHosts: [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane],
    fetchImpl: fetchMock,
    timeoutMs: null,
    userId: "user-1",
  });

  assert.deepEqual(unwrapped.rootKey, ingressRoot);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

async function createSignedWorkerEnvelope(input: {
  domain: "ingress" | "runtime";
  keyVersionName: string;
  cryptoEnv?: string;
  publicJwk: JsonWebKey;
  recipientKeyId?: string;
  rootKey: Uint8Array;
  signer: CryptoKey;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const rootKeyId = `udrk:${input.domain}:test-root`;
  const now = "2026-05-01T00:00:00.000Z";
  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext: buildHostedDomainRootWrapContext({
      domain: input.domain,
      env: input.cryptoEnv ?? "test",
      recipient: "cloudflare-automation-secret",
      rootKeyId,
      userId: input.userId,
    }),
    recipient: "cloudflare-automation-secret",
    recipientKeyId: input.recipientKeyId ?? "cf-key-v1",
    recipientPublicJwk: input.publicJwk,
    rootKey: input.rootKey,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: input.domain,
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: input.userId,
    wraps: [wrap],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signer,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: input.keyVersionName,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
}

async function generateP256EcdhKeyPair(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
}

async function generateP256SigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  privateJwk: JsonWebKey;
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicKeyPem: toSpkiPem(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
  };
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
