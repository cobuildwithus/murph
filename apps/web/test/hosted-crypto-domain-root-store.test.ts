import { Buffer } from "node:buffer";
import assert from "node:assert/strict";

import {
  HostedBillingStatus,
  Prisma,
  type HostedMember,
  type HostedMemberIdentity,
} from "@prisma/client";
import {
  findHostedDomainRootWrap,
  parseHostedDomainRootKeyEnvelope,
  verifyHostedDomainRootEnvelopeSignatureWithPublicKey,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, expect, test, vi } from "vitest";

import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../src/lib/hosted-web/encryption";
import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";
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
  restoreHostedSecureBoxTestCodec();
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
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
    readHostedRuntimeCryptoContextForWorker,
  } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const tx = createCapturingTransaction();

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "ingress",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-1",
  });
  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
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
  assert.equal(context.cacheMaxAgeMs, 5 * 60 * 1000);
  assert.match(context.cryptoContextVersion, /^hccv_[0-9a-f]{32}$/u);
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

test("detects whether all active hosted crypto domain roots exist for a user", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  gcpKmsMock.client = createLocalKmsClient({
    encryptCalls: [],
    signCalls: [],
    signer: signer.privateKey,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    hasActiveHostedCryptoDomainRootsForUserTx,
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
    provisionHostedCryptoDomainRootsForUserTx,
  } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const tx = createCapturingTransaction();

  await expect(hasActiveHostedCryptoDomainRootsForUserTx({
    tx: tx.prisma,
    userId: "member-test-1",
  })).resolves.toBe(false);

  for (const domain of ["control", "device", "ingress"] as const) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({
      domain,
      prisma: tx.prisma,
      reason: "test.partial-activation",
      userId: "member-test-1",
    });
  }

  await expect(hasActiveHostedCryptoDomainRootsForUserTx({
    tx: tx.prisma,
    userId: "member-test-1",
  })).resolves.toBe(false);

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "runtime",
    prisma: tx.prisma,
    reason: "test.partial-activation",
    userId: "member-test-1",
  });
  tx.markEnvelopeInactive({
    domain: "device",
    userId: "member-test-1",
  });

  await expect(hasActiveHostedCryptoDomainRootsForUserTx({
    tx: tx.prisma,
    userId: "member-test-1",
  })).resolves.toBe(false);

  tx.markEnvelopeActive({
    domain: "device",
    userId: "member-test-1",
  });

  await provisionHostedCryptoDomainRootsForUserTx({
    reason: "test.activation",
    tx: tx.prisma,
    userId: "member-test-1",
  });

  await expect(hasActiveHostedCryptoDomainRootsForUserTx({
    tx: tx.prisma,
    userId: "member-test-1",
  })).resolves.toBe(true);
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

test("hosted web private-field encryption fails closed when control roots are missing", async () => {
  const { encryptCalls, signCalls, tx } = await createHostedWebCryptoTransactionFixture();

  await expect(encryptHostedWebNullableString({
    field: "hosted-member-identity.phone-number",
    memberId: "member-test-missing-control",
    prisma: tx.prisma,
    value: "redacted-phone-token",
  })).rejects.toThrow(/control domain root envelope is not provisioned/u);

  assert.equal(tx.persistedEnvelopes.length, 0);
  assert.equal(encryptCalls.length, 0);
  assert.equal(signCalls.length, 0);
});

test("hosted web private-field encryption uses already-provisioned control roots", async () => {
  const { encryptCalls, signCalls, tx } = await createHostedWebCryptoTransactionFixture();
  const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-transaction",
  });
  assert.equal(tx.persistedEnvelopes.length, 1);
  assert.equal(encryptCalls.length, 1);
  assert.equal(signCalls.length, 1);

  const ciphertext = await encryptHostedWebNullableString({
    field: "hosted-member-identity.phone-number",
    memberId: "member-test-transaction",
    prisma: tx.prisma,
    value: "redacted-phone-token",
  });

  assert.equal(tx.persistedEnvelopes.length, 1);
  assert.equal(tx.persistedEnvelopes[0]?.domain, "control");
  assert.equal(tx.persistedEnvelopes[0]?.userId, "member-test-transaction");
  assert.equal(encryptCalls.length, 1);
  assert.equal(signCalls.length, 1);

  await expect(decryptHostedWebNullableString({
    field: "hosted-member-identity.phone-number",
    memberId: "member-test-transaction",
    prisma: tx.prisma,
    value: ciphertext,
  })).resolves.toBe("redacted-phone-token");
  assert.equal(tx.persistedEnvelopes.length, 1);
});

