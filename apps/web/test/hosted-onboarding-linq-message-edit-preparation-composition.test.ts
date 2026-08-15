import { Buffer } from "node:buffer";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
  readHostedConversationAssistantIdentifierSecret,
} from "@murphai/hosted-execution/assistant-identifiers";
import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  type HostedMailboxPayloadCryptoMetadata,
} from "@murphai/hosted-execution/runtime-control";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  buildHostedSecureBoxAad,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  parseSerializedHostedSecureBoxEnvelope,
  sealHostedSecureBox,
  serializeAdditionalAuthenticatedData,
  serializeHostedSecureBoxEnvelope,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GcpKmsDecryptInput,
  HostedGcpKmsClient,
} from "@/src/lib/hosted-crypto/gcp-kms";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";

const AUTHORITY_KEY_VERSION =
  "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1";
const WEB_WRAP_KEY_NAME =
  "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap";
const TEST_CHAT_ID = "chat_edit_composition_123";
const TEST_MESSAGE_ID = "message_edit_composition_123";
const TEST_RECIPIENT_PHONE = "+15550000000";
const TEST_SENDER_PHONE = "+15551112222";
const TEST_USER_ID = "member_edit_composition_123";
const TEST_NOW = new Date("2026-08-11T10:10:00.000Z");

const gcpKmsMock = vi.hoisted(() => ({
  client: null as HostedGcpKmsClient | null,
}));

vi.mock("@/src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv: () => {
      if (!gcpKmsMock.client) {
        throw new Error("Hosted message-edit composition KMS client was not configured.");
      }
      return gcpKmsMock.client;
    },
  };
});

import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  runHostedLinqMessageEditPreparedTransaction,
} from "@/src/lib/hosted-onboarding/webhook-service";
import type {
  HostedMailboxSourceConversationPreparationRow,
} from "@/src/lib/hosted-mailbox/store";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
  vi.resetAllMocks();
  setHostedSecureBoxStringTestCodecForTests(null);
  configureHostedContactPrivacyKeyringForTest();
});

