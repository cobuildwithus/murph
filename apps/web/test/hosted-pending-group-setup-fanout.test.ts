import { Buffer } from "node:buffer";

import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  serializeAdditionalAuthenticatedData,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedGcpKmsClient } from "@/src/lib/hosted-crypto/gcp-kms";

type UnwrapHostedDomainRootsForWebByRootKeyIds =
  typeof import("@/src/lib/hosted-crypto/domain-root-store")
    .unwrapHostedDomainRootsForWebByRootKeyIds;

const mocks = vi.hoisted(() => ({
  openHostedUserSecureBoxStrings: vi.fn(),
  openHostedMemberRoutingHomeLinqRecipientPhoneRecords: vi.fn(),
  readActiveHostedLinqManagedLineLookupKeys: vi.fn(),
  readHostedLinqGroupLineRecoveryAuthoritiesTx: vi.fn(),
  readHostedMemberRoutingHomeLinqRecipientPhoneRecords: vi.fn(),
  readHostedRuntimeAiAllowedMemberIds: vi.fn(),
  unwrapHostedDomainRootsForWebByRootKeyIds: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  actualUnwrapHostedDomainRootsForWebByRootKeyIds:
    null as UnwrapHostedDomainRootsForWebByRootKeyIds | null,
  gcpKmsClient: null as HostedGcpKmsClient | null,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  cryptoMocks.actualUnwrapHostedDomainRootsForWebByRootKeyIds =
    actual.unwrapHostedDomainRootsForWebByRootKeyIds;
  return {
    ...actual,
    unwrapHostedDomainRootsForWebByRootKeyIds:
      mocks.unwrapHostedDomainRootsForWebByRootKeyIds,
  };
});

vi.mock("@/src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv: () => {
      if (!cryptoMocks.gcpKmsClient) {
        throw new Error("Hosted crypto GCP KMS test client was not configured.");
      }
      return cryptoMocks.gcpKmsClient;
    },
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  getHostedDomainRootUnwrapCache: () => new Map(),
}));

vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxStrings: mocks.openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedPhoneLookupKeyReadCandidates: (value: string | null) =>
    value ? [value] : [],
}));

vi.mock("@/src/lib/hosted-onboarding/errors", () => ({
  hostedOnboardingError: (input: {
    code: string;
    httpStatus: number;
    message: string;
    retryable: boolean;
  }) => Object.assign(new Error(input.message), input),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  openHostedMemberRoutingHomeLinqRecipientPhoneRecords:
    mocks.openHostedMemberRoutingHomeLinqRecipientPhoneRecords,
  readHostedMemberRoutingHomeLinqRecipientPhoneRecords:
    mocks.readHostedMemberRoutingHomeLinqRecipientPhoneRecords,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  readHostedLinqGroupLineRecoveryAuthoritiesTx:
    mocks.readHostedLinqGroupLineRecoveryAuthoritiesTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  hasActiveHostedLinqManagedLine: vi.fn(),
  readActiveHostedLinqManagedLineLookupKeys:
    mocks.readActiveHostedLinqManagedLineLookupKeys,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: vi.fn(),
  readHostedRuntimeAiAllowedMemberIds:
    mocks.readHostedRuntimeAiAllowedMemberIds,
}));

vi.mock("@/src/lib/hosted-onboarding/phone", () => ({
  normalizePhoneNumber: (value: string | null | undefined) =>
    typeof value === "string" && value.trim() ? value.trim() : null,
}));

import { HostedDomainRootPermanentUnwrapError } from "@/src/lib/hosted-crypto/domain-root-store";
import {
  claimHostedPendingGroupSetupForParticipantsTx,
  prepareHostedPendingGroupSetupForParticipants,
  type HostedPreparedPendingGroupSetupPackage,
} from "@/src/lib/hosted-groups/pending-group-setup";

const PREPARED_AT = new Date("2026-08-11T12:00:00.000Z");
const OCCURRED_AT = new Date("2026-08-11T11:59:00.000Z");
const INCOMING_LINE = "incoming-line-token";
const THREAD_ID = "provider-thread-token";
const ACTIVE_AUTHORITY_KEY_VERSION =
  "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
const HISTORICAL_AUTHORITY_KEY_VERSION =
  "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/2";
const WEB_WRAP_KEY_NAME =
  "projects/test/locations/global/keyRings/ring/cryptoKeys/wrap";

type CandidateRow = {
  armedAt: Date;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  payloadEncrypted: string;
  recipientPhoneLookupKey: string;
};

type RoutingSnapshot = {
  linqRecipientPhone: string | null;
  linqRecipientPhoneEncrypted: string | null;
  linqRecipientPhoneLookupKey: string | null;
  memberId: string;
};