test("hosted member identity upsert keeps private-field crypto inside the caller transaction", async () => {
  const { encryptCalls, signCalls, tx } = await createHostedWebCryptoTransactionFixture(
    createHostedMemberIdentityTransaction,
  );
  const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const { upsertHostedMemberIdentity } = await import(
    "../src/lib/hosted-onboarding/hosted-member-identity-store"
  );

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-upsert",
  });

  await expect(upsertHostedMemberIdentity({
    maskedPhoneNumberHint: "redacted-phone-hint",
    memberId: "member-test-upsert",
    phoneLookupKey: "hbidx:phone:v1:test",
    phoneNumber: "redacted-phone-token",
    phoneNumberVerifiedAt: null,
    prisma: tx.prisma,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: "redacted-phone-token",
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  })).resolves.toMatchObject({
    memberId: "member-test-upsert",
    phoneNumber: "redacted-phone-token",
    signupPhoneNumber: "redacted-phone-token",
  });

  assert.equal(tx.persistedEnvelopes.length, 1);
  assert.equal(tx.persistedEnvelopes[0]?.domain, "control");
  assert.equal(tx.persistedEnvelopes[0]?.userId, "member-test-upsert");
  assert.equal(encryptCalls.length, 1);
  assert.equal(signCalls.length, 1);
});

test("hosted Privy member creation provisions the control root before private identity fields", async () => {
  const { encryptCalls, signCalls, tx } = await createHostedWebCryptoTransactionFixture(
    createHostedMemberIdentityServiceTransaction,
  );
  const { ensureHostedMemberForPrivyIdentityTx } = await import(
    "../src/lib/hosted-onboarding/member-identity-service"
  );

  const member = await ensureHostedMemberForPrivyIdentityTx({
    identity: {
      email: null,
      phone: {
        number: "+15551234567",
        verifiedAt: 1770000000,
      },
      telegram: null,
      userId: "did:privy:user_test_control_root",
      wallet: {
        address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        chainType: "ethereum",
        id: "wallet_test_control_root",
        type: "wallet",
      },
    },
    now: new Date("2026-05-02T00:00:00.000Z"),
    prisma: tx.prisma,
  });

  assert.equal(tx.persistedEnvelopes.length, 1);
  assert.equal(tx.persistedEnvelopes[0]?.domain, "control");
  assert.equal(tx.persistedEnvelopes[0]?.userId, member.id);
  assert.equal(encryptCalls.length, 1);
  assert.equal(signCalls.length, 1);
});

async function createHostedWebCryptoTransactionFixture(
  createTransaction: () => HostedCryptoTestTransaction = createCapturingTransaction,
): Promise<{
  encryptCalls: GcpKmsEncryptInput[];
  signCalls: GcpKmsAsymmetricSignInput[];
  tx: HostedCryptoTestTransaction;
}> {
  setHostedSecureBoxStringTestCodecForTests(null);
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

  return {
    encryptCalls,
    signCalls,
    tx: createTransaction(),
  };
}

type HostedCryptoTestTransaction = {
  markEnvelopeActive(input: { domain: HostedDomainRootKeyEnvelopeV1["domain"]; userId: string }): void;
  markEnvelopeInactive(input: { domain: HostedDomainRootKeyEnvelopeV1["domain"]; userId: string }): void;
  persistedEnvelopes: HostedDomainRootKeyEnvelopeV1[];
  prisma: Prisma.TransactionClient;
};

function createCapturingTransaction(): HostedCryptoTestTransaction {
  const persistedEnvelopes: HostedDomainRootKeyEnvelopeV1[] = [];
  const inactiveEnvelopeKeys = new Set<string>();
  const tx = {
    $executeRaw: async (...args: Parameters<Prisma.TransactionClient["$executeRaw"]>) => {
      capturePersistedEnvelope(args, persistedEnvelopes);
      return 1;
    },
    $queryRaw: async <T = unknown>(
      ...args: Parameters<Prisma.TransactionClient["$queryRaw"]>
    ): Promise<T> => {
      const strings = args[0] as TemplateStringsArray;
      const sql = strings.join("?");
      const values = args.slice(1);
      const userId = values.find((value): value is string =>
        typeof value === "string" && (value.startsWith("member-") || value.startsWith("hbm_")));
      if (sql.includes("COUNT(DISTINCT domain)")) {
        const domains = new Set(
          persistedEnvelopes
            .filter((candidate) => candidate.userId === userId)
            .filter((candidate) => !inactiveEnvelopeKeys.has(createEnvelopeStatusKey(candidate)))
            .map((candidate) => candidate.domain),
        );
        return [{ domainCount: domains.size }] as T;
      }

      const rootKeyId = values.find((value): value is string =>
        typeof value === "string" && value.startsWith("udrk:"));
      const domain = values.find((value): value is HostedDomainRootKeyEnvelopeV1["domain"] =>
        value === "control" || value === "device" || value === "ingress" || value === "runtime");
      const envelope = persistedEnvelopes.find((candidate) =>
        candidate.userId === userId
        && candidate.domain === domain
        && (!rootKeyId || candidate.rootKeyId === rootKeyId)
        && !inactiveEnvelopeKeys.has(createEnvelopeStatusKey(candidate)));
      return (envelope
        ? [{
          domain: envelope.domain,
          id: `row-${envelope.domain}`,
          rootKeyId: envelope.rootKeyId,
          signedEnvelopeJson: envelope,
          status: "active",
          updatedAt: envelope.updatedAt,
          userId: envelope.userId,
        }]
        : []) as T;
    },
  };
  // Narrow test double: domain-root-store only uses Prisma raw query helpers here.
  return {
    markEnvelopeActive(input) {
      inactiveEnvelopeKeys.delete(createEnvelopeStatusKey(input));
    },
    markEnvelopeInactive(input) {
      inactiveEnvelopeKeys.add(createEnvelopeStatusKey(input));
    },
    persistedEnvelopes,
    prisma: tx as Prisma.TransactionClient,
  };
}

