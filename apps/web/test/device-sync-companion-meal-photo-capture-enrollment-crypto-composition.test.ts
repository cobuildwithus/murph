import { Buffer } from "node:buffer";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  parseSerializedHostedSecureBoxEnvelope,
  serializeAdditionalAuthenticatedData,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedGcpKmsClient,
} from "@/src/lib/hosted-crypto/gcp-kms";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";

const AUTHORITY_KEY_VERSION =
  "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1";
const WEB_WRAP_KEY_NAME =
  "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap";
const MEMBER_ID = "member_meal_photo_crypto_composition";
const INSTALLATION_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const NOW = new Date("2026-08-26T16:00:00.000Z");

const kmsMock = vi.hoisted(() => ({
  client: null as HostedGcpKmsClient | null,
}));

vi.mock("@/src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv: () => {
      if (!kmsMock.client) {
        throw new Error("Meal-photo composition KMS client was not configured.");
      }
      return kmsMock.client;
    },
  };
});

import { issueMealPhotoCaptureEnrollment } from "@/src/lib/device-sync/meal-photo-capture";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setHostedSecureBoxStringTestCodecForTests(null);
});

afterEach(() => {
  kmsMock.client = null;
  setHostedSecureBoxStringTestCodecForTests(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  clearHostedOnboardingEnvCache();
});

describe("meal-photo enrollment production crypto composition", () => {
  it("settles real device-root crypto before fresh and refresh transactions", async () => {
    const harness = await createCompositionHarness();
    const freshGate = createKmsGate();
    harness.state.nextKmsGate = freshGate;

    const freshOperation = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      now: NOW,
      prisma: harness.prisma,
      request: {
        appInstallationId: INSTALLATION_ID,
        appVersion: "1.0.0",
        schemaVersion: 1,
      },
    });
    await expectKmsGate({ gate: freshGate, operation: freshOperation });

    expect(harness.state.transactionCount).toBe(0);
    expect(harness.state.transactionDepth).toBe(0);
    freshGate.release.resolve(undefined);
    const fresh = await freshOperation;
    const freshRecord = requireEnrollment(harness.getEnrollment());
    const freshCiphertext = freshRecord.idempotencySecretEncrypted;
    const freshUploadTokenHash = freshRecord.uploadTokenHash;
    expect(parseSerializedHostedSecureBoxEnvelope(freshCiphertext).rootKeyId)
      .toBe(harness.root.envelope.rootKeyId);

    const refreshGate = createKmsGate();
    harness.state.nextKmsGate = refreshGate;
    const refreshOperation = issueMealPhotoCaptureEnrollment({
      memberId: MEMBER_ID,
      now: NOW,
      prisma: harness.prisma,
      request: {
        appInstallationId: INSTALLATION_ID,
        appVersion: "1.0.0",
        schemaVersion: 1,
      },
    });
    await expectKmsGate({ gate: refreshGate, operation: refreshOperation });

    expect(harness.state.transactionCount).toBe(1);
    expect(harness.state.transactionDepth).toBe(0);
    refreshGate.release.resolve(undefined);
    const refresh = await refreshOperation;
    const refreshRecord = requireEnrollment(harness.getEnrollment());

    expect(refresh.idempotencySecret).toBe(fresh.idempotencySecret);
    expect(refresh.expiresAt).toEqual(fresh.expiresAt);
    expect(refresh.uploadToken).not.toBe(fresh.uploadToken);
    expect(refreshRecord.idempotencySecretEncrypted).toBe(freshCiphertext);
    expect(refreshRecord.uploadTokenHash).not.toBe(freshUploadTokenHash);
    expect(harness.state.kmsTransactionStates).toEqual([false, false]);
    expect(harness.state.kmsCallsAtTransactionBegin).toEqual([1, 2]);
    expect(harness.state.kmsCallsAtTransactionEnd).toEqual([1, 2]);
    expect(harness.state.transactionCount).toBe(2);
    expect(harness.state.transactionDepth).toBe(0);
    expect(harness.state.nextKmsGate).toBeNull();
  });
});