afterEach(() => {
  gcpKmsMock.client = null;
  setHostedSecureBoxStringTestCodecForTests(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  clearHostedOnboardingEnvCache();
});

describe("Linq message-edit preparation composition", () => {
  it("bounds six historical roots plus a distinct active root before one limit transaction", async () => {
    const harness = await createCompositionHarness({ sourceRowCount: 6 });

    const operation = runHostedLinqMessageEditPreparedTransaction({
      event: buildLinqMessageEditedEvent(),
      prisma: harness.prisma,
    });
    await expectPendingKmsWave({
      active: 4,
      operation,
      state: harness.state,
      totalCalls: 4,
    });
    releasePendingKmsCalls(harness.state);
    await expectPendingKmsWave({
      active: 2,
      operation,
      state: harness.state,
      totalCalls: 6,
    });
    releasePendingKmsCalls(harness.state);
    await expectPendingKmsWave({
      active: 1,
      operation,
      state: harness.state,
      totalCalls: 7,
    });
    releasePendingKmsCalls(harness.state);

    await expect(operation).resolves.toMatchObject({
      response: {
        ignored: true,
        reason: "message-edit-limit-reached",
      },
    });
    await Promise.resolve();

    expect(harness.state.insertedCiphertext).toBeNull();
    const historicalRootIds = harness.sourceRoots.map(
      (root) => root.envelope.rootKeyId,
    );
    expect(new Set(historicalRootIds).size).toBe(6);
    expect(historicalRootIds).not.toContain(
      harness.activeRoot.envelope.rootKeyId,
    );
    expect(harness.state.rootBatchInputs).toHaveLength(1);
    expect(readRootBatchReferences(harness.state.rootBatchInputs[0]).map(
      (reference) => reference.rootKeyId,
    )).toEqual(historicalRootIds);
    expect(harness.state.kms.calls.map((call) => call.ciphertext).sort())
      .toEqual([
        ...harness.sourceRoots.map((root) => root.wrapCiphertext),
        harness.activeRoot.wrapCiphertext,
      ].sort());
    expect(harness.state.kms.calls).toHaveLength(7);
    expect(harness.state.kms.maxConcurrent).toBe(4);
    expect(harness.state.kms.transactionStates).toEqual(
      Array.from({ length: 7 }, () => false),
    );
    expect(harness.state.rootMetadataTransactionStates).toEqual([false, false]);
    expect(harness.state.sourceReadTransactionStates).toEqual([false, true]);
    expect(harness.state.sourceReadLookupKeys).toEqual([
      [...harness.sourceMessageLookupKeys].sort(),
      [...harness.sourceMessageLookupKeys].sort(),
    ]);
    expect(harness.state.transactionCount).toBe(1);
    expect(harness.state.peakTransactions).toBe(1);
    expect(harness.state.transactionDepth).toBe(0);
    expect(harness.state.kmsCallsAtTransactionBegin).toEqual([7]);
    expect(harness.state.kmsCallsAtTransactionEnd).toEqual([7]);
    expect(harness.state.rootMetadataCallsAtTransactionBegin).toEqual([2]);
    expect(harness.state.rootMetadataCallsAtTransactionEnd).toEqual([2]);
    expect(harness.state.sourceLocks).toEqual(
      [...harness.sourceMessageLookupKeys].sort(),
    );
    expect(harness.state.datastoreCalls.map((call) => call.label)).toEqual([
      "source-read",
      "root-envelope-batch",
      "active-root-read",
      "source-lock",
      "source-lock",
      "source-read",
    ]);
    expect(harness.state.datastoreCalls).toHaveLength(6);
    expect(harness.state.datastoreCalls.map(
      (call) => call.inTransaction,
    )).toEqual([false, false, false, true, true, true]);
    expect(harness.state.kms.returnedPlaintexts).toHaveLength(7);
    expect(harness.state.kms.returnedPlaintexts.every((plaintext) =>
      plaintext.every((byte) => byte === 0)
    )).toBe(true);
  });

  it("reuses the prepared active root for an accepted append with no metadata or KMS after BEGIN", async () => {
    const harness = await createCompositionHarness({ sourceRowCount: 5 });

    const operation = runHostedLinqMessageEditPreparedTransaction({
      event: buildLinqMessageEditedEvent(),
      prisma: harness.prisma,
    });
    await expectPendingKmsWave({
      active: 4,
      operation,
      state: harness.state,
      totalCalls: 4,
    });
    releasePendingKmsCalls(harness.state);
    await expectPendingKmsWave({
      active: 1,
      operation,
      state: harness.state,
      totalCalls: 5,
    });
    releasePendingKmsCalls(harness.state);
    await expectPendingKmsWave({
      active: 1,
      operation,
      state: harness.state,
      totalCalls: 6,
    });
    releasePendingKmsCalls(harness.state);

    await expect(operation).resolves.toMatchObject({
      response: {
        ignored: false,
        reason: "wake-appended-message-edit",
      },
      wakeHandoffs: [{
        eventId: "event_edit_composition_new",
        userId: TEST_USER_ID,
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "6",
        },
      }],
    });
    await Promise.resolve();

    expect(harness.state.insertedCiphertext).not.toBeNull();
    expect(parseSerializedHostedSecureBoxEnvelope(
      harness.state.insertedCiphertext ?? "",
    )).toMatchObject({
      domain: "ingress",
      lane: "mailbox-payload",
      rootKeyId: harness.activeRoot.envelope.rootKeyId,
      schema: "murph.hosted-secure-box.v1",
    });
    const historicalRootIds = harness.sourceRoots.map(
      (root) => root.envelope.rootKeyId,
    );
    expect(new Set(historicalRootIds).size).toBe(5);
    expect(historicalRootIds).not.toContain(
      harness.activeRoot.envelope.rootKeyId,
    );
    expect(harness.state.rootBatchInputs).toHaveLength(1);
    expect(readRootBatchReferences(harness.state.rootBatchInputs[0]).map(
      (reference) => reference.rootKeyId,
    )).toEqual(historicalRootIds);
    expect(harness.state.kms.calls.map((call) => call.ciphertext).sort())
      .toEqual([
        ...harness.sourceRoots.map((root) => root.wrapCiphertext),
        harness.activeRoot.wrapCiphertext,
      ].sort());
    expect(harness.state.kms.calls).toHaveLength(6);
    expect(harness.state.kms.maxConcurrent).toBe(4);
    expect(harness.state.kms.transactionStates).toEqual(
      Array.from({ length: 6 }, () => false),
    );
    expect(harness.state.rootMetadataTransactionStates).toEqual([false, false]);
    expect(harness.state.sourceReadTransactionStates).toEqual([false, true]);
    expect(harness.state.sourceReadLookupKeys).toEqual([
      [...harness.sourceMessageLookupKeys].sort(),
      [...harness.sourceMessageLookupKeys].sort(),
    ]);
    expect(harness.state.transactionCount).toBe(1);
    expect(harness.state.peakTransactions).toBe(1);
    expect(harness.state.transactionDepth).toBe(0);
    expect(harness.state.kmsCallsAtTransactionBegin).toEqual([6]);
    expect(harness.state.kmsCallsAtTransactionEnd).toEqual([6]);
    expect(harness.state.rootMetadataCallsAtTransactionBegin).toEqual([2]);
    expect(harness.state.rootMetadataCallsAtTransactionEnd).toEqual([2]);
    expect(harness.state.sourceLocks).toEqual(
      [...harness.sourceMessageLookupKeys].sort(),
    );
    expect(harness.state.datastoreCalls.map((call) => call.label)).toEqual([
      "source-read",
      "root-envelope-batch",
      "active-root-read",
      "source-lock",
      "source-lock",
      "source-read",
      "member-lock",
      "route-authority",
      "access-authority",
      "chat-ownership-lock",
      "thread-route-read",
      "workspace-upsert",
      "mailbox-dedupe-lock",
      "mailbox-dedupe-read",
      "mailbox-causal-lock",
      "mailbox-causal-seq",
      "mailbox-lane-seq",
      "mailbox-insert",
    ]);
    expect(harness.state.datastoreCalls).toHaveLength(18);
    expect(harness.state.datastoreCalls.map(
      (call) => call.inTransaction,
    )).toEqual([
      false,
      false,
      false,
      ...Array.from({ length: 15 }, () => true),
    ]);
    expect(harness.state.kms.returnedPlaintexts).toHaveLength(6);
    expect(harness.state.kms.returnedPlaintexts.every((plaintext) =>
      plaintext.every((byte) => byte === 0)
    )).toBe(true);
  });
});