type FanoutFixture = {
  allowedMemberIds: Set<string>;
  candidateRows: CandidateRow[];
  liveCandidateRows: CandidateRow[];
  lockedRow: CandidateRow | null;
  managedLineLookupKeys: Set<string>;
  participantMemberIds: string[];
  recoveryAuthorities: Map<string, "accepted" | "in_flight" | "none">;
  onWinnerLock?: () => void;
  routingSnapshots: RoutingSnapshot[];
  transactionActive: boolean;
};

let fixture: FanoutFixture;

function serializeTestSecureBoxEnvelope(rootKeyId: string): string {
  return JSON.stringify({
    alg: "AES-256-GCM-HKDF-SHA256",
    ciphertext: "AA==",
    domain: "control",
    iv: "AA==",
    lane: "hosted-member-private-field",
    rootKeyId,
    schema: "murph.hosted-secure-box.v1",
    scope: "hosted-pending-group-setup:payload:v1",
  });
}

async function generateTestSigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const base64 = Buffer.from(spki).toString("base64");
  return {
    privateKey: keyPair.privateKey,
    publicKeyPem: [
      "-----BEGIN PUBLIC KEY-----",
      ...(base64.match(/.{1,64}/gu) ?? []),
      "-----END PUBLIC KEY-----",
    ].join("\n"),
  };
}

async function generateTestEcdhPublicJwk(): Promise<JsonWebKey> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return crypto.subtle.exportKey("jwk", keyPair.publicKey);
}

async function createSignedTestControlEnvelope(input: {
  privateKey: CryptoKey;
  rootKeyId: string;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "control",
    env: "test",
    recipient: "web-control-kms",
    rootKeyId: input.rootKeyId,
    userId: input.userId,
  });
  const now = "2026-08-11T11:30:00.000Z";
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: "control" as const,
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: input.userId,
    wraps: [{
      additionalAuthenticatedData:
        serializeAdditionalAuthenticatedData(encryptionContext),
      ciphertextBlob: "test-ciphertext",
      encryptionContext,
      kind: "gcp-kms" as const,
      kmsKeyName: WEB_WRAP_KEY_NAME,
      recipient: "web-control-kms" as const,
    }],
  };
  const signingPayload = new Uint8Array(
    buildHostedDomainRootEnvelopeSigningPayload(body),
  );
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.privateKey,
    signingPayload,
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: HISTORICAL_AUTHORITY_KEY_VERSION,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
}

function stubHostedCryptoEnv(input: {
  activePublicKeyPem: string;
  cloudflarePublicJwk: JsonWebKey;
  historicalPublicKeyPem?: string;
}): void {
  vi.stubEnv(
    "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
    ACTIVE_AUTHORITY_KEY_VERSION,
  );
  vi.stubEnv(
    "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    input.activePublicKeyPem.replace(/\n/gu, "\\n"),
  );
  vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", WEB_WRAP_KEY_NAME);
  vi.stubEnv("HOSTED_CRYPTO_ENV", "test");
  vi.stubEnv(
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
    "cloudflare-automation:test",
  );
  vi.stubEnv(
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
    JSON.stringify(input.cloudflarePublicJwk),
  );
  vi.stubEnv(
    "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON",
    input.historicalPublicKeyPem
      ? JSON.stringify({
          [HISTORICAL_AUTHORITY_KEY_VERSION]: {
            publicKeyPem: input.historicalPublicKeyPem,
            status: "verify_only",
          },
        })
      : "",
  );
}

function installTestDomainRootEnvelope(input: {
  envelope: () => HostedDomainRootKeyEnvelopeV1;
  prisma: never;
}): void {
  Object.defineProperty(input.prisma, "hostedUserCryptoEnvelope", {
    configurable: true,
    value: {
      findMany: vi.fn(async () => {
        const envelope = input.envelope();
        return [{
          domain: envelope.domain,
          id: `row-${envelope.rootKeyId}`,
          rootKeyId: envelope.rootKeyId,
          signedEnvelopeJson: envelope,
          status: "active",
          updatedAt: new Date(envelope.updatedAt),
          userId: envelope.userId,
        }];
      }),
    },
  });
}

function installTestGcpKmsDecrypt(rootKey: Uint8Array) {
  const decrypt = vi.fn(async () => ({
    plaintext: Uint8Array.from(rootKey),
  }));
  cryptoMocks.gcpKmsClient = {
    asymmetricSign: vi.fn(async () => {
      throw new Error("Unexpected test KMS asymmetricSign.");
    }),
    decrypt,
    encrypt: vi.fn(async () => {
      throw new Error("Unexpected test KMS encrypt.");
    }),
    macSign: vi.fn(async () => {
      throw new Error("Unexpected test KMS macSign.");
    }),
  };
  return decrypt;
}

function installActualDomainRootUnwrap(): void {
  const unwrap =
    cryptoMocks.actualUnwrapHostedDomainRootsForWebByRootKeyIds;
  if (!unwrap) {
    throw new Error("Expected the actual hosted domain-root unwrap implementation.");
  }
  mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mockImplementation(
    (input) => unwrap(input),
  );
}