type EnrollmentRecord = {
  activatedAt: Date | null;
  authorityRevision: number;
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  idempotencySecretEncrypted: string | null;
  installationIdHash: string;
  memberId: string;
  revokeReason: string | null;
  revokedAt: Date | null;
  updatedAt: Date;
  uploadTokenHash: string | null;
};

type RootFixture = {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKey: Uint8Array;
  row: {
    domain: "device";
    id: string;
    rootKeyId: string;
    signedEnvelopeJson: HostedDomainRootKeyEnvelopeV1;
    status: "active";
    updatedAt: Date;
    userId: string;
  };
  wrapCiphertext: string;
};

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

type KmsGate = {
  entered: Deferred<void>;
  release: Deferred<void>;
};

type CompositionState = {
  kmsCallsAtTransactionBegin: number[];
  kmsCallsAtTransactionEnd: number[];
  kmsTransactionStates: boolean[];
  nextKmsGate: KmsGate | null;
  transactionCount: number;
  transactionDepth: number;
};

async function createCompositionHarness(): Promise<{
  getEnrollment: () => EnrollmentRecord | null;
  prisma: PrismaClient;
  root: RootFixture;
  state: CompositionState;
}> {
  const signer = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const automation = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  configureHostedCryptoEnv({
    automationPublicJwk: await crypto.subtle.exportKey(
      "jwk",
      automation.publicKey,
    ),
    signerPublicKeyPem: toSpkiPem(
      await crypto.subtle.exportKey("spki", signer.publicKey),
    ),
  });
  const root = await createSignedControlRoot({ signer: signer.privateKey });
  const state: CompositionState = {
    kmsCallsAtTransactionBegin: [],
    kmsCallsAtTransactionEnd: [],
    kmsTransactionStates: [],
    nextKmsGate: null,
    transactionCount: 0,
    transactionDepth: 0,
  };
  kmsMock.client = createKmsClient({ root, state });
  return {
    ...createPrismaStub({ root, state }),
    root,
    state,
  };
}

function createKmsClient(input: {
  root: RootFixture;
  state: CompositionState;
}): HostedGcpKmsClient {
  return {
    asymmetricSign: vi.fn(async () => {
      throw new Error("Unexpected KMS sign in meal-photo composition test.");
    }),
    decrypt: vi.fn(async (request) => {
      input.state.kmsTransactionStates.push(input.state.transactionDepth > 0);
      if (request.ciphertext !== input.root.wrapCiphertext) {
        throw new Error("Unexpected KMS ciphertext in meal-photo composition test.");
      }
      const gate = input.state.nextKmsGate;
      if (!gate) {
        throw new Error("Meal-photo composition KMS call was not gated.");
      }
      input.state.nextKmsGate = null;
      gate.entered.resolve(undefined);
      await gate.release.promise;
      return { plaintext: Uint8Array.from(input.root.rootKey) };
    }),
    encrypt: vi.fn(async () => {
      throw new Error("Unexpected KMS encrypt in meal-photo composition test.");
    }),
    macSign: vi.fn(async () => {
      throw new Error("Unexpected KMS MAC in meal-photo composition test.");
    }),
  };
}