type LinqConversationWake = ReturnType<
  typeof buildHostedExecutionLinqConversationMessageWake
>;

type RootFixture = {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKey: Uint8Array;
  row: HostedCryptoEnvelopeRow;
  wrapCiphertext: string;
};

type HostedCryptoEnvelopeRow = {
  domain: "ingress";
  id: string;
  rootKeyId: string;
  signedEnvelopeJson: HostedDomainRootKeyEnvelopeV1;
  status: "active" | "decrypt_only";
  updatedAt: Date;
  userId: string;
};

type CompositionState = {
  datastoreCalls: Array<{ inTransaction: boolean; label: string }>;
  insertedCiphertext: string | null;
  kms: {
    active: number;
    callCountWaiters: Array<{ count: number; resolve: () => void }>;
    calls: GcpKmsDecryptInput[];
    maxConcurrent: number;
    pendingReleases: Array<() => void>;
    returnedPlaintexts: Uint8Array[];
    transactionStates: boolean[];
  };
  kmsCallsAtTransactionBegin: number[];
  kmsCallsAtTransactionEnd: number[];
  peakTransactions: number;
  rootBatchInputs: unknown[];
  rootMetadataCallsAtTransactionBegin: number[];
  rootMetadataCallsAtTransactionEnd: number[];
  rootMetadataTransactionStates: boolean[];
  sourceLocks: string[];
  sourceReadLookupKeys: string[][];
  sourceReadTransactionStates: boolean[];
  transactionCount: number;
  transactionDepth: number;
};

type CompositionHarness = {
  activeRoot: RootFixture;
  prisma: PrismaClient;
  sourceMessageLookupKeys: readonly string[];
  sourceRoots: readonly RootFixture[];
  state: CompositionState;
};

async function createCompositionHarness(input: {
  sourceRowCount: 5 | 6;
}): Promise<CompositionHarness> {
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

  const roots = await Promise.all(
    Array.from({ length: input.sourceRowCount + 1 }, (_, index) =>
      createSignedIngressRoot({
        active: index === input.sourceRowCount,
        index,
        signer: signer.privateKey,
      })
    ),
  );
  const sourceRoots = roots.slice(0, input.sourceRowCount);
  const activeRoot = roots[input.sourceRowCount];
  if (!activeRoot) {
    throw new Error("Expected a distinct active ingress root fixture.");
  }

  const sourceMessageLookupKeys =
    createHostedLinqMessageLookupKeyReadCandidates(TEST_MESSAGE_ID);
  if (sourceMessageLookupKeys.length !== 2) {
    throw new Error("Expected current and prior Linq message lookup keys.");
  }
  const wakes = buildSourceWakes(input.sourceRowCount);
  const sourceRows = await Promise.all(wakes.map((wake, index) => {
    const root = sourceRoots[index];
    if (!root) {
      throw new Error("Expected one historical ingress root per source row.");
    }
    return buildEncryptedSourceRow({
      index,
      root,
      sourceMessageLookupKey: requireHostedLookupKey(
        createHostedLinqMessageLookupKey(TEST_MESSAGE_ID),
        "source message",
      ),
      wake,
    });
  }));
  const state = createCompositionState();
  const rootsByCiphertext = new Map(
    roots.map((root) => [root.wrapCiphertext, root.rootKey] as const),
  );
  gcpKmsMock.client = createLocalKmsClient({ rootsByCiphertext, state });

  return {
    activeRoot,
    prisma: createPrismaStub({
      activeRoot,
      envelopeRows: roots.map((root) => root.row),
      sourceMessageLookupKeys,
      sourceRows,
      state,
    }),
    sourceMessageLookupKeys,
    sourceRoots,
    state,
  };
}

