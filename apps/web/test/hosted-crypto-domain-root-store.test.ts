import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import { Prisma } from "@prisma/client";
import {
  findHostedDomainRootWrap,
  parseHostedDomainRootKeyEnvelope,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, expect, test, vi } from "vitest";

import type {
  GcpKmsAsymmetricSignInput,
  GcpKmsEncryptInput,
  HostedGcpKmsClient,
} from "../src/lib/hosted-crypto/gcp-kms";

const AUTHORITY_KEY_VERSION =
  "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
const WEB_WRAP_KEY_NAME = "projects/test/locations/global/keyRings/ring/cryptoKeys/wrap";

const gcpKmsMock = vi.hoisted(() => ({
  client: null as HostedGcpKmsClient | null,
}));

vi.mock("../src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-crypto/gcp-kms")>();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv: () => {
      if (!gcpKmsMock.client) {
        throw new Error("Hosted crypto GCP KMS test client was not configured.");
      }
      return gcpKmsMock.client;
    },
  };
});

afterEach(() => {
  gcpKmsMock.client = null;
  vi.unstubAllEnvs();
});

test("web runtime crypto context reads already-provisioned signed ingress and runtime envelopes", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const encryptCalls: GcpKmsEncryptInput[] = [];
  const signCalls: GcpKmsAsymmetricSignInput[] = [];
  gcpKmsMock.client = createLocalKmsClient({
    encryptCalls,
    signCalls,
    signer: signer.privateKey,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    getOrCreateActiveHostedDomainRootEnvelope,
    readHostedRuntimeCryptoContextForWorker,
  } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const tx = createCapturingTransaction();

  await getOrCreateActiveHostedDomainRootEnvelope({
    domain: "ingress",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-1",
  });
  await getOrCreateActiveHostedDomainRootEnvelope({
    domain: "runtime",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-1",
  });
  const persistedBeforeRead = tx.persistedEnvelopes.length;

  const context = await readHostedRuntimeCryptoContextForWorker({
    prisma: tx.prisma,
    userId: "member-test-1",
  });

  assert.equal(context.schema, "murph.hosted-runtime-crypto-context.v1");
  assert.equal(context.userId, "member-test-1");
  assert.equal(context.envelopes.ingress.domain, "ingress");
  assert.equal(context.envelopes.runtime.domain, "runtime");
  assert.equal(tx.persistedEnvelopes.length, persistedBeforeRead);
  assert.deepEqual(
    tx.persistedEnvelopes.map((envelope) => envelope.domain).sort(),
    ["ingress", "runtime"],
  );

  await expect(
    verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
      envelope: context.envelopes.ingress,
      publicKeyPem: signer.publicKeyPem,
    }),
  ).resolves.toBe(true);
  await expect(
    verifyHostedDomainRootEnvelopeSignatureWithPublicKey({
      envelope: context.envelopes.runtime,
      publicKeyPem: signer.publicKeyPem,
    }),
  ).resolves.toBe(true);

  assert.ok(
    findHostedDomainRootWrap({
      envelope: context.envelopes.ingress,
      recipient: "web-ingress-kms",
    }),
  );
  assert.ok(
    findHostedDomainRootWrap({
      envelope: context.envelopes.ingress,
      recipient: "cloudflare-automation-secret",
    }),
  );
  assert.equal(
    findHostedDomainRootWrap({
      envelope: context.envelopes.runtime,
      recipient: "web-control-kms",
    }),
    null,
  );
  assert.equal(
    findHostedDomainRootWrap({
      envelope: context.envelopes.runtime,
      recipient: "web-device-kms",
    }),
    null,
  );
  assert.equal(
    findHostedDomainRootWrap({
      envelope: context.envelopes.runtime,
      recipient: "web-ingress-kms",
    }),
    null,
  );
  assert.ok(
    findHostedDomainRootWrap({
      envelope: context.envelopes.runtime,
      recipient: "cloudflare-automation-secret",
    }),
  );

  assert.equal(encryptCalls.length, 1);
  assert.equal(encryptCalls[0]?.keyName, WEB_WRAP_KEY_NAME);
  assert.match(encryptCalls[0]?.additionalAuthenticatedData, /"domain":"ingress"/u);
  assert.equal(signCalls.length, 2);
});