function createPrismaStub(input: {
  root: RootFixture;
  state: CompositionState;
}): {
  getEnrollment: () => EnrollmentRecord | null;
  prisma: PrismaClient;
} {
  let enrollment: EnrollmentRecord | null = null;
  const hostedMealPhotoCaptureEnrollment = {
    findUnique: vi.fn(async () => cloneEnrollment(enrollment)),
    upsert: vi.fn(async (query: {
      create: EnrollmentRecord;
      update: Partial<EnrollmentRecord>;
    }) => {
      enrollment = enrollment
        ? { ...enrollment, ...query.update }
        : { ...query.create };
      return cloneEnrollment(enrollment);
    }),
  };
  const hostedConsentGrant = {
    findMany: vi.fn(async () => historicalLaunchConsentGrants()),
  };
  const hostedUserCryptoEnvelope = {
    findMany: vi.fn(async (query: {
      where?: {
        OR?: Array<{ domain: string; rootKeyId: string; userId: string }>;
      };
    }) => (query.where?.OR ?? []).some((reference) =>
      reference.domain === input.root.row.domain
      && reference.rootKeyId === input.root.row.rootKeyId
      && reference.userId === input.root.row.userId
    ) ? [input.root.row] : []),
  };
  const queryRaw = vi.fn(async (...args: RawQueryArguments) => {
    const invocation = readRawInvocation(args);
    const sql = invocation.sql.toLowerCase();
    if (
      sql.includes("select distinct domain")
      && sql.includes("from hosted_user_crypto_envelope")
    ) {
      return [{ domain: input.root.row.domain }];
    }
    if (sql.includes("from hosted_user_crypto_envelope")) {
      return [input.root.row];
    }
    if (sql.includes("from \"hosted_member\"")) {
      return [{ id: MEMBER_ID }];
    }
    throw new Error(`Unexpected meal-photo composition query: ${invocation.sql}`);
  });
  const executeRaw = vi.fn(async () => 1);
  const txClient = prismaTransactionClientForTest({
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    hostedConsentGrant,
    hostedMealPhotoCaptureEnrollment,
    hostedUserCryptoEnvelope,
  });
  const transaction = vi.fn(async <Result>(
    callback: (tx: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> => {
    input.state.kmsCallsAtTransactionBegin.push(
      input.state.kmsTransactionStates.length,
    );
    input.state.transactionCount += 1;
    input.state.transactionDepth += 1;
    try {
      return await callback(txClient);
    } finally {
      input.state.kmsCallsAtTransactionEnd.push(
        input.state.kmsTransactionStates.length,
      );
      input.state.transactionDepth -= 1;
    }
  });
  return {
    getEnrollment: () => cloneEnrollment(enrollment),
    prisma: prismaClientForTest({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      $transaction: transaction,
      hostedConsentGrant,
      hostedMealPhotoCaptureEnrollment,
      hostedUserCryptoEnvelope,
    }),
  };
}

type RawQueryArguments = Parameters<Prisma.TransactionClient["$queryRaw"]>;

function prismaTransactionClientForTest(client: {
  $executeRaw: object;
  $queryRaw: object;
  hostedConsentGrant: object;
  hostedMealPhotoCaptureEnrollment: object;
  hostedUserCryptoEnvelope: object;
}): Prisma.TransactionClient {
  const narrowClient = client as Pick<
    Prisma.TransactionClient,
    | "$executeRaw"
    | "$queryRaw"
    | "hostedConsentGrant"
    | "hostedMealPhotoCaptureEnrollment"
    | "hostedUserCryptoEnvelope"
  >;
  return narrowClient as Prisma.TransactionClient;
}

function prismaClientForTest(client: {
  $executeRaw: object;
  $queryRaw: object;
  $transaction: object;
  hostedConsentGrant: object;
  hostedMealPhotoCaptureEnrollment: object;
  hostedUserCryptoEnvelope: object;
}): PrismaClient {
  const narrowClient = client as Pick<
    PrismaClient,
    | "$executeRaw"
    | "$queryRaw"
    | "$transaction"
    | "hostedConsentGrant"
    | "hostedMealPhotoCaptureEnrollment"
    | "hostedUserCryptoEnvelope"
  >;
  return narrowClient as PrismaClient;
}

async function createSignedControlRoot(input: {
  signer: CryptoKey;
}): Promise<RootFixture> {
  const rootKeyId = "root_meal_photo_crypto_composition";
  const rootKey = new Uint8Array(32).fill(7);
  const wrapCiphertext = "kms-meal-photo-crypto-composition";
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "device",
    env: "test",
    recipient: "web-device-kms",
    rootKeyId,
    userId: MEMBER_ID,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: NOW.toISOString(),
    domain: "device",
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: NOW.toISOString(),
    userId: MEMBER_ID,
    wraps: [{
      additionalAuthenticatedData:
        serializeAdditionalAuthenticatedData(encryptionContext),
      ciphertextBlob: wrapCiphertext,
      encryptionContext,
      kind: "gcp-kms",
      kmsKeyName: WEB_WRAP_KEY_NAME,
      recipient: "web-device-kms",
    }],
  };
  const signingPayload = buildHostedDomainRootEnvelopeSigningPayload(body);
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signer,
    toArrayBuffer(signingPayload),
  );
  signingPayload.fill(0);
  const envelope = attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: AUTHORITY_KEY_VERSION,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: NOW.toISOString(),
  });
  return {
    envelope,
    rootKey,
    row: {
      domain: "device",
      id: "crypto_envelope_meal_photo_composition",
      rootKeyId,
      signedEnvelopeJson: envelope,
      status: "active",
      updatedAt: NOW,
      userId: MEMBER_ID,
    },
    wrapCiphertext,
  };
}