function buildFixture(input: {
  count: number;
  selectedIndex?: number | null;
  selectedViaRecovery?: boolean;
}): FanoutFixture {
  const candidateRows = Array.from({ length: input.count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    const recipientPhoneLookupKey = input.selectedIndex === index
      && input.selectedViaRecovery !== true
      ? INCOMING_LINE
      : `home-line-${suffix}`;
    return {
      armedAt: new Date("2026-08-11T11:30:00.000Z"),
      expiresAt: new Date("2026-08-11T12:30:00.000Z"),
      id: `setup-${suffix}`,
      ownerMemberId: `member-${suffix}`,
      payloadEncrypted: serializeTestSecureBoxEnvelope(`setup-root-${suffix}`),
      recipientPhoneLookupKey,
    };
  });
  const routingSnapshots = candidateRows.map((row, index) => ({
    linqRecipientPhone: row.recipientPhoneLookupKey,
    linqRecipientPhoneEncrypted:
      `sealed:control:routing-root-${index + 1}:ciphertext`,
    linqRecipientPhoneLookupKey: row.recipientPhoneLookupKey,
    memberId: row.ownerMemberId,
  }));
  const recoveryAuthorities = new Map<
    string,
    "accepted" | "in_flight" | "none"
  >();
  for (const row of candidateRows) {
    recoveryAuthorities.set(row.id, "none");
  }
  if (
    input.selectedViaRecovery === true
    && input.selectedIndex !== null
    && input.selectedIndex !== undefined
  ) {
    recoveryAuthorities.set(candidateRows[input.selectedIndex]!.id, "accepted");
  }
  return {
    allowedMemberIds: new Set(candidateRows.map((row) => row.ownerMemberId)),
    candidateRows,
    liveCandidateRows: candidateRows.map((row) => ({ ...row })),
    lockedRow: input.selectedIndex === null || input.selectedIndex === undefined
      ? null
      : { ...candidateRows[input.selectedIndex]! },
    managedLineLookupKeys: new Set([
      INCOMING_LINE,
      ...candidateRows.map((row) => row.recipientPhoneLookupKey),
    ]),
    participantMemberIds: candidateRows.map((row) => row.ownerMemberId),
    recoveryAuthorities,
    routingSnapshots,
    transactionActive: false,
  };
}

function routingRecords(): Array<Omit<RoutingSnapshot, "linqRecipientPhone">> {
  return fixture.routingSnapshots.map((snapshot) => ({
    linqRecipientPhoneEncrypted: snapshot.linqRecipientPhoneEncrypted,
    linqRecipientPhoneLookupKey: snapshot.linqRecipientPhoneLookupKey,
    memberId: snapshot.memberId,
  }));
}

function queryText(query: unknown): string {
  if (
    query
    && typeof query === "object"
    && "strings" in query
    && Array.isArray((query as { strings: unknown }).strings)
  ) {
    return (query as { strings: string[] }).strings.join("");
  }
  return String(query);
}

function createPrismaFixture() {
  const executeRaw = vi.fn(async () => {
    fixture.lockedRow = null;
    return 1;
  });
  const queryRaw = vi.fn(async (query: unknown) => {
    if (queryText(query).includes("FOR UPDATE")) {
      const lockedRow = fixture.lockedRow ? { ...fixture.lockedRow } : null;
      fixture.onWinnerLock?.();
      return lockedRow ? [lockedRow] : [];
    }
    return (fixture.transactionActive
      ? fixture.liveCandidateRows
      : fixture.candidateRows
    ).map((row) => ({ ...row }));
  });
  return {
    executeRaw,
    prisma: { $executeRaw: executeRaw, $queryRaw: queryRaw } as never,
    queryRaw,
  };
}

function installOwnerMocks(): void {
  mocks.readHostedRuntimeAiAllowedMemberIds.mockImplementation(async () =>
    new Set(fixture.allowedMemberIds)
  );
  mocks.readActiveHostedLinqManagedLineLookupKeys.mockImplementation(async () =>
    new Set(fixture.managedLineLookupKeys)
  );
  mocks.openHostedMemberRoutingHomeLinqRecipientPhoneRecords
    .mockImplementation(async (input: {
      records: Array<{ memberId: string }>;
    }) => input.records.map((record) => ({
      ...fixture.routingSnapshots.find((routing) =>
        routing.memberId === record.memberId
      )!,
    })));
  mocks.readHostedMemberRoutingHomeLinqRecipientPhoneRecords
    .mockImplementation(async () => routingRecords());
  mocks.readHostedLinqGroupLineRecoveryAuthoritiesTx
    .mockImplementation(async () => new Map(fixture.recoveryAuthorities));
  mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mockImplementation(
    async (input: { references: Array<{ rootKeyId: string }> }) => {
      if (fixture.transactionActive) {
        throw new Error("KMS started while the transaction was active.");
      }
      return input.references.map((reference) => ({
        ...reference,
        envelope: {},
        rootKey: new Uint8Array([1, 2, 3, 4]),
      }));
    },
  );
  mocks.openHostedUserSecureBoxStrings.mockImplementation(async (input: {
    entries: Array<{ rowId?: string }>;
  }) => {
    if (!fixture.transactionActive) {
      throw new Error("Secure-box open started before the transaction was active.");
    }
    return input.entries.map(() => JSON.stringify({
      schemaVersion: 1,
      setup: {},
    }));
  });
}