function createCompositionState(): CompositionState {
  return {
    datastoreCalls: [],
    insertedCiphertext: null,
    kms: {
      active: 0,
      callCountWaiters: [],
      calls: [],
      maxConcurrent: 0,
      pendingReleases: [],
      returnedPlaintexts: [],
      transactionStates: [],
    },
    kmsCallsAtTransactionBegin: [],
    kmsCallsAtTransactionEnd: [],
    peakTransactions: 0,
    rootBatchInputs: [],
    rootMetadataCallsAtTransactionBegin: [],
    rootMetadataCallsAtTransactionEnd: [],
    rootMetadataTransactionStates: [],
    sourceLocks: [],
    sourceReadLookupKeys: [],
    sourceReadTransactionStates: [],
    transactionCount: 0,
    transactionDepth: 0,
  };
}

function createLocalKmsClient(input: {
  rootsByCiphertext: ReadonlyMap<string, Uint8Array>;
  state: CompositionState;
}): HostedGcpKmsClient {
  return {
    asymmetricSign: vi.fn(async () => {
      throw new Error("Unexpected KMS sign in message-edit composition test.");
    }),
    decrypt: vi.fn(async (decryptInput) => {
      input.state.kms.calls.push(decryptInput);
      input.state.kms.transactionStates.push(
        input.state.transactionDepth > 0,
      );
      input.state.kms.active += 1;
      input.state.kms.maxConcurrent = Math.max(
        input.state.kms.maxConcurrent,
        input.state.kms.active,
      );
      const release = createDeferredValue<void>();
      input.state.kms.pendingReleases.push(() => release.resolve(undefined));
      notifyKmsCallCountWaiters(input.state);
      try {
        await release.promise;
        const rootKey = input.rootsByCiphertext.get(decryptInput.ciphertext);
        if (!rootKey) {
          throw new Error("Unexpected KMS ciphertext in message-edit composition test.");
        }
        const plaintext = Uint8Array.from(rootKey);
        input.state.kms.returnedPlaintexts.push(plaintext);
        return { plaintext };
      } finally {
        input.state.kms.active -= 1;
      }
    }),
    encrypt: vi.fn(async () => {
      throw new Error("Unexpected KMS encrypt in message-edit composition test.");
    }),
    macSign: vi.fn(async () => {
      throw new Error("Unexpected KMS MAC in message-edit composition test.");
    }),
  };
}

async function expectPendingKmsWave<Result>(input: {
  active: number;
  operation: Promise<Result>;
  state: CompositionState;
  totalCalls: number;
}): Promise<void> {
  await waitForKmsCallCount(input);
  expect(input.state.kms.calls).toHaveLength(input.totalCalls);
  expect(input.state.kms.active).toBe(input.active);
  expect(input.state.kms.pendingReleases).toHaveLength(input.active);
  await Promise.resolve();
  expect(input.state.kms.calls).toHaveLength(input.totalCalls);
}

