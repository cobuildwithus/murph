import { Buffer } from "node:buffer";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
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
  sealHostedSecureBox,
  serializeAdditionalAuthenticatedData,
  serializeHostedSecureBoxEnvelope,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedGcpKmsClient,
} from "@/src/lib/hosted-crypto/gcp-kms";
import {
  runWithHostedDomainRootProviderCallsDisabled,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";

const AUTHORITY_KEY_VERSION =
  "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1";
const WEB_WRAP_KEY_NAME =
  "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap";
const NOW = new Date("2026-08-22T01:00:00.000Z");
const ORIGIN_MEMBER_ID = "member_handoff_origin_composition";
const TARGET_MEMBER_ID = "member_handoff_target_composition";
const HANDOFF_EVENT_ID = "group-context-handoff:crypto-composition";

const state = vi.hoisted(() => ({
  kmsClient: null as HostedGcpKmsClient | null,
}));

vi.mock("@/src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv: () => {
      if (!state.kmsClient) {
        throw new Error("Hosted handoff composition KMS client was not configured.");
      }
      return state.kmsClient;
    },
  };
});

import {
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxWakeByItemId,
  runWithPreparedHostedMailboxItemAppendCrypto,
  type HostedMailboxItemRow,
} from "@/src/lib/hosted-mailbox/store";
import {
  createHostedAssistantInputLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

beforeEach(() => {
  vi.resetAllMocks();
  setHostedSecureBoxStringTestCodecForTests(null);
  configureHostedContactPrivacyKeyringForTest();
});

afterEach(() => {
  state.kmsClient = null;
  setHostedSecureBoxStringTestCodecForTests(null);
  vi.unstubAllEnvs();
  clearHostedOnboardingEnvCache();
});

describe("group context handoff crypto composition", () => {
  it("prepares both member roots before fresh append and exact replay transactions", async () => {
    const harness = await createCompositionHarness();

    const fresh = await runWithPreparedHostedMailboxItemAppendCrypto({
      append: (prepared) => harness.prisma.$transaction((tx) =>
        runWithHostedDomainRootProviderCallsDisabled(async () => {
          const origin = await readHostedMailboxConversationWakeByAssistantInputId({
            assistantInputId: harness.originAssistantInputId,
            availableAt: NOW,
            memberId: ORIGIN_MEMBER_ID,
            prisma: tx,
          });
          expect(origin?.eventId).toBe(harness.originWake.eventId);
          return appendHostedMailboxEnvelopeWithPreparedCryptoTx({
            envelope: harness.handoffWake,
            expiresAt: harness.expiresAt,
            itemId: HANDOFF_EVENT_ID,
            prepared,
            tx,
          });
        })
      ),
      prepareExisting: () => prepareHandoffRows(harness),
      prisma: harness.prisma,
      userId: TARGET_MEMBER_ID,
    });

    expect(fresh).toMatchObject({
      duplicate: false,
      inserted: true,
      item: { id: HANDOFF_EVENT_ID, userId: TARGET_MEMBER_ID },
    });

    const replay = await runWithPreparedHostedMailboxItemAppendCrypto({
      append: () => harness.prisma.$transaction((tx) =>
        runWithHostedDomainRootProviderCallsDisabled(async () => {
          const [persisted, origin] = await Promise.all([
            readHostedMailboxWakeByItemId({
              availableAt: NOW,
              mailboxItemId: HANDOFF_EVENT_ID,
              prisma: tx,
            }),
            readHostedMailboxConversationWakeByAssistantInputId({
              assistantInputId: harness.originAssistantInputId,
              availableAt: NOW,
              memberId: ORIGIN_MEMBER_ID,
              prisma: tx,
            }),
          ]);
          return {
            mailboxItemId: persisted?.eventId ?? null,
            originEventId: origin?.eventId ?? null,
          };
        })
      ),
      prepareExisting: () => prepareHandoffRows(harness),
      prisma: harness.prisma,
      userId: TARGET_MEMBER_ID,
    });

    expect(replay).toEqual({
      mailboxItemId: HANDOFF_EVENT_ID,
      originEventId: harness.originWake.eventId,
    });
    expect(harness.state.mailboxInsertCount).toBe(1);
    expect(harness.state.kmsTransactionStates).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(harness.state.kmsCallsAtTransactionBegin).toEqual([2, 4]);
    expect(harness.state.kmsCallsAtTransactionEnd).toEqual([2, 4]);
    expect(harness.state.transactionDepth).toBe(0);
  });
});

type ConversationWake = ReturnType<
  typeof buildHostedExecutionLinqConversationMessageWake
>;

type HandoffWake = ReturnType<
  typeof buildHostedExecutionAssistantNotificationRequestedWake
>;

type CryptoEnvelopeRow = {
  domain: "ingress";
  id: string;
  rootKeyId: string;
  signedEnvelopeJson: HostedDomainRootKeyEnvelopeV1;
  status: "active";
  updatedAt: Date;
  userId: string;
};

type RootFixture = {
  envelope: HostedDomainRootKeyEnvelopeV1;
  rootKey: Uint8Array;
  row: CryptoEnvelopeRow;
  wrapCiphertext: string;
};

type CompositionHarness = {
  expiresAt: string;
  handoffWake: HandoffWake;
  originAssistantInputId: string;
  originWake: ConversationWake;
  prisma: PrismaClient;
  state: CompositionState;
};

type CompositionState = {
  kmsCallsAtTransactionBegin: number[];
  kmsCallsAtTransactionEnd: number[];
  kmsTransactionStates: boolean[];
  mailboxInsertCount: number;
  transactionDepth: number;
};

async function prepareHandoffRows(harness: CompositionHarness): Promise<void> {
  await Promise.all([
    readHostedMailboxWakeByItemId({
      availableAt: NOW,
      mailboxItemId: HANDOFF_EVENT_ID,
      prisma: harness.prisma,
    }),
    readHostedMailboxConversationWakeByAssistantInputId({
      assistantInputId: harness.originAssistantInputId,
      availableAt: NOW,
      memberId: ORIGIN_MEMBER_ID,
      prisma: harness.prisma,
    }),
  ]);
}

async function createCompositionHarness(): Promise<CompositionHarness> {
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

  const [originRoot, targetRoot] = await Promise.all([
    createSignedRoot({ index: 1, signer: signer.privateKey, userId: ORIGIN_MEMBER_ID }),
    createSignedRoot({ index: 2, signer: signer.privateKey, userId: TARGET_MEMBER_ID }),
  ]);
  const originWake = buildOriginWake();
  const originAssistantInputId = createHostedMailboxAssistantInputId({
    dedupeKey: originWake.eventId,
    eventId: originWake.eventId,
    lane: "conversation",
    secret: readHostedConversationAssistantIdentifierSecret(originWake),
    userId: originWake.userId,
  });
  const originRow = await buildEncryptedMailboxRow({
    assistantInputLookupKey: requireAssistantInputLookupKey(originAssistantInputId),
    itemId: "mailbox_handoff_origin_composition",
    laneSeq: 1n,
    root: originRoot,
    wake: originWake,
  });
  const expiresAt = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
  const handoffWake = buildHandoffWake({ originAssistantInputId });
  const compositionState: CompositionState = {
    kmsCallsAtTransactionBegin: [],
    kmsCallsAtTransactionEnd: [],
    kmsTransactionStates: [],
    mailboxInsertCount: 0,
    transactionDepth: 0,
  };
  const roots = [originRoot, targetRoot];
  const rootsByCiphertext = new Map(
    roots.map((root) => [root.wrapCiphertext, root.rootKey] as const),
  );
  state.kmsClient = createKmsClient({ rootsByCiphertext, state: compositionState });

  return {
    expiresAt,
    handoffWake,
    originAssistantInputId,
    originWake,
    prisma: createPrismaStub({
      activeRoots: new Map([
        [ORIGIN_MEMBER_ID, originRoot],
        [TARGET_MEMBER_ID, targetRoot],
      ]),
      initialRows: [originRow],
      roots,
      state: compositionState,
    }),
    state: compositionState,
  };
}

function createKmsClient(input: {
  rootsByCiphertext: ReadonlyMap<string, Uint8Array>;
  state: CompositionState;
}): HostedGcpKmsClient {
  return {
    asymmetricSign: vi.fn(async () => {
      throw new Error("Unexpected KMS sign in handoff composition test.");
    }),
    decrypt: vi.fn(async (request) => {
      input.state.kmsTransactionStates.push(input.state.transactionDepth > 0);
      const rootKey = input.rootsByCiphertext.get(request.ciphertext);
      if (!rootKey) {
        throw new Error("Unexpected KMS ciphertext in handoff composition test.");
      }
      return { plaintext: Uint8Array.from(rootKey) };
    }),
    encrypt: vi.fn(async () => {
      throw new Error("Unexpected KMS encrypt in handoff composition test.");
    }),
    macSign: vi.fn(async () => {
      throw new Error("Unexpected KMS MAC in handoff composition test.");
    }),
  };
}

function createPrismaStub(input: {
  activeRoots: ReadonlyMap<string, RootFixture>;
  initialRows: readonly HostedMailboxItemRow[];
  roots: readonly RootFixture[];
  state: CompositionState;
}): PrismaClient {
  const rows = [...input.initialRows];
  const findById = (id: string): HostedMailboxItemRow | null =>
    rows.find((row) => row.id === id) ?? null;
  const delegates = {
    hostedMailboxItem: {
      findFirst: vi.fn(async (query: { where?: { id?: string } }) =>
        query.where?.id ? findById(query.where.id) : null
      ),
      findMany: vi.fn(async (query: {
        where?: {
          assistantInputLookupKey?: { in?: string[] };
          userId?: string;
        };
      }) => {
        const lookupKeys = new Set(
          query.where?.assistantInputLookupKey?.in ?? [],
        );
        return rows.filter((row) =>
          row.userId === query.where?.userId
          && row.assistantInputLookupKey !== null
          && lookupKeys.has(row.assistantInputLookupKey)
        ).map((row) => ({ id: row.id }));
      }),
      findUnique: vi.fn(async (query: {
        where?: {
          id?: string;
          userId_dedupeKey?: { dedupeKey: string; userId: string };
        };
      }) => {
        if (query.where?.id) {
          return findById(query.where.id);
        }
        const key = query.where?.userId_dedupeKey;
        return key
          ? rows.find((row) =>
            row.userId === key.userId && row.dedupeKey === key.dedupeKey
          ) ?? null
          : null;
      }),
    },
    hostedMailboxPayload: {
      create: vi.fn(async () => {
        throw new Error("Handoff payload unexpectedly used sidecar storage.");
      }),
    },
    hostedUserCryptoEnvelope: {
      findMany: vi.fn(async (query: { where?: { OR?: Array<{
        domain: string;
        rootKeyId: string;
        userId: string;
      }> } }) => {
        const references = query.where?.OR ?? [];
        return input.roots.flatMap((root) =>
          references.some((reference) =>
            reference.domain === root.row.domain
            && reference.rootKeyId === root.row.rootKeyId
            && reference.userId === root.row.userId
          ) ? [root.row] : []
        );
      }),
    },
    hostedWorkspace: {
      upsert: vi.fn(async () => ({ userId: TARGET_MEMBER_ID })),
    },
  };

  const queryRaw = vi.fn(async (...args: unknown[]) => {
    const invocation = readRawInvocation(args);
    const sql = invocation.sql.toLowerCase();
    if (
      sql.includes("from hosted_user_crypto_envelope")
      && sql.includes("root_key_id =")
      && invocation.values.length >= 3
    ) {
      const [userId, domain, rootKeyId] = invocation.values.map(String);
      const root = input.roots.find((candidate) =>
        candidate.row.userId === userId
        && candidate.row.domain === domain
        && candidate.row.rootKeyId === rootKeyId
      );
      return root ? [root.row] : [];
    }
    if (
      sql.includes("from hosted_user_crypto_envelope")
      && sql.includes("status = 'active'")
    ) {
      const root = input.activeRoots.get(String(invocation.values[0]));
      return root ? [root.row] : [];
    }
    if (sql.includes("insert into hosted_mailbox_lane_counter")) {
      return [{ seq: 1n }];
    }
    if (sql.includes("insert into hosted_mailbox_item")) {
      input.state.mailboxInsertCount += 1;
      const row: HostedMailboxItemRow = {
        assistantInputLookupKey: nullableString(invocation.values[2]),
        causalSeq: invocation.values[4] as bigint,
        consumedAt: null,
        createdAt: NOW,
        dedupeKey: String(invocation.values[7]),
        expiresAt: invocation.values[16] instanceof Date
          ? invocation.values[16]
          : null,
        id: String(invocation.values[0]),
        kind: String(invocation.values[8]),
        lane: String(invocation.values[5]),
        laneSeq: invocation.values[6] as bigint,
        occurredAt: invocation.values[9] as Date,
        payloadBytes: invocation.values[13] as number,
        payloadHash: nullableString(invocation.values[14]),
        payloadInlineCiphertext: nullableString(invocation.values[11]),
        payloadRef: nullableString(invocation.values[12]),
        payloadSchema: String(invocation.values[10]),
        sourceMessageLookupKey: nullableString(invocation.values[3]),
        updatedAt: NOW,
        userId: String(invocation.values[1]),
      };
      rows.push(row);
      return [row];
    }
    throw new Error(`Unexpected handoff composition query: ${invocation.sql}`);
  });
  const client = {
    ...delegates,
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient;
  const transaction = vi.fn(async <Result>(
    callback: (tx: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> => {
    input.state.kmsCallsAtTransactionBegin.push(
      input.state.kmsTransactionStates.length,
    );
    input.state.transactionDepth += 1;
    try {
      return await callback(client);
    } finally {
      input.state.kmsCallsAtTransactionEnd.push(
        input.state.kmsTransactionStates.length,
      );
      input.state.transactionDepth -= 1;
    }
  });
  return Object.assign(client, { $transaction: transaction }) as unknown as PrismaClient;
}

function buildOriginWake(): ConversationWake {
  return buildHostedExecutionLinqConversationMessageWake({
    accountLookupKey: "hidx:origin-account",
    contactKind: "phone",
    contactLookupKey: "hidx:origin-contact",
    eventId: "event_handoff_origin_composition",
    linqMessage: {
      chatId: "chat_handoff_origin_composition",
      from: "+15550000000",
      isFromMe: false,
      messageId: "message_handoff_origin_composition",
      parts: [{ type: "text", value: "Share this bounded fact." }],
      service: "iMessage",
      threadIsDirect: true,
    },
    occurredAt: NOW.toISOString(),
    phoneLookupKey: "hidx:origin-contact",
    userId: ORIGIN_MEMBER_ID,
  });
}

function buildHandoffWake(input: { originAssistantInputId: string }): HandoffWake {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: HANDOFF_EVENT_ID,
    memberId: TARGET_MEMBER_ID,
    notification: {
      deliveryDedupeToken: HANDOFF_EVENT_ID,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: HANDOFF_EVENT_ID,
      externalThreadRouteAuthority: {
        accountLookupKey: "hidx:group-account",
        channel: "linq",
        containerMemberId: TARGET_MEMBER_ID,
        threadId: "chat_handoff_group_composition",
      },
      groupContextHandoff: {
        membershipId: "membership_handoff_composition",
        originAssistantInputId: input.originAssistantInputId,
      },
      instructions: "Share one bounded factual message.",
      notificationPromptProfile: "context-handoff",
      responsePolicy: { kind: "require_send" },
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "thread", target: "chat_handoff_group_composition" },
        identityId: "identity_handoff_group_composition",
        threadId: "thread_handoff_group_composition",
        threadIsDirect: false,
      },
    },
    occurredAt: NOW.toISOString(),
  });
}

