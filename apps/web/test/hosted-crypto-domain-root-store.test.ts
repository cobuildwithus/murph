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
  decryptHostedWebNullableStrings,
  encryptHostedWebNullableString,
} from "../src/lib/hosted-web/encryption";
import { readHostedMemberVerifiedEmailSnapshots } from "../src/lib/hosted-onboarding/hosted-member-store";
import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxStrings,
  setHostedSecureBoxStringTestCodecForTests,
} from "../src/lib/hosted-crypto/secure-box";
import type {
  GcpKmsAsymmetricSignInput,
  GcpKmsDecryptInput,
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
    provisionPreparedHostedCryptoDomainRootsTx,
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

  await provisionPreparedHostedCryptoDomainRootsTx({
    prepared: new Map(),
    reason: "test.activation",
    tx: tx.prisma,
    userId: "member-test-1",
  });

  await expect(hasActiveHostedCryptoDomainRootsForUserTx({
    tx: tx.prisma,
    userId: "member-test-1",
  })).resolves.toBe(true);
});

test("signs hosted domain root envelopes before the provisioning transaction opens", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const steps: string[] = [];
  gcpKmsMock.client = createStepRecordingKmsClient({
    client: createLocalKmsClient({
      encryptCalls: [],
      signCalls: [],
      signer: signer.privateKey,
    }),
    steps,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const recorder = createStepRecordingTransaction(steps);

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: recorder.prisma,
    reason: "test.two-phase",
    userId: "member-test-two-phase",
  });

  assert.deepEqual(steps, [
    "db.read-active-domains",
    "kms.encrypt",
    "kms.asymmetric-sign",
    "transaction.begin",
    "db.advisory-lock",
    "db.read-active-envelope",
    "db.insert-envelope",
    "db.insert-audit",
    "transaction.commit",
  ]);
  assert.equal(recorder.persistedEnvelopes.length, 1);
});