function createEnvelopeStatusKey(input: {
  domain: HostedDomainRootKeyEnvelopeV1["domain"];
  userId: string;
}): string {
  return `${input.userId}:${input.domain}`;
}

function createHostedMemberIdentityTransaction(): HostedCryptoTestTransaction {
  const tx = createCapturingTransaction();
  const hostedMemberIdentity = {
    async upsert(input: {
      create: Prisma.HostedMemberIdentityUncheckedCreateInput;
    }): Promise<HostedMemberIdentity> {
      return buildHostedMemberIdentityRecord(input.create);
    },
  };

  return {
    ...tx,
    prisma: Object.assign(tx.prisma, {
      hostedMemberIdentity,
    }),
  };
}

function createHostedMemberIdentityServiceTransaction(): HostedCryptoTestTransaction {
  const tx = createHostedMemberIdentityTransaction();
  const hostedMember = {
    async create(input: {
      data: Prisma.HostedMemberUncheckedCreateInput;
    }): Promise<HostedMember> {
      const now = new Date("2026-05-02T00:00:00.000Z");
      return {
        billingStatus: input.data.billingStatus ?? HostedBillingStatus.not_started,
        createdAt: now,
        id: input.data.id,
        pendingActivationTimeZone: null,
        signupNotificationEmailAttemptedAt: null,
        signupWelcomeEmailAttemptedAt: null,
        suspendedAt: input.data.suspendedAt instanceof Date ? input.data.suspendedAt : null,
        updatedAt: now,
      };
    },
  };
  const hostedMemberIdentity = Object.assign({}, tx.prisma.hostedMemberIdentity, {
    findFirst: async (): Promise<null> => null,
    findMany: async (): Promise<[]> => [],
  });

  return {
    ...tx,
    prisma: Object.assign(tx.prisma, {
      hostedMember,
      hostedMemberIdentity,
    }),
  };
}

function buildHostedMemberIdentityRecord(
  input: Prisma.HostedMemberIdentityUncheckedCreateInput,
): HostedMemberIdentity {
  const now = new Date("2026-05-02T00:00:00.000Z");
  return {
    createdAt: now,
    maskedPhoneNumberHint: nullableString(input.maskedPhoneNumberHint),
    memberId: input.memberId,
    phoneLookupKey: nullableString(input.phoneLookupKey),
    phoneNumberEncrypted: nullableString(input.phoneNumberEncrypted),
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt instanceof Date
      ? input.phoneNumberVerifiedAt
      : null,
    privyUserIdEncrypted: nullableString(input.privyUserIdEncrypted),
    privyUserLookupKey: nullableString(input.privyUserLookupKey),
    signupPhoneCodeSendAttemptId: nullableString(input.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt:
      input.signupPhoneCodeSendAttemptStartedAt instanceof Date
        ? input.signupPhoneCodeSendAttemptStartedAt
        : null,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt instanceof Date
      ? input.signupPhoneCodeSentAt
      : null,
    signupPhoneNumberEncrypted: nullableString(input.signupPhoneNumberEncrypted),
    updatedAt: now,
    walletAddressEncrypted: nullableString(input.walletAddressEncrypted),
    walletAddressLookupKey: nullableString(input.walletAddressLookupKey),
    walletChainType: nullableString(input.walletChainType),
    walletCreatedAt: input.walletCreatedAt instanceof Date ? input.walletCreatedAt : null,
    walletProvider: nullableString(input.walletProvider),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
    async decrypt(decryptInput) {
      return {
        plaintext: Buffer.from(decryptInput.ciphertext, "base64"),
      };
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

function restoreHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(input.value.replace(/^hsb-test:/u, ""), "base64url").toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
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