async function buildEncryptedMailboxRow(input: {
  assistantInputLookupKey: string;
  itemId: string;
  laneSeq: bigint;
  root: RootFixture;
  wake: ConversationWake;
}): Promise<HostedMailboxItemRow> {
  const serialized = JSON.stringify(input.wake);
  const metadata: HostedMailboxPayloadCryptoMetadata = {
    dedupeKey: input.wake.eventId,
    itemId: input.itemId,
    kind: input.wake.kind,
    lane: "conversation",
    laneSeq: input.laneSeq,
    occurredAt: input.wake.occurredAt,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    payloadStorage: "inline",
    userId: input.wake.userId,
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
        userId: input.wake.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(serialized),
      rootKey: input.root.rootKey,
      rootKeyId: input.root.envelope.rootKeyId,
      scope,
    }),
  );
  const occurredAt = new Date(input.wake.occurredAt);
  return {
    assistantInputLookupKey: input.assistantInputLookupKey,
    causalSeq: input.laneSeq,
    consumedAt: null,
    createdAt: occurredAt,
    dedupeKey: input.wake.eventId,
    expiresAt: null,
    id: input.itemId,
    kind: input.wake.kind,
    lane: "conversation",
    laneSeq: input.laneSeq,
    occurredAt,
    payloadBytes: Buffer.byteLength(serialized),
    payloadHash: "hmac-sha256:handoff-origin-composition",
    payloadInlineCiphertext,
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    sourceMessageLookupKey: null,
    updatedAt: occurredAt,
    userId: input.wake.userId,
  };
}