test("prepared hosted domain root candidates stay behind the advisory lock and re-read", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const steps: string[] = [];
  gcpKmsMock.client = createStepRecordingKmsClient({
    client: createLocalKmsClient({
      encryptCalls: [],
      signCalls: [],
      signer: signer.privateKey,
    }),
    steps,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    prepareHostedCryptoDomainRootCandidates,
    provisionPreparedHostedCryptoDomainRootsTx,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const recorder = createStepRecordingTransaction(steps);

  const prepared = await prepareHostedCryptoDomainRootCandidates({
    prisma: recorder.prisma,
    userId: "member-test-prepared",
  });
  assert.deepEqual([...prepared.keys()].sort(), ["control", "device", "ingress", "runtime"]);

  steps.length = 0;
  await provisionPreparedHostedCryptoDomainRootsTx({
    prepared,
    reason: "test.prepared-activation",
    tx: recorder.prisma,
    userId: "member-test-prepared",
  });

  assert.deepEqual(steps, [
    "db.advisory-lock",
    "db.read-active-envelope",
    "db.insert-envelope",
    "db.insert-audit",
    "db.advisory-lock",
    "db.read-active-envelope",
    "db.insert-envelope",
    "db.insert-audit",
    "db.advisory-lock",
    "db.read-active-envelope",
    "db.insert-envelope",
    "db.insert-audit",
    "db.advisory-lock",
    "db.read-active-envelope",
    "db.insert-envelope",
    "db.insert-audit",
  ]);
  assert.deepEqual(
    recorder.persistedEnvelopes.map((envelope) => envelope.domain).sort(),
    ["control", "device", "ingress", "runtime"],
  );
});

test("legacy transaction provisioning prepares every candidate before its first advisory lock", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const encryptCalls: GcpKmsEncryptInput[] = [];
  const signCalls: GcpKmsAsymmetricSignInput[] = [];
  const operationMetrics = createLocalKmsOperationMetrics();
  const steps: string[] = [];
  gcpKmsMock.client = createStepRecordingKmsClient({
    client: createLocalKmsClient({
      encryptCalls,
      operationMetrics,
      signCalls,
      signer: signer.privateKey,
    }),
    steps,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const { provisionHostedCryptoDomainRootsForUserTx } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const recorder = createStepRecordingTransaction(steps);

  await provisionHostedCryptoDomainRootsForUserTx({
    reason: "test.legacy-transaction-bridge",
    tx: recorder.prisma,
    userId: "member-test-legacy-bridge",
  });

  const firstAdvisoryLock = steps.indexOf("db.advisory-lock");
  assert.notEqual(firstAdvisoryLock, -1);
  assert.equal(steps[0], "db.read-active-domains");
  assert.ok(
    steps.slice(0, firstAdvisoryLock).some((step) => step.startsWith("kms.")),
  );
  assert.ok(
    steps.slice(firstAdvisoryLock).every((step) => !step.startsWith("kms.")),
  );
  assert.equal(encryptCalls.length, 3);
  assert.equal(signCalls.length, 4);
  assert.equal(operationMetrics.callCount, 7);
  assert.ok(operationMetrics.maxConcurrent >= 1);
  assert.ok(operationMetrics.maxConcurrent <= 4);
  assert.equal(steps.filter((step) => step === "db.advisory-lock").length, 4);
  assert.equal(recorder.persistedEnvelopes.length, 4);
});

test("prepared-only provisioning fails closed without signing inside the transaction", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const encryptCalls: GcpKmsEncryptInput[] = [];
  const signCalls: GcpKmsAsymmetricSignInput[] = [];
  const steps: string[] = [];
  gcpKmsMock.client = createStepRecordingKmsClient({
    client: createLocalKmsClient({
      encryptCalls,
      signCalls,
      signer: signer.privateKey,
    }),
    steps,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    HostedCryptoDomainRootCandidateRequiredError,
    provisionPreparedHostedCryptoDomainRootsTx,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const recorder = createStepRecordingTransaction(steps);

  await expect(provisionPreparedHostedCryptoDomainRootsTx({
    prepared: new Map(),
    reason: "test.missing-prepared-candidate",
    tx: recorder.prisma,
    userId: "member-test-missing-candidate",
  })).rejects.toBeInstanceOf(HostedCryptoDomainRootCandidateRequiredError);

  assert.deepEqual(steps, [
    "db.advisory-lock",
    "db.read-active-envelope",
  ]);
  assert.equal(encryptCalls.length, 0);
  assert.equal(signCalls.length, 0);
  assert.equal(recorder.persistedEnvelopes.length, 0);
});

test("discards a prepared hosted domain root candidate when another writer wins the race", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const encryptCalls: GcpKmsEncryptInput[] = [];
  gcpKmsMock.client = createLocalKmsClient({
    encryptCalls,
    signCalls: [],
    signer: signer.privateKey,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    prepareHostedCryptoDomainRootCandidates,
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
    provisionPreparedHostedCryptoDomainRootsTx,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const tx = createCapturingTransaction();

  const prepared = await prepareHostedCryptoDomainRootCandidates({
    prisma: tx.prisma,
    userId: "member-test-race",
  });

  // Another writer commits the control root between phase one and phase two.
  const winner = await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: tx.prisma,
    reason: "test.race-winner",
    userId: "member-test-race",
  });
  assert.notEqual(winner.rootKeyId, prepared.get("control")?.rootKeyId);

  await provisionPreparedHostedCryptoDomainRootsTx({
    prepared,
    reason: "test.race",
    tx: tx.prisma,
    userId: "member-test-race",
  });

  const controlEnvelopes = tx.persistedEnvelopes.filter((envelope) =>
    envelope.domain === "control");
  assert.equal(controlEnvelopes.length, 1);
  assert.equal(controlEnvelopes[0]?.rootKeyId, winner.rootKeyId);
  for (const domain of ["device", "ingress", "runtime"] as const) {
    const persisted = tx.persistedEnvelopes.filter((envelope) => envelope.domain === domain);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.rootKeyId, prepared.get(domain)?.rootKeyId);
  }

  // The discarded candidate's plaintext root key is zeroized like every other,
  // so losing the race never leaves usable key material behind.
  assert.ok(encryptCalls.length >= 4);
  for (const call of encryptCalls) {
    assert.ok(call.plaintext.every((byte) => byte === 0));
  }
});

test("rejects a prepared hosted domain root candidate bound to another user before any database work", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const steps: string[] = [];
  gcpKmsMock.client = createStepRecordingKmsClient({
    client: createLocalKmsClient({
      encryptCalls: [],
      signCalls: [],
      signer: signer.privateKey,
    }),
    steps,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    prepareHostedCryptoDomainRootCandidates,
    provisionPreparedHostedCryptoDomainRootsTx,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const recorder = createStepRecordingTransaction(steps);

  const prepared = await prepareHostedCryptoDomainRootCandidates({
    prisma: recorder.prisma,
    userId: "member-test-other",
  });

  steps.length = 0;
  await expect(provisionPreparedHostedCryptoDomainRootsTx({
    prepared,
    reason: "test.mismatched-candidate-user",
    tx: recorder.prisma,
    userId: "member-test-mine",
  })).rejects.toThrow(/does not match the requested user\/domain/u);
  // Rejecting after the advisory lock or the re-read would still refuse the
  // insert, but it would take a per-domain lock on behalf of a candidate the
  // caller was never allowed to submit. The guard has to run first.
  assert.deepEqual(steps, []);
  assert.equal(recorder.persistedEnvelopes.length, 0);
});

test("rejects a prepared hosted domain root candidate bound to another domain before any database work", async () => {
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const steps: string[] = [];
  gcpKmsMock.client = createStepRecordingKmsClient({
    client: createLocalKmsClient({
      encryptCalls: [],
      signCalls: [],
      signer: signer.privateKey,
    }),
    steps,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  const {
    prepareHostedCryptoDomainRootCandidates,
    provisionPreparedHostedCryptoDomainRootsTx,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const recorder = createStepRecordingTransaction(steps);

  const prepared = await prepareHostedCryptoDomainRootCandidates({
    prisma: recorder.prisma,
    userId: "member-test-crossed-domain",
  });
  const deviceCandidate = prepared.get("device");
  assert.ok(deviceCandidate);

  // Same user, so only the domain differs: the device envelope is filed under
  // the control key. Inserting it would store a device-scoped root as the
  // control root, and every control-domain decrypt would then reach for wraps
  // bound to a different domain's encryption context.
  const crossedDomains = new Map(prepared);
  crossedDomains.set("control", deviceCandidate);

  steps.length = 0;
  await expect(provisionPreparedHostedCryptoDomainRootsTx({
    prepared: crossedDomains,
    reason: "test.mismatched-candidate-domain",
    tx: recorder.prisma,
    userId: "member-test-crossed-domain",
  })).rejects.toThrow(/does not match the requested user\/domain/u);
  assert.deepEqual(steps, []);
  assert.equal(recorder.persistedEnvelopes.length, 0);
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

  const openedPlaintexts = captureDecodedPlaintexts();
  await expect(decryptHostedWebNullableString({
    field: "hosted-member-identity.phone-number",
    memberId: "member-test-transaction",
    prisma: tx.prisma,
    value: ciphertext,
  })).resolves.toBe("redacted-phone-token");
  expect(openedPlaintexts).toHaveLength(1);
  expect(new Uint8Array(openedPlaintexts[0]!).every((byte) => byte === 0)).toBe(true);
  assert.equal(tx.persistedEnvelopes.length, 1);
});

test("member email batches use one envelope query with bounded KMS unwraps", async () => {
  const { decryptMetrics, tx } = await createHostedWebCryptoTransactionFixture();
  const memberIds = Array.from({ length: 6 }, (_, index) => `member-batch-${index + 1}`);
  const records = await createBatchPrivateFieldRecords({ memberIds, tx });
  const envelopeFindMany = createBatchEnvelopeFindMany(tx);
  const emailFindMany = vi.fn().mockResolvedValue(records.emailRecords);
  const prisma = Object.assign(tx.prisma, {
    hostedMemberEmailAuthorization: { findMany: emailFindMany },
    hostedUserCryptoEnvelope: { findMany: envelopeFindMany },
  });

  const openedPlaintexts = captureDecodedPlaintexts();
  resetLocalKmsDecryptMetrics(decryptMetrics, { yieldBeforeReturn: true });
  await expect(readHostedMemberVerifiedEmailSnapshots({
    memberIds: [...memberIds, memberIds[0]!],
    prisma,
  })).resolves.toEqual(memberIds.map((memberId, index) => ({
    memberId,
    verifiedEmail: {
      address: `member-${index + 1}@example.test`,
      lookupKey: `email-lookup-${index + 1}`,
      verifiedAt: new Date("2026-07-15T12:00:00.000Z"),
    },
  })));
  expect(emailFindMany).toHaveBeenCalledTimes(1);
  expect(envelopeFindMany).toHaveBeenCalledTimes(1);
  expect(decryptMetrics.calls).toHaveLength(memberIds.length);
  expect(decryptMetrics.maxConcurrent).toBeGreaterThanOrEqual(1);
  expect(decryptMetrics.maxConcurrent).toBeLessThanOrEqual(4);
  expect(decryptMetrics.returnedPlaintexts.every((plaintext) =>
    plaintext.every((byte) => byte === 0)
  )).toBe(true);
  expect(openedPlaintexts).toHaveLength(memberIds.length);
  expect(openedPlaintexts.every((plaintext) =>
    new Uint8Array(plaintext).every((byte) => byte === 0)
  )).toBe(true);
});

test("batch private-field decrypt deduplicates roots and fails closed on missing envelopes", async () => {
  const { decryptMetrics, tx } = await createHostedWebCryptoTransactionFixture();
  const memberIds = ["member-batch-present", "member-batch-missing"];
  const records = await createBatchPrivateFieldRecords({ memberIds, tx });
  const envelopeFindMany = createBatchEnvelopeFindMany(tx);
  const prisma = Object.assign(tx.prisma, {
    hostedUserCryptoEnvelope: { findMany: envelopeFindMany },
  });
  const first = records.identityRecords[0]!;
  const second = records.identityRecords[1]!;

  resetLocalKmsDecryptMetrics(decryptMetrics, { yieldBeforeReturn: true });
  await expect(decryptHostedWebNullableStrings({
    field: "hosted-member-identity.phone-number",
    prisma,
    values: [
      { memberId: first.memberId, value: first.phoneNumberEncrypted },
      { memberId: first.memberId, value: first.phoneNumberEncrypted },
    ],
  })).resolves.toEqual(["+12125550001", "+12125550001"]);
  expect(envelopeFindMany).toHaveBeenCalledTimes(1);
  expect(envelopeFindMany.mock.calls[0]?.[0]?.where?.OR).toHaveLength(1);
  expect(decryptMetrics.calls).toHaveLength(1);

  envelopeFindMany.mockImplementationOnce(async () =>
    buildBatchEnvelopeRows(tx).filter((row) => row.userId !== second.memberId)
  );
  resetLocalKmsDecryptMetrics(decryptMetrics, { yieldBeforeReturn: true });
  await expect(decryptHostedWebNullableStrings({
    field: "hosted-member-identity.phone-number",
    prisma,
    values: records.identityRecords.map((record) => ({
      memberId: record.memberId,
      value: record.phoneNumberEncrypted,
    })),
  })).rejects.toThrow(/domain root envelope is not available/u);
  expect(decryptMetrics.calls).toHaveLength(0);

  const [firstEnvelope, secondEnvelope] = tx.persistedEnvelopes;
  assert.ok(firstEnvelope);
  assert.ok(secondEnvelope);
  envelopeFindMany.mockImplementationOnce(async () =>
    buildBatchEnvelopeRows(tx).map((row) =>
      row.userId === second.memberId
        ? { ...row, signedEnvelopeJson: firstEnvelope }
        : row
    )
  );
  resetLocalKmsDecryptMetrics(decryptMetrics, { yieldBeforeReturn: true });
  await expect(decryptHostedWebNullableStrings({
    field: "hosted-member-identity.phone-number",
    prisma,
    values: records.identityRecords.map((record) => ({
      memberId: record.memberId,
      value: record.phoneNumberEncrypted,
    })),
  })).rejects.toThrow(/row does not match requested user\/domain/u);
  expect(decryptMetrics.calls).toHaveLength(0);
});

test("batch private-field decrypt zeroizes successful roots when a bounded KMS chunk fails", async () => {
  const { decryptMetrics, tx } = await createHostedWebCryptoTransactionFixture();
  const memberIds = Array.from({ length: 5 }, (_, index) => `member-batch-failure-${index + 1}`);
  const records = await createBatchPrivateFieldRecords({ memberIds, tx });
  const envelopeFindMany = createBatchEnvelopeFindMany(tx);
  const prisma = Object.assign(tx.prisma, {
    hostedUserCryptoEnvelope: { findMany: envelopeFindMany },
  });

  resetLocalKmsDecryptMetrics(decryptMetrics, {
    failAtCall: 2,
    yieldBeforeReturn: true,
  });
  await expect(decryptHostedWebNullableStrings({
    field: "hosted-member-identity.phone-number",
    prisma,
    values: records.identityRecords.map((record) => ({
      memberId: record.memberId,
      value: record.phoneNumberEncrypted,
    })),
  })).rejects.toThrow("Test KMS decrypt failure.");
  expect(envelopeFindMany).toHaveBeenCalledTimes(1);
  expect(decryptMetrics.calls).toHaveLength(4);
  expect(decryptMetrics.maxConcurrent).toBeGreaterThanOrEqual(1);
  expect(decryptMetrics.maxConcurrent).toBeLessThanOrEqual(4);
  expect(decryptMetrics.returnedPlaintexts).toHaveLength(3);
  expect(decryptMetrics.returnedPlaintexts.every((plaintext) =>
    plaintext.every((byte) => byte === 0)
  )).toBe(true);
});

test("batch private-field decrypt zeroizes invalid KMS plaintext and stops before the next chunk", async () => {
  const { decryptMetrics, tx } = await createHostedWebCryptoTransactionFixture();
  const memberIds = Array.from({ length: 5 }, (_, index) =>
    `member-batch-invalid-root-${index + 1}`
  );
  const records = await createBatchPrivateFieldRecords({ memberIds, tx });
  const envelopeFindMany = createBatchEnvelopeFindMany(tx);
  const prisma = Object.assign(tx.prisma, {
    hostedUserCryptoEnvelope: { findMany: envelopeFindMany },
  });

  resetLocalKmsDecryptMetrics(decryptMetrics, {
    invalidPlaintextAtCall: 2,
    yieldBeforeReturn: true,
  });
  await expect(decryptHostedWebNullableStrings({
    field: "hosted-member-identity.phone-number",
    prisma,
    values: records.identityRecords.map((record) => ({
      memberId: record.memberId,
      value: record.phoneNumberEncrypted,
    })),
  })).rejects.toThrow(/decrypt returned invalid root length/u);
  expect(envelopeFindMany).toHaveBeenCalledTimes(1);
  expect(decryptMetrics.calls).toHaveLength(4);
  expect(decryptMetrics.maxConcurrent).toBeGreaterThanOrEqual(1);
  expect(decryptMetrics.maxConcurrent).toBeLessThanOrEqual(4);
  expect(decryptMetrics.returnedPlaintexts).toHaveLength(4);
  expect(decryptMetrics.returnedPlaintexts.every((plaintext) =>
    plaintext.every((byte) => byte === 0)
  )).toBe(true);
});

test("domain root unwraps are memoized inside the scoped cache and wiped at scope end", async () => {
  const { tx } = await createHostedWebCryptoTransactionFixture();
  const {
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
    unwrapHostedDomainRootForWeb,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const { runWithHostedDomainRootUnwrapCache } = await import(
    "../src/lib/hosted-crypto/domain-root-unwrap-cache"
  );

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-memo",
  });

  const counting = createEnvelopeReadCountingClient(tx.prisma);
  const keys: Uint8Array[] = [];
  await runWithHostedDomainRootUnwrapCache(async () => {
    const first = await unwrapHostedDomainRootForWeb({
      domain: "control",
      prisma: counting.client,
      userId: "member-test-memo",
    });
    const readsAfterFirst = counting.readCount();
    assert.ok(readsAfterFirst > 0);

    const second = await unwrapHostedDomainRootForWeb({
      domain: "control",
      prisma: counting.client,
      userId: "member-test-memo",
    });
    assert.equal(counting.readCount(), readsAfterFirst);

    // Callers receive independent copies so per-call zeroization cannot
    // corrupt later unwraps.
    assert.notEqual(first.rootKey, second.rootKey);
    assert.deepEqual(Array.from(first.rootKey), Array.from(second.rootKey));
    first.rootKey.fill(0);
    assert.ok(second.rootKey.some((byte) => byte !== 0));
    keys.push(second.rootKey);
  });
  assert.ok(keys[0]);

  // Outside a scope every unwrap re-reads (no ambient caching).
  const outside = createEnvelopeReadCountingClient(tx.prisma);
  await unwrapHostedDomainRootForWeb({
    domain: "control",
    prisma: outside.client,
    userId: "member-test-memo",
  });
  const outsideFirst = outside.readCount();
  await unwrapHostedDomainRootForWeb({
    domain: "control",
    prisma: outside.client,
    userId: "member-test-memo",
  });
  assert.ok(outside.readCount() > outsideFirst);
});

test("nested domain root cache scopes reuse the transaction-owned cache", async () => {
  const {
    getHostedDomainRootUnwrapCache,
    runWithHostedDomainRootUnwrapCache,
  } = await import("../src/lib/hosted-crypto/domain-root-unwrap-cache");
  let outerCache: ReturnType<typeof getHostedDomainRootUnwrapCache> = undefined;
  let nestedCache: ReturnType<typeof getHostedDomainRootUnwrapCache> = undefined;
  let resumedOuterCache: ReturnType<typeof getHostedDomainRootUnwrapCache> =
    undefined;

  await runWithHostedDomainRootUnwrapCache(async () => {
    outerCache = getHostedDomainRootUnwrapCache();
    await runWithHostedDomainRootUnwrapCache(async () => {
      nestedCache = getHostedDomainRootUnwrapCache();
    });
    resumedOuterCache = getHostedDomainRootUnwrapCache();
  });

  assert.ok(outerCache);
  assert.equal(nestedCache, outerCache);
  assert.equal(resumedOuterCache, outerCache);
  assert.equal(getHostedDomainRootUnwrapCache(), undefined);
});

test("scoped domain root cache does not cache failed unwraps", async () => {
  const { tx } = await createHostedWebCryptoTransactionFixture();
  const {
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
    unwrapHostedDomainRootForWeb,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const { runWithHostedDomainRootUnwrapCache } = await import(
    "../src/lib/hosted-crypto/domain-root-unwrap-cache"
  );

  await runWithHostedDomainRootUnwrapCache(async () => {
    await expect(unwrapHostedDomainRootForWeb({
      domain: "control",
      prisma: tx.prisma,
      userId: "member-test-retry",
    })).rejects.toThrow();

    await provisionActiveHostedDomainRootEnvelopeForUserOnly({
      domain: "control",
      prisma: tx.prisma,
      reason: "test.provision",
      userId: "member-test-retry",
    });

    const retried = await unwrapHostedDomainRootForWeb({
      domain: "control",
      prisma: tx.prisma,
      userId: "member-test-retry",
    });
    assert.ok(retried.rootKey.some((byte) => byte !== 0));
  });
});

test("webhook preflight retains a failed unwrap through the following transaction only", async () => {
  const { decryptMetrics, tx } = await createHostedWebCryptoTransactionFixture();
  const {
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
    unwrapHostedDomainRootForWeb,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const {
    runHostedOnboardingWebhookTransaction,
    warmHostedLinqMailboxPayloadRoot,
  } = await import("../src/lib/hosted-onboarding/webhook-service");
  const { parseHostedLinqWebhookEvent } = await import(
    "../src/lib/hosted-onboarding/linq"
  );

  for (const domain of ["control", "device", "ingress", "runtime"] as const) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({
      domain,
      prisma: tx.prisma,
      reason: "test.provision",
      userId: "member-test-webhook-preflight",
    });
  }

  resetLocalKmsDecryptMetrics(decryptMetrics, { failAtCall: 1 });
  let transactionStarted = false;
  // This fixture supplies the exact raw-query and transaction surface used by
  // the composition under test; the assertion is confined to that boundary.
  const prisma = Object.assign(tx.prisma, {
    $transaction: async <T>(
      callback: (transaction: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      transactionStarted = true;
      expect(decryptMetrics.calls).toHaveLength(1);
      return callback(tx.prisma);
    },
    hostedMember: {
      findUnique: async () => ({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      }),
    },
  });
  const event = parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: "2026-07-26T12:00:00.000Z",
    data: {
      chat: {
        id: "chat-webhook-preflight",
        is_group: true,
        owner_handle: {
          handle: "+15550000000",
          id: "owner-webhook-preflight",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      id: "message-webhook-preflight",
      is_from_me: false,
      parts: [{ type: "text", value: "hello" }],
      sender_handle: {
        handle: "+15555550123",
        id: "sender-webhook-preflight",
        service: "sms",
      },
      sent_at: "2026-07-26T12:00:00.000Z",
      service: "sms",
    },
    event_id: "event-webhook-preflight",
    event_type: "message.received",
    webhook_version: "2026-02-03",
  }));

  await expect(runHostedOnboardingWebhookTransaction(
    // @ts-expect-error - this integration fixture implements the exact Prisma
    // transaction and delegates exercised by the composition under test.
    prisma,
    async (transaction) => {
      await unwrapHostedDomainRootForWeb({
        domain: "ingress",
        prisma: transaction,
        userId: "member-test-webhook-preflight",
      });
      return "unexpected";
    },
    () => warmHostedLinqMailboxPayloadRoot({
      event,
      prisma,
      threadRoute: {
        containerMemberId: "member-test-webhook-preflight",
      },
    }),
  )).rejects.toThrow("Test KMS decrypt failure.");

  expect(transactionStarted).toBe(true);
  expect(decryptMetrics.calls).toHaveLength(1);

  resetLocalKmsDecryptMetrics(decryptMetrics, { failAtCall: 1 });
  transactionStarted = false;
  await expect(runHostedOnboardingWebhookTransaction(
    // @ts-expect-error - this integration fixture implements the exact Prisma
    // transaction and delegates exercised by the composition under test.
    prisma,
    async () => "branch-without-root",
    () => warmHostedLinqMailboxPayloadRoot({
      event,
      prisma,
      threadRoute: {
        containerMemberId: "member-test-webhook-preflight",
      },
    }),
  )).resolves.toBe("branch-without-root");

  expect(transactionStarted).toBe(true);
  expect(decryptMetrics.calls).toHaveLength(1);
});

test("webhook-style multi-field crypto reuses one unwrap per domain inside the scope", async () => {
  const { tx } = await createHostedWebCryptoTransactionFixture();
  const {
    provisionActiveHostedDomainRootEnvelopeForUserOnly,
  } = await import("../src/lib/hosted-crypto/domain-root-store");
  const { runWithHostedDomainRootUnwrapCache } = await import(
    "../src/lib/hosted-crypto/domain-root-unwrap-cache"
  );

  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: tx.prisma,
    reason: "test.provision",
    userId: "member-test-fields",
  });

  const counting = createEnvelopeReadCountingClient(tx.prisma);
  await runWithHostedDomainRootUnwrapCache(async () => {
    const ciphertexts = await Promise.all([
      encryptHostedWebNullableString({
        field: "hosted-member-identity.phone-number",
        memberId: "member-test-fields",
        prisma: counting.client,
        value: "redacted-phone-token",
      }),
      encryptHostedWebNullableString({
        field: "hosted-member-routing.linq-chat-id",
        memberId: "member-test-fields",
        prisma: counting.client,
        value: "redacted-chat-token",
      }),
    ]);
    const readsAfterSeals = counting.readCount();
    assert.equal(readsAfterSeals, 1);

    await expect(decryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: "member-test-fields",
      prisma: counting.client,
      value: ciphertexts[0],
    })).resolves.toBe("redacted-phone-token");
    await expect(decryptHostedWebNullableString({
      field: "hosted-member-routing.linq-chat-id",
      memberId: "member-test-fields",
      prisma: counting.client,
      value: ciphertexts[1],
    })).resolves.toBe("redacted-chat-token");
    // The active-root entry aliases its concrete rootKeyId, so later opens
    // reuse the same unwrap without weakening per-call key copies.
    assert.equal(counting.readCount(), readsAfterSeals);
  });
});

test("batch private-field sealing unwraps once and preserves member-bound AAD", async () => {
  const { tx } = await createHostedWebCryptoTransactionFixture();
  const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const memberId = "member-test-address-book-batch";
  const scope = "hosted-address-book-advisory-name:v1";
  const entries = [
    {
      aad: {
        field: "advisory_name",
        purpose: "hosted-address-book-advisory-name",
        rowId: "1:phone-token-a",
        table: "hosted_address_book_contact",
      },
      scope,
      value: "Alex R.",
    },
    {
      aad: {
        field: "advisory_name",
        purpose: "hosted-address-book-advisory-name",
        rowId: "1:phone-token-b",
        table: "hosted_address_book_contact",
      },
      scope,
      value: "Sam K.",
    },
  ] as const;
  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: tx.prisma,
    reason: "test.address-book-batch",
    userId: memberId,
  });
  const counting = createEnvelopeReadCountingClient(tx.prisma);
  const prisma = Object.assign(counting.client, {
    hostedUserCryptoEnvelope: {
      findMany: createBatchEnvelopeFindMany(tx),
    },
  });

  const sealed = await sealHostedUserSecureBoxStrings({
    entries,
    lane: "hosted-member-private-field",
    prisma,
    userId: memberId,
  });

  assert.equal(sealed.length, 2);
  assert.equal(counting.readCount(), 1);
  await expect(openHostedUserSecureBoxStrings({
    entries: entries.map((entry, index) => ({
      aad: entry.aad,
      scope: entry.scope,
      userId: memberId,
      value: sealed[index],
    })),
    lane: "hosted-member-private-field",
    prisma,
  })).resolves.toEqual(["Alex R.", "Sam K."]);

  await expect(openHostedUserSecureBoxStrings({
    entries: [{
      aad: { ...entries[0].aad, rowId: "1:different-phone-token" },
      scope,
      userId: memberId,
      value: sealed[0],
    }],
    lane: "hosted-member-private-field",
    prisma,
  })).rejects.toThrow();
  await expect(openHostedUserSecureBoxStrings({
    entries: [{
      aad: entries[0].aad,
      scope,
      userId: "different-member",
      value: sealed[0],
    }],
    lane: "hosted-member-private-field",
    prisma,
  })).rejects.toThrow();
});