async function waitForKmsCallCount<Result>(input: {
  operation: Promise<Result>;
  state: CompositionState;
  totalCalls: number;
}): Promise<void> {
  if (input.state.kms.calls.length >= input.totalCalls) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      input.state.kms.callCountWaiters.push({
        count: input.totalCalls,
        resolve,
      });
    }),
    input.operation.then(
      () => {
        throw new Error(
          `Message-edit composition completed before KMS call ${input.totalCalls}.`,
        );
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
}

function notifyKmsCallCountWaiters(state: CompositionState): void {
  const ready = state.kms.callCountWaiters.filter(
    (waiter) => state.kms.calls.length >= waiter.count,
  );
  state.kms.callCountWaiters = state.kms.callCountWaiters.filter(
    (waiter) => state.kms.calls.length < waiter.count,
  );
  for (const waiter of ready) {
    waiter.resolve();
  }
}

function releasePendingKmsCalls(state: CompositionState): void {
  const releases = state.kms.pendingReleases.splice(0);
  for (const release of releases) {
    release();
  }
}

function createDeferredValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPrismaStub(input: {
  activeRoot: RootFixture;
  envelopeRows: readonly HostedCryptoEnvelopeRow[];
  sourceMessageLookupKeys: readonly string[];
  sourceRows: readonly HostedMailboxSourceConversationPreparationRow[];
  state: CompositionState;
}): PrismaClient {
  const now = new Date(TEST_NOW.getTime());
  const recordDatastoreCall = (label: string): void => {
    input.state.datastoreCalls.push({
      inTransaction: input.state.transactionDepth > 0,
      label,
    });
  };

  const queryRaw = vi.fn(async (...args: unknown[]) => {
    const invocation = readRawInvocation(args);
    const lowerSql = invocation.sql.toLowerCase();
    if (lowerSql.includes("from hosted_mailbox_item as item")) {
      recordDatastoreCall("source-read");
      input.state.sourceReadTransactionStates.push(
        input.state.transactionDepth > 0,
      );
      const queriedLookupKeys = invocation.values.flatMap((value) =>
        typeof value === "string"
        && input.sourceMessageLookupKeys.includes(value)
          ? [value]
          : []
      );
      input.state.sourceReadLookupKeys.push(queriedLookupKeys);
      const queriedLookupKeySet = new Set(queriedLookupKeys);
      return input.sourceRows.filter((row) =>
        row.sourceMessageLookupKey !== null
        && queriedLookupKeySet.has(row.sourceMessageLookupKey)
      );
    }
    if (
      lowerSql.includes("from hosted_user_crypto_envelope")
      && lowerSql.includes("signed_envelope_json")
      && lowerSql.includes("status = 'active'")
    ) {
      expect(invocation.values).toEqual([TEST_USER_ID, "ingress"]);
      recordDatastoreCall("active-root-read");
      input.state.rootMetadataTransactionStates.push(
        input.state.transactionDepth > 0,
      );
      return [input.activeRoot.row];
    }
    if (lowerSql.includes('select 1 from "hosted_member"')) {
      expect(invocation.values).toEqual([TEST_USER_ID]);
      recordDatastoreCall("member-lock");
      return [{ value: 1 }];
    }
    if (lowerSql.includes("insert into hosted_mailbox_lane_counter")) {
      const label = invocation.values.length === 1
        ? "mailbox-causal-seq"
        : "mailbox-lane-seq";
      recordDatastoreCall(label);
      return [{ seq: BigInt(input.sourceRows.length + 1) }];
    }
    if (lowerSql.includes("insert into hosted_mailbox_item")) {
      recordDatastoreCall("mailbox-insert");
      input.state.insertedCiphertext = requireNullableString(
        invocation.values[11],
      );
      return [{
        assistantInputLookupKey: requireNullableString(invocation.values[2]),
        causalSeq: invocation.values[4] as bigint,
        consumedAt: null,
        createdAt: now,
        dedupeKey: String(invocation.values[7]),
        expiresAt: invocation.values[15] instanceof Date
          ? invocation.values[15]
          : null,
        id: String(invocation.values[0]),
        kind: String(invocation.values[8]),
        lane: String(invocation.values[5]),
        laneSeq: invocation.values[6] as bigint,
        occurredAt: invocation.values[9] as Date,
        payloadBytes: invocation.values[13] as number,
        payloadHash: requireNullableString(invocation.values[14]),
        payloadInlineCiphertext: input.state.insertedCiphertext,
        payloadRef: requireNullableString(invocation.values[12]),
        payloadSchema: String(invocation.values[10]),
        sourceMessageLookupKey: requireNullableString(invocation.values[3]),
        updatedAt: now,
        userId: String(invocation.values[1]),
      }];
    }
    throw new Error(`Unexpected message-edit composition query: ${invocation.sql}`);
  });

  const executeRaw = vi.fn(async (...args: unknown[]) => {
    const invocation = readRawInvocation(args);
    const lowerSql = invocation.sql.toLowerCase();
    if (lowerSql.includes("mailbox-source-message")) {
      recordDatastoreCall("source-lock");
      input.state.sourceLocks.push(String(invocation.values[0]));
      return 1;
    }
    if (invocation.values.includes("hosted-linq-routing:chat")) {
      recordDatastoreCall("chat-ownership-lock");
      return 1;
    }
    if (lowerSql.includes("mailbox-causal-seq")) {
      recordDatastoreCall("mailbox-causal-lock");
      return 1;
    }
    if (lowerSql.includes("pg_advisory_xact_lock")) {
      recordDatastoreCall("mailbox-dedupe-lock");
      return 1;
    }
    throw new Error(
      `Unexpected message-edit composition execute: ${invocation.sql}`,
    );
  });

  const delegates = {
    hostedMailboxItem: {
      findUnique: vi.fn(async () => {
        recordDatastoreCall("mailbox-dedupe-read");
        return null;
      }),
    },
    hostedMailboxPayload: {
      create: vi.fn(async () => {
        throw new Error("Message-edit payload unexpectedly used sidecar storage.");
      }),
    },
    hostedMember: {
      findUnique: vi.fn(async (findInput: unknown) => {
        expect(findInput).toMatchObject({ where: { id: TEST_USER_ID } });
        recordDatastoreCall("access-authority");
        return {
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          consentGrants: [],
          suspendedAt: null,
          threadContainer: null,
        };
      }),
    },
    hostedMemberRouting: {
      findUnique: vi.fn(async (findInput: unknown) => {
        expect(findInput).toMatchObject({
          where: { memberId: TEST_USER_ID },
        });
        recordDatastoreCall("route-authority");
        return {
          linqChatLookupKey: createHostedLinqChatLookupKey(TEST_CHAT_ID),
          linqParticipantContactKind: "phone",
          linqParticipantContactLookupKey:
            createHostedPhoneLookupKey(TEST_SENDER_PHONE),
        };
      }),
    },
    hostedThreadRoute: {
      findFirst: vi.fn(async (findInput: unknown) => {
        expect(findInput).toMatchObject({
          where: { channel: "linq" },
        });
        recordDatastoreCall("thread-route-read");
        return null;
      }),
    },
    hostedUserCryptoEnvelope: {
      findMany: vi.fn(async (findInput: unknown) => {
        recordDatastoreCall("root-envelope-batch");
        input.state.rootMetadataTransactionStates.push(
          input.state.transactionDepth > 0,
        );
        input.state.rootBatchInputs.push(findInput);
        const requested = new Set(readRootBatchReferences(findInput).map(
          (reference) =>
            `${reference.userId}|${reference.domain}|${reference.rootKeyId}`,
        ));
        return input.envelopeRows.filter((row) =>
          requested.has(`${row.userId}|${row.domain}|${row.rootKeyId}`)
        );
      }),
    },
    hostedWorkspace: {
      upsert: vi.fn(async (upsertInput: unknown) => {
        expect(upsertInput).toMatchObject({
          where: { userId: TEST_USER_ID },
        });
        recordDatastoreCall("workspace-upsert");
        return { userId: TEST_USER_ID };
      }),
    },
  };

  const client = {
    ...delegates,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient;
  const transaction = vi.fn(async <Result>(
    callback: (tx: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> => {
    input.state.transactionCount += 1;
    input.state.kmsCallsAtTransactionBegin.push(input.state.kms.calls.length);
    input.state.rootMetadataCallsAtTransactionBegin.push(
      input.state.rootMetadataTransactionStates.length,
    );
    input.state.transactionDepth += 1;
    input.state.peakTransactions = Math.max(
      input.state.peakTransactions,
      input.state.transactionDepth,
    );
    try {
      return await callback(client);
    } finally {
      input.state.kmsCallsAtTransactionEnd.push(input.state.kms.calls.length);
      input.state.rootMetadataCallsAtTransactionEnd.push(
        input.state.rootMetadataTransactionStates.length,
      );
      input.state.transactionDepth -= 1;
    }
  });

  return Object.assign(client, {
    $transaction: transaction,
  }) as unknown as PrismaClient;
}

function buildSourceWakes(sourceRowCount: number): LinqConversationWake[] {
  const accountLookupKey = requireHostedLookupKey(
    createHostedPhoneLookupKey(TEST_RECIPIENT_PHONE),
    "recipient phone",
  );
  const contactLookupKey = requireHostedLookupKey(
    createHostedPhoneLookupKey(TEST_SENDER_PHONE),
    "sender phone",
  );
  const original = buildHostedExecutionLinqConversationMessageWake({
    accountLookupKey,
    contactKind: "phone",
    contactLookupKey,
    eventId: "event_edit_composition_original",
    linqMessage: {
      chatId: TEST_CHAT_ID,
      from: TEST_SENDER_PHONE,
      isFromMe: false,
      messageId: TEST_MESSAGE_ID,
      parts: [{ type: "text", value: "Original wording" }],
      service: "iMessage",
      threadIsDirect: true,
    },
    occurredAt: "2026-08-11T10:00:00.000Z",
    phoneLookupKey: contactLookupKey,
    userId: TEST_USER_ID,
  });
  const editedSourceInputId = createHostedMailboxAssistantInputId({
    dedupeKey: original.eventId,
    eventId: original.eventId,
    lane: "conversation",
    secret: readHostedConversationAssistantIdentifierSecret(original),
    userId: original.userId,
  });
  const corrections = Array.from(
    { length: sourceRowCount - 1 },
    (_, index) => buildHostedExecutionLinqConversationMessageWake({
      accountLookupKey,
      contactKind: "phone",
      contactLookupKey,
      eventId: `event_edit_composition_existing_${index + 1}`,
      linqMessage: {
        chatId: TEST_CHAT_ID,
        editedSourceInputId,
        editedTextPartIndex: 0,
        from: TEST_SENDER_PHONE,
        isFromMe: false,
        messageId: TEST_MESSAGE_ID,
        parts: [{
          type: "text",
          value: `Accepted correction ${index + 1}`,
        }],
        reactionEligible: false,
        service: "iMessage",
        threadIsDirect: true,
      },
      occurredAt: `2026-08-11T10:0${index + 1}:00.000Z`,
      phoneLookupKey: contactLookupKey,
      userId: TEST_USER_ID,
    }),
  );
  return [original, ...corrections];
}

async function buildEncryptedSourceRow(input: {
  index: number;
  root: RootFixture;
  sourceMessageLookupKey: string;
  wake: LinqConversationWake;
}): Promise<HostedMailboxSourceConversationPreparationRow> {
  const ordinal = input.index + 1;
  const itemId = `mailbox_edit_composition_${ordinal}`;
  const laneSeq = BigInt(ordinal);
  const metadata: HostedMailboxPayloadCryptoMetadata = {
    dedupeKey: input.wake.eventId,
    itemId,
    kind: input.wake.kind,
    lane: "conversation",
    laneSeq,
    occurredAt: input.wake.occurredAt,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    payloadStorage: "inline",
    userId: TEST_USER_ID,
  };
  const scope = buildHostedMailboxPayloadScope("inline");
  const payloadInlineCiphertext = serializeHostedSecureBoxEnvelope(
    await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        ...buildHostedMailboxPayloadSecureBoxAad(metadata),
        domain: "ingress",
        lane: "mailbox-payload",
        scope,
        tenant: "murph-hosted",
        userId: TEST_USER_ID,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(JSON.stringify(input.wake)),
      rootKey: input.root.rootKey,
      rootKeyId: input.root.envelope.rootKeyId,
      scope,
    }),
  );
  const occurredAt = new Date(input.wake.occurredAt);
  return {
    causalSeq: laneSeq,
    createdAt: occurredAt,
    dedupeKey: input.wake.eventId,
    expiresAt: null,
    itemId,
    kind: input.wake.kind,
    lane: "conversation",
    laneSeq,
    occurredAt,
    payloadInlineCiphertext,
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    sidecarMailboxItemId: null,
    sidecarPayloadCiphertext: null,
    sidecarPayloadSchema: null,
    sidecarUserId: null,
    sourceMessageLookupKey: input.sourceMessageLookupKey,
    userId: TEST_USER_ID,
  };
}

async function createSignedIngressRoot(input: {
  active: boolean;
  index: number;
  signer: CryptoKey;
}): Promise<RootFixture> {
  const ordinal = input.index + 1;
  const rootKeyId = `root_ingress_edit_composition_${ordinal}`;
  const rootKey = new Uint8Array(32).fill(ordinal);
  const wrapCiphertext = `kms-edit-composition-${ordinal}`;
  const timestamp = `2026-08-11T09:${String(ordinal).padStart(2, "0")}:00.000Z`;
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "ingress",
    env: "test",
    recipient: "web-ingress-kms",
    rootKeyId,
    userId: TEST_USER_ID,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: timestamp,
    domain: "ingress",
    generation: ordinal,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: timestamp,
    userId: TEST_USER_ID,
    wraps: [{
      additionalAuthenticatedData:
        serializeAdditionalAuthenticatedData(encryptionContext),
      ciphertextBlob: wrapCiphertext,
      encryptionContext,
      kind: "gcp-kms",
      kmsKeyName: WEB_WRAP_KEY_NAME,
      recipient: "web-ingress-kms",
    }],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signer,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  const envelope = attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: AUTHORITY_KEY_VERSION,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: timestamp,
  });
  return {
    envelope,
    rootKey,
    row: {
      domain: "ingress",
      id: `crypto_envelope_edit_composition_${ordinal}`,
      rootKeyId,
      signedEnvelopeJson: envelope,
      status: input.active ? "active" : "decrypt_only",
      updatedAt: new Date(timestamp),
      userId: TEST_USER_ID,
    },
    wrapCiphertext,
  };
}