async function createSignedRoot(input: {
  index: number;
  signer: CryptoKey;
  userId: string;
}): Promise<RootFixture> {
  const rootKeyId = `root_handoff_composition_${input.index}`;
  const rootKey = new Uint8Array(32).fill(input.index);
  const wrapCiphertext = `kms-handoff-composition-${input.index}`;
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "ingress",
    env: "test",
    recipient: "web-ingress-kms",
    rootKeyId,
    userId: input.userId,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: NOW.toISOString(),
    domain: "ingress",
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: NOW.toISOString(),
    userId: input.userId,
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
    signedAt: NOW.toISOString(),
  });
  return {
    envelope,
    rootKey,
    row: {
      domain: "ingress",
      id: `crypto_envelope_handoff_composition_${input.index}`,
      rootKeyId,
      signedEnvelopeJson: envelope,
      status: "active",
      updatedAt: NOW,
      userId: input.userId,
    },
    wrapCiphertext,
  };
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
      sql: query.strings.join("?").replace(/\s+/gu, " ").trim(),
      values: query.values,
    };
  }
  if (Array.isArray(first)) {
    return {
      sql: (first as readonly string[]).join("?").replace(/\s+/gu, " ").trim(),
      values: args.slice(1),
    };
  }
  throw new Error("Expected a Prisma raw-query invocation.");
}

function requireAssistantInputLookupKey(assistantInputId: string): string {
  const lookupKey = createHostedAssistantInputLookupKey(assistantInputId);
  if (!lookupKey) {
    throw new Error("Expected an assistant input lookup key.");
  }
  return lookupKey;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
}

function configureHostedContactPrivacyKeyringForTest(): void {
  vi.stubEnv(
    "HOSTED_CONTACT_PRIVACY_KEYS",
    `v1:${Buffer.alloc(32, 0).toString("base64")}`,
  );
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
  vi.stubEnv(
    "HOSTED_MAILBOX_FINGERPRINT_KEY",
    Buffer.alloc(32, 3).toString("base64"),
  );
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