function createEnvelopeReadCountingClient(
  base: HostedCryptoTestTransaction["prisma"],
): { client: HostedCryptoTestTransaction["prisma"]; readCount: () => number } {
  let reads = 0;
  const client = {
    ...base,
    $queryRaw: async (...args: Parameters<typeof base.$queryRaw>) => {
      reads += 1;
      return base.$queryRaw(...args);
    },
  };
  return {
    client: client as HostedCryptoTestTransaction["prisma"],
    readCount: () => reads,
  };
}

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
  decryptMetrics: LocalKmsDecryptMetrics;
  encryptCalls: GcpKmsEncryptInput[];
  signCalls: GcpKmsAsymmetricSignInput[];
  tx: HostedCryptoTestTransaction;
}> {
  setHostedSecureBoxStringTestCodecForTests(null);
  const signer = await generateP256SigningKeyPair();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const decryptMetrics = createLocalKmsDecryptMetrics();
  const encryptCalls: GcpKmsEncryptInput[] = [];
  const signCalls: GcpKmsAsymmetricSignInput[] = [];
  gcpKmsMock.client = createLocalKmsClient({
    decryptMetrics,
    encryptCalls,
    signCalls,
    signer: signer.privateKey,
  });
  stubHostedCryptoEnv({
    cloudflarePublicJwk: cloudflareRecipient.publicJwk,
    signerPublicKeyPem: signer.publicKeyPem,
  });

  return {
    decryptMetrics,
    encryptCalls,
    signCalls,
    tx: createTransaction(),
  };
}