function buildLinqMessageEditedEvent() {
  return {
    api_version: "v3",
    created_at: "2026-08-11T10:10:00.000Z",
    data: {
      chat: { id: TEST_CHAT_ID },
      direction: "inbound",
      edited_at: "2026-08-11T10:10:00.000Z",
      id: TEST_MESSAGE_ID,
      part: {
        index: 0,
        text: "Newest corrected wording",
      },
      sender_handle: {
        handle: TEST_SENDER_PHONE,
        id: "sender_handle_edit_composition",
        is_me: false,
        service: "iMessage",
      },
    },
    event_id: "event_edit_composition_new",
    event_type: "message.edited",
    webhook_version: "2026-02-03",
  } as const;
}

function readRootBatchReferences(value: unknown): Array<{
  domain: string;
  rootKeyId: string;
  userId: string;
}> {
  if (!value || typeof value !== "object") {
    throw new Error("Expected a hosted root batch query input.");
  }
  const where = (value as { where?: unknown }).where;
  if (!where || typeof where !== "object") {
    throw new Error("Expected a hosted root batch where clause.");
  }
  const references = (where as { OR?: unknown }).OR;
  if (!Array.isArray(references)) {
    throw new Error("Expected a hosted root batch OR clause.");
  }
  return references.map((reference) => {
    if (!reference || typeof reference !== "object") {
      throw new Error("Expected a hosted root batch reference.");
    }
    const candidate = reference as {
      domain?: unknown;
      rootKeyId?: unknown;
      userId?: unknown;
    };
    if (
      typeof candidate.domain !== "string"
      || typeof candidate.rootKeyId !== "string"
      || typeof candidate.userId !== "string"
    ) {
      throw new Error("Expected a complete hosted root batch reference.");
    }
    return {
      domain: candidate.domain,
      rootKeyId: candidate.rootKeyId,
      userId: candidate.userId,
    };
  });
}