async function prepare(input: {
  prisma: never;
  senderMemberId?: string | null;
}): Promise<HostedPreparedPendingGroupSetupPackage> {
  return prepareHostedPendingGroupSetupForParticipants({
    incomingRecipientPhoneLookupKeys: [INCOMING_LINE],
    now: PREPARED_AT,
    occurredAt: OCCURRED_AT,
    participantMemberIds: fixture.participantMemberIds,
    prisma: input.prisma,
    recoveredRecipientPhoneLookupKey: INCOMING_LINE,
    senderMemberId: input.senderMemberId ?? null,
    threadId: THREAD_ID,
  });
}

async function claim(input: {
  prepared: HostedPreparedPendingGroupSetupPackage;
  prisma: never;
  requiredCandidateId?: string;
  senderMemberId?: string | null;
}) {
  fixture.transactionActive = true;
  try {
    return await claimHostedPendingGroupSetupForParticipantsTx({
      incomingRecipientPhoneLookupKeys: [INCOMING_LINE],
      now: PREPARED_AT,
      occurredAt: OCCURRED_AT,
      participantMemberIds: input.prepared.participantMemberIds,
      prepared: input.prepared,
      recipientPhoneLookupKeys: [
        INCOMING_LINE,
        ...(input.requiredCandidateId
          ? fixture.candidateRows
              .filter((row) => row.id === input.requiredCandidateId)
              .map((row) => row.recipientPhoneLookupKey)
          : []),
      ],
      recoveredRecipientPhoneLookupKey: INCOMING_LINE,
      requiredCandidateId: input.requiredCandidateId,
      senderMemberId: input.senderMemberId ?? null,
      threadId: THREAD_ID,
      tx: input.prisma,
    });
  } finally {
    fixture.transactionActive = false;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = buildFixture({ count: 1, selectedIndex: 0 });
  installOwnerMocks();
});

afterEach(() => {
  cryptoMocks.gcpKmsClient = null;
  vi.unstubAllEnvs();
});

