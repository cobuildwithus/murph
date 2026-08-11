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
const TEST_CONTACT_PRIVACY_KEY =
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
const TEST_ROOT_KEY = new Uint8Array(32).fill(7);
const TEST_ROOT_KEY_ID = "root_ingress_reaction_composition_1";
const TEST_USER_ID = "member_group_123";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  decryptTransactionStates: [] as boolean[],
  insertedCiphertext: null as string | null,
  kmsClient: null as HostedGcpKmsClient | null,
  signedEnvelope: null as HostedDomainRootKeyEnvelopeV1 | null,
  transactionDepth: 0,
  updateManyInput: null as unknown,
}));

const mocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  lockHostedThreadRouteByThreadIdentityTx: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv: () => {
      if (!state.kmsClient) {
        throw new Error("Hosted reaction composition KMS client was not configured.");
      }
      return state.kmsClient;
    },
  };
});

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  lockHostedThreadRouteByThreadIdentityTx:
    mocks.lockHostedThreadRouteByThreadIdentityTx,
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  stageHostedLinqGroupReactionContext,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context";

beforeEach(async () => {
  vi.resetAllMocks();
  state.calls.length = 0;
  state.decryptTransactionStates.length = 0;
  state.insertedCiphertext = null;
  state.transactionDepth = 0;
  state.updateManyInput = null;
  setHostedSecureBoxStringTestCodecForTests(null);
  configureHostedContactPrivacyKeyringForTest();
  state.signedEnvelope = await createSignedIngressEnvelope();
  state.kmsClient = createKmsClient();

  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(
    buildCanonicalRoute(),
  );
  mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
  mocks.acquireHostedLinqChatOwnershipLockTx.mockResolvedValue(undefined);
  mocks.lockHostedThreadRouteByThreadIdentityTx.mockResolvedValue(undefined);
  mocks.signalHostedMailboxAppendRuntime.mockImplementation(async () => {
    state.calls.push("signal");
    return {
      signalAccepted: true,
      workflowId: `hosted-user-runtime:${TEST_USER_ID}`,
    };
  });
});

afterEach(() => {
  state.kmsClient = null;
  state.signedEnvelope = null;
  setHostedSecureBoxStringTestCodecForTests(null);
  vi.unstubAllEnvs();
  clearHostedOnboardingEnvCache();
});

describe("Linq reaction mailbox root composition", () => {
  it("warms the real ingress root before BEGIN and seals from cache inside the transaction", async () => {
    const prisma = createPrismaStub();

    await expect(stageHostedLinqGroupReactionContext({
      event: buildReactionEvent(),
      prisma,
    })).resolves.toBe(true);

    expect(state.decryptTransactionStates).toEqual([false]);
    expect(state.calls.filter((call) => call === "root-row-read")).toHaveLength(1);
    expect(state.calls.filter((call) => call === "provider-decrypt")).toHaveLength(1);
    expect(state.calls.indexOf("provider-decrypt")).toBeLessThan(
      state.calls.indexOf("begin"),
    );
    expect(state.calls.indexOf("mailbox-insert")).toBeGreaterThan(
      state.calls.indexOf("begin"),
    );
    expect(state.calls.indexOf("mailbox-consume")).toBeLessThan(
      state.calls.indexOf("commit"),
    );
    expect(state.calls.indexOf("signal")).toBeGreaterThan(
      state.calls.indexOf("commit"),
    );

    expect(state.insertedCiphertext).not.toBeNull();
    expect(parseSerializedHostedSecureBoxEnvelope(
      state.insertedCiphertext ?? "",
    )).toMatchObject({
      domain: "ingress",
      lane: "mailbox-payload",
      rootKeyId: TEST_ROOT_KEY_ID,
      schema: "murph.hosted-secure-box.v1",
    });
    expect(state.updateManyInput).toMatchObject({
      data: {
        consumedAt: new Date("2026-07-14T12:00:00.000Z"),
      },
      where: {
        consumedAt: null,
        userId: TEST_USER_ID,
      },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });
});

function createKmsClient(): HostedGcpKmsClient {
  return {
    asymmetricSign: vi.fn(async () => {
      throw new Error("Unexpected KMS sign in reaction composition test.");
    }),
    decrypt: vi.fn(async (input) => {
      state.calls.push("provider-decrypt");
      state.decryptTransactionStates.push(state.transactionDepth > 0);
      expect(input).toMatchObject({
        additionalAuthenticatedData: expect.any(String),
        ciphertext: "test-kms-ciphertext",
        keyName: WEB_WRAP_KEY_NAME,
      });
      return { plaintext: Uint8Array.from(TEST_ROOT_KEY) };
    }),
    encrypt: vi.fn(async () => {
      throw new Error("Unexpected KMS encrypt in reaction composition test.");
    }),
    macSign: vi.fn(async () => {
      throw new Error("Unexpected KMS MAC in reaction composition test.");
    }),
  };
}

function createPrismaStub(): PrismaClient {
  const now = new Date("2026-07-14T12:00:00.000Z");
  const transactionClient = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join(" ");
      if (sql.includes("SELECT root_key_id AS \"rootKeyId\"")) {
        return [{ rootKeyId: TEST_ROOT_KEY_ID }];
      }
      if (sql.includes("INSERT INTO hosted_mailbox_lane_counter")) {
        return [{ seq: 1n }];
      }
      if (sql.includes("INSERT INTO hosted_mailbox_item")) {
        state.calls.push("mailbox-insert");
        state.insertedCiphertext = requireNullableString(values[11]);
        return [{
          assistantInputLookupKey: requireNullableString(values[2]),
          causalSeq: values[4] as bigint,
          consumedAt: null,
          createdAt: now,
          dedupeKey: String(values[7]),
          expiresAt: values[16] instanceof Date ? values[16] : null,
          id: String(values[0]),
          kind: String(values[8]),
          lane: String(values[5]),
          laneSeq: values[6] as bigint,
          occurredAt: values[9] as Date,
          payloadBytes: values[13] as number,
          payloadHash: requireNullableString(values[14]),
          payloadInlineCiphertext: state.insertedCiphertext,
          payloadRef: requireNullableString(values[12]),
          payloadSchema: String(values[10]),
          sourceMessageLookupKey: requireNullableString(values[3]),
          updatedAt: now,
          userId: String(values[1]),
        }];
      }
      throw new Error(`Unexpected reaction transaction query: ${sql}`);
    }),
    hostedMailboxItem: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async (input: unknown) => {
        state.calls.push("mailbox-consume");
        state.updateManyInput = input;
        return { count: 1 };
      }),
    },
    hostedMailboxPayload: {
      create: vi.fn(async () => {
        throw new Error("Reaction payload unexpectedly used sidecar storage.");
      }),
    },
    hostedThreadRoute: {
      findFirst: vi.fn(async () => ({ containerMemberId: TEST_USER_ID })),
    },
    hostedWorkspace: {
      upsert: vi.fn(async () => ({ userId: TEST_USER_ID })),
    },
  } as unknown as Prisma.TransactionClient;
  const transaction = vi.fn(async (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => {
    state.calls.push("begin");
    state.transactionDepth += 1;
    try {
      const result = await callback(transactionClient);
      state.calls.push("commit");
      return result;
    } catch (error) {
      state.calls.push("rollback");
      throw error;
    } finally {
      state.transactionDepth -= 1;
    }
  });
  return {
    $queryRaw: vi.fn(async () => {
      state.calls.push("root-row-read");
      const signedEnvelope = state.signedEnvelope;
      if (!signedEnvelope) {
        throw new Error("Signed reaction composition envelope was not configured.");
      }
      return [{
        domain: "ingress",
        id: "crypto_envelope_reaction_1",
        rootKeyId: TEST_ROOT_KEY_ID,
        signedEnvelopeJson: signedEnvelope,
        status: "active",
        updatedAt: now,
        userId: TEST_USER_ID,
      }];
    }),
    $transaction: transaction,
  } as unknown as PrismaClient;
}