function readRawInvocation(args: readonly unknown[]): {
  sql: string;
  values: readonly unknown[];
} {
  const first = args[0];
  if (
    first
    && typeof first === "object"
    && "strings" in first
    && "values" in first
  ) {
    const query = first as { strings: readonly string[]; values: readonly unknown[] };
    return {
      sql: normalizeSql(query.strings.join("?")),
      values: query.values,
    };
  }
  if (Array.isArray(first)) {
    return {
      sql: normalizeSql((first as readonly string[]).join("?")),
      values: args.slice(1),
    };
  }
  throw new Error("Expected a Prisma raw-query invocation.");
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function requireHostedLookupKey(
  value: string | null,
  label: string,
): string {
  if (!value) {
    throw new Error(`Expected a hosted ${label} lookup key.`);
  }
  return value;
}

function requireNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function configureHostedContactPrivacyKeyringForTest(): void {
  vi.stubEnv(
    "HOSTED_CONTACT_PRIVACY_KEYS",
    [
      `v1:${Buffer.alloc(32, 0).toString("base64")}`,
      `v2:${Buffer.alloc(32, 1).toString("base64")}`,
    ].join(","),
  );
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
  vi.stubEnv(
    "HOSTED_MAILBOX_FINGERPRINT_KEY",
    Buffer.alloc(32, 3).toString("base64"),
  );
  clearHostedOnboardingEnvCache();
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
  vi.stubEnv(
    "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
    AUTHORITY_KEY_VERSION,
  );
  vi.stubEnv(
    "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
    input.signerPublicKeyPem.replace(/\n/gu, "\\n"),
  );
  vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", WEB_WRAP_KEY_NAME);
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