async function createBatchPrivateFieldRecords(input: {
  memberIds: readonly string[];
  tx: HostedCryptoTestTransaction;
}) {
  const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
    "../src/lib/hosted-crypto/domain-root-store"
  );
  const emailRecords = [] as Array<{
    memberId: string;
    verifiedEmailAddressEncrypted: string | null;
    verifiedEmailLookupKey: string;
    verifiedEmailVerifiedAt: Date;
  }>;
  const identityRecords = [] as Array<{
    memberId: string;
    phoneNumberEncrypted: string | null;
  }>;
  for (const [index, memberId] of input.memberIds.entries()) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({
      domain: "control",
      prisma: input.tx.prisma,
      reason: "test.batch-provision",
      userId: memberId,
    });
    emailRecords.push({
      memberId,
      verifiedEmailAddressEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-email-authorization.verified-email",
        memberId,
        prisma: input.tx.prisma,
        value: `member-${index + 1}@example.test`,
      }),
      verifiedEmailLookupKey: `email-lookup-${index + 1}`,
      verifiedEmailVerifiedAt: new Date("2026-07-15T12:00:00.000Z"),
    });
    identityRecords.push({
      memberId,
      phoneNumberEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-identity.phone-number",
        memberId,
        prisma: input.tx.prisma,
        value: `+12125550${String(index + 1).padStart(3, "0")}`,
      }),
    });
  }
  return { emailRecords, identityRecords };
}