async function createSignedIngressEnvelope(): Promise<HostedDomainRootKeyEnvelopeV1> {
  const signer = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const automationKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const signerPublicKeyPem = toSpkiPem(
    await crypto.subtle.exportKey("spki", signer.publicKey),
  );
  const automationPublicJwk = await crypto.subtle.exportKey(
    "jwk",
    automationKey.publicKey,
  );
  configureHostedCryptoEnv({ automationPublicJwk, signerPublicKeyPem });

  const now = "2026-07-14T12:00:00.000Z";
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "ingress",
    env: "test",
    recipient: "web-ingress-kms",
    rootKeyId: TEST_ROOT_KEY_ID,
    userId: TEST_USER_ID,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: "ingress",
    generation: 1,
    rootKeyId: TEST_ROOT_KEY_ID,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: TEST_USER_ID,
    wraps: [{
      additionalAuthenticatedData:
        serializeAdditionalAuthenticatedData(encryptionContext),
      ciphertextBlob: "test-kms-ciphertext",
      encryptionContext,
      kind: "gcp-kms",
      kmsKeyName: WEB_WRAP_KEY_NAME,
      recipient: "web-ingress-kms",
    }],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    signer.privateKey,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: AUTHORITY_KEY_VERSION,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
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
    `v1:${TEST_CONTACT_PRIVACY_KEY}`,
  );
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
  vi.stubEnv("HOSTED_MAILBOX_FINGERPRINT_KEY", Buffer.alloc(32, 3).toString("base64"));
  clearHostedOnboardingEnvCache();
}

function buildReactionEvent() {
  const parsed = parseHostedLinqProviderEvent({
    event: {
      api_version: "v3",
      created_at: "2026-07-14T12:00:00.000Z",
      data: {
        chat_id: "chat_group_123",
        from: "+15551234567",
        is_from_me: false,
        message_id: "message_target_123",
        reaction_type: "laugh",
      },
      event_id: "event_reaction_composition_123",
      event_type: "reaction.added",
      trace_id: "trace_reaction_composition_123",
      webhook_version: "2026-02-03",
    } as HostedLinqWebhookEvent,
  });
  if (!parsed) {
    throw new Error("Expected reaction provider event to parse.");
  }
  return parsed;
}

function buildCanonicalRoute() {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    accountLookupKey: "lookup_v1_test",
    channel: "linq",
    container: {
      billingStatus: "active",
      createdAt: timestamp,
      id: TEST_USER_ID,
      suspendedAt: null,
      updatedAt: timestamp,
    },
    containerMemberId: TEST_USER_ID,
    deliveryRouteState: {
      deliveryRouteEncrypted: "sealed-route-default",
      deliveryRouteEncryptedPresent: true,
      threadIdentityLookupKey: "identity-route-default",
      threadLookupKey: "thread-route-default",
    },
    owner: {
      billingStatus: "active",
      createdAt: timestamp,
      id: "member_owner_123",
      suspendedAt: null,
      updatedAt: timestamp,
    },
  };
}

function requireNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