test("web runtime crypto context fails closed instead of provisioning missing worker roots", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const encryptCalls: GcpKmsEncryptInput[] = [];
  const signCalls: GcpKmsAsymmetricSignInput[] = [];
  gcpKmsMock.client = createLocalKmsClient({
    encryptCalls,
    signCalls,
    signer: signer.privateKey,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const { readHostedRuntimeCryptoContextForWorker } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const tx = createCapturingTransaction();

  await expect(readHostedRuntimeCryptoContextForWorker({
    prisma: tx.prisma,
    userId: "member-test-1",
  })).rejects.toThrow(/ingress domain root envelope is not provisioned/u);
  assert.equal(tx.persistedEnvelopes.length, 0);
  assert.equal(encryptCalls.length, 0);
  assert.equal(signCalls.length, 0);
});

function createCapturingTransaction(): {
  persistedEnvelopes: HostedDomainRootKeyEnvelopeV1[];
  prisma: Prisma.TransactionClient;
} {
  const persistedEnvelopes: HostedDomainRootKeyEnvelopeV1[] = [];
  const tx = {
    $executeRaw: async (...args: Parameters<Prisma.TransactionClient["$executeRaw"]>) => {
      capturePersistedEnvelope(args, persistedEnvelopes);
      return 1;
    },
    $queryRaw: async <T = unknown>(
      ...args: Parameters<Prisma.TransactionClient["$queryRaw"]>
    ): Promise<T> => {
      const values = args.slice(1);
      const userId = values.find((value): value is string =>
        typeof value === "string" && value.startsWith("member-"));
      const domain = values.find((value): value is HostedDomainRootKeyEnvelopeV1["domain"] =>
        value === "control" || value === "device" || value === "ingress" || value === "runtime");
      const envelope = persistedEnvelopes.find((candidate) =>
        candidate.userId === userId && candidate.domain === domain);
      return (envelope
        ? [{
          domain: envelope.domain,
          id: `row-${envelope.domain}`,
          rootKeyId: envelope.rootKeyId,
          signedEnvelopeJson: envelope,
          status: "active",
          userId: envelope.userId,
        }]
        : []) as T;
    },
  };
  // Narrow test double: domain-root-store only uses Prisma raw query helpers here.
  return { persistedEnvelopes, prisma: tx as Prisma.TransactionClient };
}

function capturePersistedEnvelope(
  args: Parameters<Prisma.TransactionClient["$executeRaw"]>,
  persistedEnvelopes: HostedDomainRootKeyEnvelopeV1[],
): void {
  for (const value of args.slice(1)) {
    if (
      typeof value === "string"
      && value.includes("murph.hosted-domain-root-key-envelope.v1")
    ) {
      persistedEnvelopes.push(parseHostedDomainRootKeyEnvelope(JSON.parse(value)));
    }
  }
}

function createLocalKmsClient(input: {
  encryptCalls: GcpKmsEncryptInput[];
  signCalls: GcpKmsAsymmetricSignInput[];
  signer: CryptoKey;
}): HostedGcpKmsClient {
  return {
    async asymmetricSign(signInput) {
      input.signCalls.push(signInput);
      const signature = await crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        input.signer,
        toArrayBuffer(signInput.message),
      );
      return {
        keyVersionName: signInput.keyVersionName,
        signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
      };
    },
    async decrypt() {
      throw new Error("Unexpected hosted crypto decrypt in runtime context test.");
    },
    async encrypt(encryptInput) {
      input.encryptCalls.push(encryptInput);
      return {
        ciphertext: Buffer.from(encryptInput.plaintext).toString("base64"),
        keyName: encryptInput.keyName,
      };
    },
  };
}

function stubHostedCryptoEnv(input: {
  cloudflarePublicJwk: JsonWebKey;
  signerPublicKeyPem: string;
}): void {
  vi.stubEnv("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID", "cloudflare-automation:v1");
  vi.stubEnv(
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
    JSON.stringify(input.cloudflarePublicJwk),
  );
  vi.stubEnv("HOSTED_CRYPTO_ENV", "test");
  vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION", AUTHORITY_KEY_VERSION);
  vi.stubEnv(
    "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    input.signerPublicKeyPem.replace(/\n/gu, "\\n"),
  );
  vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", WEB_WRAP_KEY_NAME);
}

async function generateP256EcdhKeyPair(): Promise<{
  publicJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
}

async function generateP256SigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
    publicKeyPem: toSpkiPem(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
  };
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}