function createBatchEnvelopeFindMany(tx: HostedCryptoTestTransaction) {
  return vi.fn(async (input: {
    where?: {
      OR?: Array<{ domain: string; rootKeyId: string; userId: string }>;
    };
  }) => {
    const requestedKeys = new Set((input.where?.OR ?? []).map((reference) =>
      `${reference.userId}|${reference.domain}|${reference.rootKeyId}`
    ));
    return buildBatchEnvelopeRows(tx).filter((row) =>
      requestedKeys.has(`${row.userId}|${row.domain}|${row.rootKeyId}`)
    );
  });
}

function buildBatchEnvelopeRows(tx: HostedCryptoTestTransaction) {
  return tx.persistedEnvelopes.map((envelope) => ({
    domain: envelope.domain,
    id: `row-${envelope.userId}-${envelope.domain}`,
    rootKeyId: envelope.rootKeyId,
    signedEnvelopeJson: envelope,
    status: "active" as const,
    updatedAt: new Date(envelope.updatedAt),
    userId: envelope.userId,
  }));
}

function captureDecodedPlaintexts(): Uint8Array[] {
  const outputs: Uint8Array[] = [];
  const decode = TextDecoder.prototype.decode;
  vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (
    this: TextDecoder,
    input,
    options,
  ) {
    if (input instanceof Uint8Array) {
      outputs.push(input);
    }
    return decode.call(this, input, options);
  });
  return outputs;
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
      if (sql.includes("SELECT DISTINCT domain")) {
        const domains = new Set(
          persistedEnvelopes
            .filter((candidate) => candidate.userId === userId)
            .filter((candidate) => !inactiveEnvelopeKeys.has(createEnvelopeStatusKey(candidate)))
            .map((candidate) => candidate.domain),
        );
        return [...domains].map((domain) => ({ domain })) as T;
      }

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