describe("pending-group preparation fanout", () => {
  it("keeps the exact K=32 no-sender/no-recovery prepare-and-claim statement shape constant in roster size", async () => {
    const statementShapeFor = async (count: number) => {
      fixture = buildFixture({ count, selectedIndex: null });
      installOwnerMocks();
      const { prisma, queryRaw } = createPrismaFixture();
      const prepared = await prepare({ prisma });
      const result = await claim({ prepared, prisma });
      return {
        candidateQueries: queryRaw.mock.calls.length,
        lineReads: mocks.readActiveHostedLinqManagedLineLookupKeys.mock.calls.length,
        recoveryReads:
          mocks.readHostedLinqGroupLineRecoveryAuthoritiesTx.mock.calls.length,
        result,
        routingCiphertextReads:
          mocks.readHostedMemberRoutingHomeLinqRecipientPhoneRecords.mock.calls.length,
        routingPlaintextReads:
          mocks.openHostedMemberRoutingHomeLinqRecipientPhoneRecords.mock.calls.length,
        runtimeAccessReads:
          mocks.readHostedRuntimeAiAllowedMemberIds.mock.calls.length,
        selected: prepared.selected,
      };
    };

    const one = await statementShapeFor(1);
    vi.clearAllMocks();
    const thirtyTwo = await statementShapeFor(32);

    expect(thirtyTwo).toEqual(one);
    expect(thirtyTwo).toEqual({
      candidateQueries: 2,
      lineReads: 2,
      recoveryReads: 2,
      result: { kind: "none", reason: "no_candidates" },
      routingCiphertextReads: 2,
      routingPlaintextReads: 1,
      runtimeAccessReads: 2,
      selected: null,
    });
    expect(
      mocks.openHostedMemberRoutingHomeLinqRecipientPhoneRecords
        .mock.calls[0]?.[0]?.records,
    ).toHaveLength(32);
    expect(
      mocks.readHostedLinqGroupLineRecoveryAuthoritiesTx
        .mock.calls[0]?.[0]?.candidates,
    ).toHaveLength(32);
    expect(mocks.unwrapHostedDomainRootsForWebByRootKeyIds).not.toHaveBeenCalled();
    expect(mocks.openHostedUserSecureBoxStrings).not.toHaveBeenCalled();
  });

  it("keeps the K=32 selected-race shape constant, with KMS before BEGIN and local AES after the winner lock", async () => {
    const statementShapeFor = async (count: number) => {
      fixture = buildFixture({ count, selectedIndex: count - 1 });
      installOwnerMocks();
      const { prisma, queryRaw } = createPrismaFixture();
      const selected = fixture.candidateRows[count - 1]!;
      const prepared = await prepare({
        prisma,
        senderMemberId: selected.ownerMemberId,
      });
      const kmsCallsBeforeClaim =
        mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mock.calls.length;
      const result = await claim({
        prepared,
        prisma,
        requiredCandidateId: selected.id,
        senderMemberId: selected.ownerMemberId,
      });
      expect(
        mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mock.calls.length,
      ).toBe(kmsCallsBeforeClaim);
      return {
        candidateQueries: queryRaw.mock.calls.length,
        lineReads: mocks.readActiveHostedLinqManagedLineLookupKeys.mock.calls.length,
        recoveryReads:
          mocks.readHostedLinqGroupLineRecoveryAuthoritiesTx.mock.calls.length,
        resultKind: result.kind,
        routingCiphertextReads:
          mocks.readHostedMemberRoutingHomeLinqRecipientPhoneRecords.mock.calls.length,
        routingPlaintextReads:
          mocks.openHostedMemberRoutingHomeLinqRecipientPhoneRecords.mock.calls.length,
        runtimeAccessReads:
          mocks.readHostedRuntimeAiAllowedMemberIds.mock.calls.length,
        selected,
        selection: prepared.selected,
      };
    };

    const one = await statementShapeFor(1);
    vi.clearAllMocks();
    const thirtyTwo = await statementShapeFor(32);
    expect({ ...thirtyTwo, selected: null, selection: null }).toEqual({
      ...one,
      selected: null,
      selection: null,
    });
    expect(thirtyTwo).toMatchObject({
      candidateQueries: 4,
      lineReads: 3,
      recoveryReads: 3,
      resultKind: "claimed",
      routingCiphertextReads: 3,
      routingPlaintextReads: 1,
      runtimeAccessReads: 3,
      selection: {
        admissionKind: "incoming_line",
        candidateId: thirtyTwo.selected.id,
        reason: "only_candidate",
      },
    });
    expect(mocks.unwrapHostedDomainRootsForWebByRootKeyIds).toHaveBeenCalledOnce();
    expect(
      mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mock.calls[0]?.[0]
        ?.references,
    ).toEqual([{
      domain: "control",
      rootKeyId: "setup-root-32",
      userId: thirtyTwo.selected.ownerMemberId,
    }]);
    expect(mocks.openHostedUserSecureBoxStrings).toHaveBeenCalledOnce();
  });

  it("opens private routing phones only for the eligible subset of a mixed K=32 roster", async () => {
    fixture = buildFixture({ count: 32, selectedIndex: 0 });
    const selected = fixture.candidateRows[0]!;
    const accessDenied = fixture.candidateRows[31]!;
    const unmanaged = fixture.candidateRows[30]!;
    const staleRouting = fixture.candidateRows[29]!;
    fixture.allowedMemberIds.delete(accessDenied.ownerMemberId);
    fixture.managedLineLookupKeys.delete(unmanaged.recipientPhoneLookupKey);
    fixture.routingSnapshots[29] = {
      ...fixture.routingSnapshots[29]!,
      linqRecipientPhoneLookupKey: "stale-routing-line",
    };
    installOwnerMocks();
    mocks.openHostedMemberRoutingHomeLinqRecipientPhoneRecords
      .mockImplementationOnce(async (input: {
        records: Array<{ memberId: string }>;
      }) => {
        if (input.records.some((record) =>
          record.memberId === accessDenied.ownerMemberId
        )) {
          throw new Error("ineligible corrupt routing ciphertext was opened");
        }
        return input.records.map((record) => ({
          ...fixture.routingSnapshots.find((routing) =>
            routing.memberId === record.memberId
          )!,
        }));
      });
    const { prisma } = createPrismaFixture();

    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });

    expect(prepared.selected).toMatchObject({ candidateId: selected.id });
    expect(
      mocks.readHostedMemberRoutingHomeLinqRecipientPhoneRecords,
    ).toHaveBeenCalledOnce();
    const openedRecords = mocks
      .openHostedMemberRoutingHomeLinqRecipientPhoneRecords
      .mock.calls[0]?.[0]?.records as Array<{ memberId: string }>;
    expect(openedRecords).toHaveLength(29);
    expect(openedRecords.map((record) => record.memberId)).not.toEqual(
      expect.arrayContaining([
        accessDenied.ownerMemberId,
        unmanaged.ownerMemberId,
        staleRouting.ownerMemberId,
      ]),
    );
  });

  it("consumes a permanently unreadable selected root only after exact lock", async () => {
    fixture = buildFixture({ count: 1, selectedIndex: 0 });
    installOwnerMocks();
    const permanent = new HostedDomainRootPermanentUnwrapError(
      "missing root metadata",
    );
    mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mockRejectedValueOnce(
      permanent,
    );
    const { executeRaw, prisma, queryRaw } = createPrismaFixture();
    const selected = fixture.candidateRows[0]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
      senderMemberId: selected.ownerMemberId,
    })).resolves.toEqual({ kind: "none", reason: "invalid_payload" });
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(true);
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(mocks.openHostedUserSecureBoxStrings).not.toHaveBeenCalled();
  });

  it("rethrows transient KMS failure without locking or consuming the setup", async () => {
    fixture = buildFixture({ count: 1, selectedIndex: 0 });
    installOwnerMocks();
    const transient = new Error("temporary KMS outage");
    mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mockRejectedValueOnce(
      transient,
    );
    const { executeRaw, prisma, queryRaw } = createPrismaFixture();
    const selected = fixture.candidateRows[0]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
      senderMemberId: selected.ownerMemberId,
    })).rejects.toBe(transient);
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(false);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("keeps a replacement setup retryable until its historical verify key is restored", async () => {
    fixture = buildFixture({
      count: 1,
      selectedIndex: 0,
      selectedViaRecovery: true,
    });
    installOwnerMocks();
    installActualDomainRootUnwrap();
    const activeSigner = await generateTestSigningKeyPair();
    const historicalSigner = await generateTestSigningKeyPair();
    const cloudflarePublicJwk = await generateTestEcdhPublicJwk();
    const selected = fixture.candidateRows[0]!;
    const envelope = await createSignedTestControlEnvelope({
      privateKey: historicalSigner.privateKey,
      rootKeyId: "setup-root-01",
      userId: selected.ownerMemberId,
    });
    const decrypt = installTestGcpKmsDecrypt(new Uint8Array(32).fill(7));
    const { executeRaw, prisma, queryRaw } = createPrismaFixture();
    installTestDomainRootEnvelope({ envelope: () => envelope, prisma });
    stubHostedCryptoEnv({
      activePublicKeyPem: activeSigner.publicKeyPem,
      cloudflarePublicJwk,
    });

    const unavailableKeyPrepared = await prepare({ prisma });
    const unavailableKeyError = await claim({
      prepared: unavailableKeyPrepared,
      prisma,
      requiredCandidateId: selected.id,
    }).then(() => null, (error: unknown) => error);
    expect(unavailableKeyError).toBeInstanceOf(Error);
    expect((unavailableKeyError as Error).message).toMatch(
      /not trusted for verification/u,
    );
    expect(unavailableKeyError).not.toBeInstanceOf(
      HostedDomainRootPermanentUnwrapError,
    );
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(false);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();

    stubHostedCryptoEnv({
      activePublicKeyPem: activeSigner.publicKeyPem,
      cloudflarePublicJwk,
      historicalPublicKeyPem: historicalSigner.publicKeyPem,
    });
    const restoredKeyPrepared = await prepare({ prisma });
    await expect(claim({
      prepared: restoredKeyPrepared,
      prisma,
      requiredCandidateId: selected.id,
    })).resolves.toMatchObject({
      kind: "claimed",
      setup: { ownerMemberId: selected.ownerMemberId },
    });
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(true);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(decrypt).toHaveBeenCalledOnce();
  });

  it("consumes a malformed historical signature only after exact replacement lock", async () => {
    fixture = buildFixture({
      count: 1,
      selectedIndex: 0,
      selectedViaRecovery: true,
    });
    installOwnerMocks();
    installActualDomainRootUnwrap();
    const activeSigner = await generateTestSigningKeyPair();
    const historicalSigner = await generateTestSigningKeyPair();
    const cloudflarePublicJwk = await generateTestEcdhPublicJwk();
    const selected = fixture.candidateRows[0]!;
    const signedEnvelope = await createSignedTestControlEnvelope({
      privateKey: historicalSigner.privateKey,
      rootKeyId: "setup-root-01",
      userId: selected.ownerMemberId,
    });
    const malformedEnvelope: HostedDomainRootKeyEnvelopeV1 = {
      ...signedEnvelope,
      authoritySignature: {
        ...signedEnvelope.authoritySignature,
        signature: "AA==",
      },
    };
    const decrypt = installTestGcpKmsDecrypt(new Uint8Array(32).fill(9));
    const { executeRaw, prisma, queryRaw } = createPrismaFixture();
    installTestDomainRootEnvelope({
      envelope: () => malformedEnvelope,
      prisma,
    });
    stubHostedCryptoEnv({
      activePublicKeyPem: activeSigner.publicKeyPem,
      cloudflarePublicJwk,
      historicalPublicKeyPem: historicalSigner.publicKeyPem,
    });

    const prepared = await prepare({ prisma });
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(false);
    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
    })).resolves.toEqual({ kind: "none", reason: "invalid_payload" });
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(true);
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(decrypt).not.toHaveBeenCalled();
    expect(mocks.openHostedUserSecureBoxStrings).not.toHaveBeenCalled();
  });

  it("returns route-free when fresh preparation selects a different recovery owner than the immutable pin", async () => {
    fixture = buildFixture({
      count: 2,
      selectedIndex: 1,
      selectedViaRecovery: true,
    });
    installOwnerMocks();
    const { executeRaw, prisma, queryRaw } = createPrismaFixture();
    const pinned = fixture.candidateRows[0]!;
    const replacement = fixture.candidateRows[1]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: replacement.ownerMemberId,
    });

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: pinned.id,
      senderMemberId: replacement.ownerMemberId,
    })).resolves.toEqual({ kind: "none", reason: "claim_raced" });
    expect(queryRaw.mock.calls.some(([query]) =>
      queryText(query).includes("FOR UPDATE")
    )).toBe(false);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(mocks.openHostedUserSecureBoxStrings).not.toHaveBeenCalled();
  });

  it("does not open BEGIN while an uncached selected payload root is blocked", async () => {
    fixture = buildFixture({ count: 32, selectedIndex: 31 });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const rootGate: {
      release?: (value: Array<{
        domain: string;
        envelope: object;
        rootKey: Uint8Array;
        rootKeyId: string;
        userId: string;
      }>) => void;
    } = {};
    mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mockImplementationOnce(
      () => new Promise((resolve) => {
        rootGate.release = resolve;
      }),
    );
    let transactionBegan = false;
    const run = (async () => {
      const prepared = await prepare({
        prisma,
        senderMemberId: fixture.candidateRows[31]!.ownerMemberId,
      });
      transactionBegan = true;
      return claim({
        prepared,
        prisma,
        requiredCandidateId: fixture.candidateRows[31]!.id,
        senderMemberId: fixture.candidateRows[31]!.ownerMemberId,
      });
    })();

    await vi.waitFor(() => {
      expect(mocks.unwrapHostedDomainRootsForWebByRootKeyIds)
        .toHaveBeenCalledOnce();
    });
    expect(transactionBegan).toBe(false);
    expect(mocks.openHostedUserSecureBoxStrings).not.toHaveBeenCalled();
    if (!rootGate.release) {
      throw new Error("Expected the pending setup root gate to be waiting.");
    }
    rootGate.release([{
      domain: "control",
      envelope: {},
      rootKey: new Uint8Array([1, 2, 3, 4]),
      rootKeyId: "setup-root-32",
      userId: fixture.candidateRows[31]!.ownerMemberId,
    }]);

    await expect(run).resolves.toMatchObject({ kind: "claimed" });
    expect(transactionBegan).toBe(true);
  });
});