function historicalLaunchConsentGrants() {
  return ["launch.legal", "launch.health-data"].map((scope, index) => ({
    createdAt: NOW,
    documentVersionsJson: {},
    grantedAt: NOW,
    lastEventId: `consent_event_${index}`,
    memberId: MEMBER_ID,
    revokedAt: null,
    scope,
    source: "test",
    status: "granted",
    updatedAt: NOW,
  }));
}

function readRawInvocation(args: readonly unknown[]): {
  sql: string;
  values: readonly unknown[];
} {
  const first = args[0];
  if (Array.isArray(first)) {
    return {
      sql: first.join("?").replace(/\s+/gu, " ").trim(),
      values: args.slice(1),
    };
  }
  if (first && typeof first === "object" && "strings" in first && "values" in first) {
    const query = first as { strings: unknown; values: unknown };
    if (Array.isArray(query.strings) && Array.isArray(query.values)) {
      return {
        sql: query.strings.join("?").replace(/\s+/gu, " ").trim(),
        values: query.values,
      };
    }
  }
  throw new Error("Expected a Prisma raw-query invocation.");
}

async function expectKmsGate<Result>(input: {
  gate: KmsGate;
  operation: Promise<Result>;
}): Promise<void> {
  await Promise.race([
    input.gate.entered.promise,
    input.operation.then(
      () => {
        throw new Error("Meal-photo enrollment completed before entering KMS.");
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
}

function createKmsGate(): KmsGate {
  return {
    entered: createDeferred<void>(),
    release: createDeferred<void>(),
  };
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function cloneEnrollment(
  enrollment: EnrollmentRecord | null,
): EnrollmentRecord | null {
  return enrollment ? { ...enrollment } : null;
}

function requireEnrollment(
  enrollment: EnrollmentRecord | null,
): EnrollmentRecord & { idempotencySecretEncrypted: string; uploadTokenHash: string } {
  if (!enrollment?.idempotencySecretEncrypted || !enrollment.uploadTokenHash) {
    throw new Error("Expected complete persisted meal-photo credentials.");
  }
  return {
    ...enrollment,
    idempotencySecretEncrypted: enrollment.idempotencySecretEncrypted,
    uploadTokenHash: enrollment.uploadTokenHash,
  };
}

function configureHostedCryptoEnv(input: {
  automationPublicJwk: JsonWebKey;
  signerPublicKeyPem: string;
}): void {
  vi.stubEnv(
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
    "cloudflare-automation:test",
  );
  vi.stubEnv(
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
    JSON.stringify(input.automationPublicJwk),
  );
  vi.stubEnv("HOSTED_CRYPTO_ENV", "test");
  vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION", AUTHORITY_KEY_VERSION);
  vi.stubEnv(
    "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    input.signerPublicKeyPem.replace(/\n/gu, "\\n"),
  );
  vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", WEB_WRAP_KEY_NAME);
  clearHostedOnboardingEnvCache();
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}