/**
 * Records the ordered KMS and database steps a provisioning call makes, so a
 * test can prove envelope signing happens before `BEGIN` rather than while a
 * connection and the per-domain advisory lock are held.
 */
function createStepRecordingKmsClient(input: {
  client: HostedGcpKmsClient;
  steps: string[];
}): HostedGcpKmsClient {
  return {
    async asymmetricSign(signInput) {
      input.steps.push("kms.asymmetric-sign");
      return input.client.asymmetricSign(signInput);
    },
    async decrypt(decryptInput) {
      input.steps.push("kms.decrypt");
      return input.client.decrypt(decryptInput);
    },
    async macSign(macInput) {
      input.steps.push("kms.mac-sign");
      return input.client.macSign(macInput);
    },
    async encrypt(encryptInput) {
      input.steps.push("kms.encrypt");
      return input.client.encrypt(encryptInput);
    },
  };
}

function createStepRecordingTransaction(steps: string[]): {
  persistedEnvelopes: HostedDomainRootKeyEnvelopeV1[];
  prisma: Prisma.TransactionClient;
} {
  const tx = createCapturingTransaction();
  const base = {
    $executeRaw: async (...args: Parameters<Prisma.TransactionClient["$executeRaw"]>) => {
      steps.push(describeHostedCryptoSql(args[0]));
      return tx.prisma.$executeRaw(...args);
    },
    $queryRaw: async <T = unknown>(
      ...args: Parameters<Prisma.TransactionClient["$queryRaw"]>
    ): Promise<T> => {
      steps.push(describeHostedCryptoSql(args[0]));
      return tx.prisma.$queryRaw<T>(...args);
    },
  };
  // Narrow test double: domain-root-store only uses Prisma raw query helpers
  // plus the interactive-transaction root here.
  const recorded = base as Prisma.TransactionClient;
  return {
    persistedEnvelopes: tx.persistedEnvelopes,
    prisma: Object.assign(recorded, {
      async $transaction<T>(
        run: (transaction: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> {
        steps.push("transaction.begin");
        try {
          return await run(recorded);
        } finally {
          steps.push("transaction.commit");
        }
      },
    }),
  };
}

function describeHostedCryptoSql(query: unknown): string {
  const sql = Array.isArray(query) ? query.join(" ") : String(query);
  if (sql.includes("pg_advisory_xact_lock")) {
    return "db.advisory-lock";
  }
  if (sql.includes("INSERT INTO hosted_user_crypto_envelope")) {
    return "db.insert-envelope";
  }
  if (sql.includes("INSERT INTO hosted_user_crypto_audit")) {
    return "db.insert-audit";
  }
  if (sql.includes("SELECT DISTINCT domain")) {
    return "db.read-active-domains";
  }
  if (sql.includes("FROM hosted_user_crypto_envelope")) {
    return "db.read-active-envelope";
  }
  return `db.other:${sql}`;
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
        assistantPersona: input.data.assistantPersona ?? null,
        assistantPersonaCausalSeq:
          input.data.assistantPersonaCausalSeq === undefined ||
          input.data.assistantPersonaCausalSeq === null
            ? null
            : BigInt(input.data.assistantPersonaCausalSeq),
        assistantDetail: null,
        assistantDetailCausalSeq:
          input.data.assistantDetailCausalSeq === undefined ||
          input.data.assistantDetailCausalSeq === null
            ? null
            : BigInt(input.data.assistantDetailCausalSeq),
        assistantHumor: null,
        assistantHumorCausalSeq:
          input.data.assistantHumorCausalSeq === undefined ||
          input.data.assistantHumorCausalSeq === null
            ? null
            : BigInt(input.data.assistantHumorCausalSeq),
        assistantModelPreference: null,
        assistantReasoningEffortPreference: null,
        assistantPush: null,
        assistantPushCausalSeq:
          input.data.assistantPushCausalSeq === undefined ||
          input.data.assistantPushCausalSeq === null
            ? null
            : BigInt(input.data.assistantPushCausalSeq),
        assistantUnhinged: null,
        assistantUnhingedCausalSeq:
          input.data.assistantUnhingedCausalSeq === undefined ||
          input.data.assistantUnhingedCausalSeq === null
            ? null
            : BigInt(input.data.assistantUnhingedCausalSeq),
        assistantTone: null,
        assistantToneCausalSeq: null,
        assistantVoice: null,
        assistantVoiceCausalSeq: null,
        billingStatus: input.data.billingStatus ?? HostedBillingStatus.not_started,
        createdAt: now,
        id: input.data.id,
        pendingActivationTimeZone: null,
        signupNotificationEmailAttemptedAt: null,
        signupWelcomeEmailAttemptedAt: null,
        suspendedAt: input.data.suspendedAt instanceof Date ? input.data.suspendedAt : null,
        updatedAt: now,
        usageCreditBalanceUsdMicros:
          input.data.usageCreditBalanceUsdMicros === null
            ? null
            : BigInt(input.data.usageCreditBalanceUsdMicros ?? 0),
        usageCreditLedgerVersion:
          input.data.usageCreditLedgerVersion === null
            ? null
            : BigInt(input.data.usageCreditLedgerVersion ?? 0),
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
  decryptMetrics?: LocalKmsDecryptMetrics;
  encryptCalls: GcpKmsEncryptInput[];
  operationMetrics?: LocalKmsOperationMetrics;
  signCalls: GcpKmsAsymmetricSignInput[];
  signer: CryptoKey;
}): HostedGcpKmsClient {
  return {
    async asymmetricSign(signInput) {
      input.signCalls.push(signInput);
      beginLocalKmsOperation(input.operationMetrics);
      try {
        const signature = await crypto.subtle.sign(
          { hash: "SHA-256", name: "ECDSA" },
          input.signer,
          toArrayBuffer(signInput.message),
        );
        return {
          keyVersionName: signInput.keyVersionName,
          signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
        };
      } finally {
        finishLocalKmsOperation(input.operationMetrics);
      }
    },
    async decrypt(decryptInput) {
      const metrics = input.decryptMetrics;
      metrics?.calls.push(decryptInput);
      const callNumber = metrics?.calls.length ?? 0;
      if (metrics) {
        metrics.activeCount += 1;
        metrics.maxConcurrent = Math.max(metrics.maxConcurrent, metrics.activeCount);
      }
      try {
        if (metrics?.yieldBeforeReturn) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (metrics && metrics.failAtCall === callNumber) {
          throw new Error("Test KMS decrypt failure.");
        }
        const plaintext = metrics?.invalidPlaintextAtCall === callNumber
          ? new Uint8Array(31).fill(7)
          : Uint8Array.from(Buffer.from(decryptInput.ciphertext, "base64"));
        metrics?.returnedPlaintexts.push(plaintext);
        return { plaintext };
      } finally {
        if (metrics) {
          metrics.activeCount -= 1;
        }
      }
    },
    async macSign(macInput) {
      return {
        keyVersionName: macInput.keyVersionName,
        mac: new Uint8Array(32),
      };
    },
    async encrypt(encryptInput) {
      input.encryptCalls.push(encryptInput);
      beginLocalKmsOperation(input.operationMetrics);
      try {
        if (input.operationMetrics?.yieldBeforeReturn) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return {
          ciphertext: Buffer.from(encryptInput.plaintext).toString("base64"),
          keyName: encryptInput.keyName,
        };
      } finally {
        finishLocalKmsOperation(input.operationMetrics);
      }
    },
  };
}

interface LocalKmsOperationMetrics {
  activeCount: number;
  callCount: number;
  maxConcurrent: number;
  yieldBeforeReturn: boolean;
}

function createLocalKmsOperationMetrics(): LocalKmsOperationMetrics {
  return {
    activeCount: 0,
    callCount: 0,
    maxConcurrent: 0,
    yieldBeforeReturn: true,
  };
}

function beginLocalKmsOperation(metrics: LocalKmsOperationMetrics | undefined): void {
  if (!metrics) {
    return;
  }
  metrics.activeCount += 1;
  metrics.callCount += 1;
  metrics.maxConcurrent = Math.max(metrics.maxConcurrent, metrics.activeCount);
}

function finishLocalKmsOperation(metrics: LocalKmsOperationMetrics | undefined): void {
  if (metrics) {
    metrics.activeCount -= 1;
  }
}

interface LocalKmsDecryptMetrics {
  activeCount: number;
  calls: GcpKmsDecryptInput[];
  failAtCall: number | null;
  invalidPlaintextAtCall: number | null;
  maxConcurrent: number;
  returnedPlaintexts: Uint8Array[];
  yieldBeforeReturn: boolean;
}

function createLocalKmsDecryptMetrics(): LocalKmsDecryptMetrics {
  return {
    activeCount: 0,
    calls: [],
    failAtCall: null,
    invalidPlaintextAtCall: null,
    maxConcurrent: 0,
    returnedPlaintexts: [],
    yieldBeforeReturn: false,
  };
}

function resetLocalKmsDecryptMetrics(
  metrics: LocalKmsDecryptMetrics,
  input?: {
    failAtCall?: number | null;
    invalidPlaintextAtCall?: number | null;
    yieldBeforeReturn?: boolean;
  },
): void {
  metrics.activeCount = 0;
  metrics.calls.length = 0;
  metrics.failAtCall = input?.failAtCall ?? null;
  metrics.invalidPlaintextAtCall = input?.invalidPlaintextAtCall ?? null;
  metrics.maxConcurrent = 0;
  metrics.returnedPlaintexts.length = 0;
  metrics.yieldBeforeReturn = input?.yieldBeforeReturn ?? false;
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