describe("pending-group live mutation fences", () => {
  async function expectFreshPreparationAfterMutation(
    mutate: () => void,
  ): Promise<void> {
    fixture = buildFixture({
      count: 2,
      selectedIndex: 0,
      selectedViaRecovery: true,
    });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const selected = fixture.candidateRows[0]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });
    mutate();
    const cryptoCallsBeforeClaim =
      mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mock.calls.length
      + mocks.openHostedUserSecureBoxStrings.mock.calls.length;

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
      senderMemberId: selected.ownerMemberId,
    })).rejects.toMatchObject({
      code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
      retryable: true,
    });
    expect(
      mocks.unwrapHostedDomainRootsForWebByRootKeyIds.mock.calls.length
      + mocks.openHostedUserSecureBoxStrings.mock.calls.length,
    ).toBe(cryptoCallsBeforeClaim);
  }

  it.each([
    ["expiry", () => {
      fixture.liveCandidateRows = fixture.liveCandidateRows.slice(1);
    }],
    ["access or consent", () => {
      fixture.allowedMemberIds.delete(fixture.candidateRows[0]!.ownerMemberId);
    }],
    ["original managed line", () => {
      fixture.managedLineLookupKeys.delete(
        fixture.candidateRows[0]!.recipientPhoneLookupKey,
      );
    }],
    ["routing binding", () => {
      fixture.routingSnapshots[0] = {
        ...fixture.routingSnapshots[0]!,
        linqRecipientPhoneLookupKey: "changed-routing-binding",
      };
    }],
    ["routing ciphertext or root", () => {
      fixture.routingSnapshots[0] = {
        ...fixture.routingSnapshots[0]!,
        linqRecipientPhoneEncrypted:
          "sealed:control:changed-routing-root:ciphertext",
      };
    }],
    ["setup ciphertext or root", () => {
      fixture.liveCandidateRows[0] = {
        ...fixture.liveCandidateRows[0]!,
        payloadEncrypted: serializeTestSecureBoxEnvelope("changed-setup-root"),
      };
    }],
  ] as const)("rejects stale %s authority", async (_label, mutate) => {
    await expectFreshPreparationAfterMutation(mutate);
  });

  it("requires fresh preparation when a provider-proven participant arms a competing setup", async () => {
    fixture = buildFixture({ count: 1, selectedIndex: 0 });
    const competitorOwnerMemberId = "member-new-competitor";
    fixture.participantMemberIds.push(competitorOwnerMemberId);
    fixture.allowedMemberIds.add(competitorOwnerMemberId);
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const selected = fixture.candidateRows[0]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });
    const competitor: CandidateRow = {
      ...selected,
      id: "setup-new-competitor",
      ownerMemberId: competitorOwnerMemberId,
      payloadEncrypted: serializeTestSecureBoxEnvelope("competitor-root"),
      recipientPhoneLookupKey: INCOMING_LINE,
    };
    fixture.liveCandidateRows = [...fixture.liveCandidateRows, competitor];
    fixture.routingSnapshots = [
      ...fixture.routingSnapshots,
      {
        linqRecipientPhone: INCOMING_LINE,
        linqRecipientPhoneEncrypted:
          "sealed:control:competitor-routing-root:ciphertext",
        linqRecipientPhoneLookupKey: INCOMING_LINE,
        memberId: competitorOwnerMemberId,
      },
    ];

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
      senderMemberId: selected.ownerMemberId,
    })).rejects.toMatchObject({
      code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
    });
  });

  it("requires fresh preparation when a competitor becomes visible after the exact winner lock", async () => {
    fixture = buildFixture({ count: 1, selectedIndex: 0 });
    const competitorOwnerMemberId = "member-post-lock-competitor";
    fixture.participantMemberIds.push(competitorOwnerMemberId);
    fixture.allowedMemberIds.add(competitorOwnerMemberId);
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const selected = fixture.candidateRows[0]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });
    fixture.onWinnerLock = () => {
      const competitor: CandidateRow = {
        ...selected,
        id: "setup-post-lock-competitor",
        ownerMemberId: competitorOwnerMemberId,
        payloadEncrypted: serializeTestSecureBoxEnvelope(
          "post-lock-competitor-root",
        ),
        recipientPhoneLookupKey: INCOMING_LINE,
      };
      fixture.liveCandidateRows = [...fixture.liveCandidateRows, competitor];
      fixture.routingSnapshots = [
        ...fixture.routingSnapshots,
        {
          linqRecipientPhone: INCOMING_LINE,
          linqRecipientPhoneEncrypted:
            "sealed:control:post-lock-routing-root:ciphertext",
          linqRecipientPhoneLookupKey: INCOMING_LINE,
          memberId: competitorOwnerMemberId,
        },
      ];
    };

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
      senderMemberId: selected.ownerMemberId,
    })).rejects.toMatchObject({
      code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
      retryable: true,
    });
  });

  it("requires fresh preparation when sender precedence changes", async () => {
    fixture = buildFixture({ count: 2, selectedIndex: 0 });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const prepared = await prepare({
      prisma,
      senderMemberId: fixture.candidateRows[0]!.ownerMemberId,
    });

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: fixture.candidateRows[0]!.id,
      senderMemberId: fixture.candidateRows[1]!.ownerMemberId,
    })).rejects.toMatchObject({
      code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
    });
  });

  it("fails closed when the incoming managed line changes", async () => {
    fixture = buildFixture({ count: 1, selectedIndex: 0 });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const prepared = await prepare({
      prisma,
      senderMemberId: fixture.candidateRows[0]!.ownerMemberId,
    });
    fixture.managedLineLookupKeys.delete(INCOMING_LINE);

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: fixture.candidateRows[0]!.id,
      senderMemberId: fixture.candidateRows[0]!.ownerMemberId,
    })).resolves.toEqual({
      kind: "none",
      reason: "recipient_line_unmanaged",
    });
  });

  it("requires fresh preparation when accepted replacement recovery authority changes", async () => {
    fixture = buildFixture({
      count: 1,
      selectedIndex: 0,
      selectedViaRecovery: true,
    });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const prepared = await prepare({ prisma });
    fixture.recoveryAuthorities.set(fixture.candidateRows[0]!.id, "none");

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: fixture.candidateRows[0]!.id,
    })).rejects.toMatchObject({
      code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
      retryable: true,
    });
  });

  it("retains the exact typed retry when replacement recovery becomes in flight", async () => {
    fixture = buildFixture({
      count: 1,
      selectedIndex: 0,
      selectedViaRecovery: true,
    });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const prepared = await prepare({ prisma });
    fixture.recoveryAuthorities.set(fixture.candidateRows[0]!.id, "in_flight");

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: fixture.candidateRows[0]!.id,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
      retryable: true,
    });
  });

  it("does not use a stale payload when the locked setup changes after live selection", async () => {
    fixture = buildFixture({ count: 1, selectedIndex: 0 });
    installOwnerMocks();
    const { prisma } = createPrismaFixture();
    const selected = fixture.candidateRows[0]!;
    const prepared = await prepare({
      prisma,
      senderMemberId: selected.ownerMemberId,
    });
    fixture.lockedRow = {
      ...selected,
      payloadEncrypted: serializeTestSecureBoxEnvelope("post-selection-root"),
    };

    await expect(claim({
      prepared,
      prisma,
      requiredCandidateId: selected.id,
      senderMemberId: selected.ownerMemberId,
    })).rejects.toMatchObject({
      code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
    });
  });
});
