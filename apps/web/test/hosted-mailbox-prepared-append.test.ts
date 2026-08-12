import { Buffer } from "node:buffer";

import { buildHostedExecutionMemberActivatedWake } from "@murphai/hosted-execution";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const domainRootMocks = vi.hoisted(() => {
  class PreparationMismatchError extends Error {}
  return {
    lockAndReadActiveHostedDomainRootKeyIdTx: vi.fn(),
    prepareHostedDomainRootForWeb: vi.fn(),
    preparedRoots: new WeakMap<object, Promise<unknown>>(),
    PreparationMismatchError,
    revalidatePreparedHostedDomainRootForWebTx: vi.fn(),
    unwrapHostedDomainRootForWeb: vi.fn(),
  };
});
const mailboxEncryptionMocks = vi.hoisted(() => ({
  decryptHostedMailboxPayloadString: vi.fn(),
  encryptHostedMailboxPayloadString: vi.fn(),
  encryptHostedMailboxPayloadStringFromPreparedRoot: vi.fn(),
}));

vi.mock("../src/lib/hosted-crypto/domain-root-store", () => ({
  HostedDomainRootPreparationMismatchError:
    domainRootMocks.PreparationMismatchError,
  lockAndReadActiveHostedDomainRootKeyIdTx:
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx,
  prepareHostedDomainRootForWeb:
    domainRootMocks.prepareHostedDomainRootForWeb,
  revalidatePreparedHostedDomainRootForWebTx:
    domainRootMocks.revalidatePreparedHostedDomainRootForWebTx,
  unwrapHostedDomainRootForWeb: domainRootMocks.unwrapHostedDomainRootForWeb,
}));

vi.mock("../src/lib/hosted-mailbox/encryption", () => ({
  decryptHostedMailboxPayloadString:
    mailboxEncryptionMocks.decryptHostedMailboxPayloadString,
  encryptHostedMailboxPayloadString:
    mailboxEncryptionMocks.encryptHostedMailboxPayloadString,
  encryptHostedMailboxPayloadStringFromPreparedRoot:
    mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
}));

import {
  getHostedDomainRootUnwrapCache,
  runWithHostedDomainRootUnwrapCache,
} from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { hashHostedMailboxStoredPayload } from "../src/lib/hosted-mailbox/fingerprint";
import {
  appendHostedMailboxItem,
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  HostedMailboxAppendPreparationMismatchError,
  prepareHostedMailboxItemAppendCrypto,
  type HostedMailboxItemRow,
} from "../src/lib/hosted-mailbox/store";

const FIXED_NOW = new Date("2026-08-11T19:00:00.000Z");
const USER_ID = "member-prepared-mailbox-append";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function buildRootEnvelope(input: {
  rootKeyId: string;
  userId: string;
}): HostedDomainRootKeyEnvelopeV1 {
  return {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-key-version",
      signedAt: "2026-08-11T18:00:00.000Z",
      signature: "test-signature",
    },
    createdAt: "2026-08-11T18:00:00.000Z",
    domain: "ingress",
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: "2026-08-11T18:00:00.000Z",
    userId: input.userId,
    wraps: [],
  };
}

function installPreparedRootSequence(input: {
  events?: string[];
  gates?: Array<Promise<string>>;
  rootKeyIds?: string[];
}) {
  const cachedRootKeys: Uint8Array[] = [];
  let index = 0;
  domainRootMocks.unwrapHostedDomainRootForWeb.mockImplementation(
    async (request: { domain: string; userId: string }) => {
      const currentIndex = index;
      index += 1;
      input.events?.push(`prepare-start:${currentIndex + 1}`);
      const rootKeyId = input.gates
        ? await input.gates[currentIndex]
        : input.rootKeyIds?.[currentIndex];
      if (!rootKeyId) {
        throw new Error("Prepared root fixture was exhausted.");
      }

      const envelope = buildRootEnvelope({
        rootKeyId,
        userId: request.userId,
      });
      const cachedRootKey = Uint8Array.from(
        { length: 32 },
        (_, keyIndex) => keyIndex + currentIndex + 1,
      );
      cachedRootKeys.push(cachedRootKey);
      const cached = Promise.resolve({ envelope, rootKey: cachedRootKey });
      const cache = getHostedDomainRootUnwrapCache();
      if (!cache) {
        throw new Error("Expected hosted domain-root cache during preparation.");
      }
      cache.set(`${request.userId}|${request.domain}|@active`, cached);
      cache.set(`${request.userId}|${request.domain}|${rootKeyId}`, cached);
      input.events?.push(`prepare-settled:${currentIndex + 1}`);
      return {
        envelope,
        rootKey: Uint8Array.from(cachedRootKey),
      };
    },
  );
  return cachedRootKeys;
}

interface MailboxFixture {
  events: string[];
  hostedMailboxPayloadCreate: ReturnType<typeof vi.fn>;
  prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    hostedMailboxItem: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  rollbacks: { count: number };
  tx: {
    $executeRaw: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    hostedMailboxItem: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    hostedMailboxPayload: {
      create: ReturnType<typeof vi.fn>;
    };
    hostedWorkspace: {
      upsert: ReturnType<typeof vi.fn>;
    };
  };
}

function buildMailboxRow(overrides: Partial<HostedMailboxItemRow> = {}): HostedMailboxItemRow {
  return {
    assistantInputLookupKey: null,
    causalSeq: 1n,
    consumedAt: null,
    createdAt: FIXED_NOW,
    dedupeKey: "dedupe-prepared-mailbox",
    expiresAt: null,
    id: "mailbox-prepared-mailbox",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 1n,
    occurredAt: FIXED_NOW,
    payloadBytes: 32,
    payloadHash: "hmac-sha256:prepared-mailbox-hash",
    payloadInlineCiphertext: "cipher-prepared-mailbox",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    sourceMessageLookupKey: null,
    updatedAt: FIXED_NOW,
    userId: USER_ID,
    ...overrides,
  };
}

function createMailboxFixture(input: {
  beforeTransactionRun?: () => void;
  existingBeforePreparation?: HostedMailboxItemRow | null;
} = {}): MailboxFixture {
  const events: string[] = [];
  const rollbacks = { count: 0 };
  const rootFindUnique = vi.fn(async () =>
    input.existingBeforePreparation ?? null
  );
  const txFindUnique = vi.fn(async () => null);
  const hostedMailboxPayloadCreate = vi.fn(async () => undefined);
  const executeRaw = vi.fn(async () => {
    events.push("mailbox-lock");
    return 1;
  });
  const queryRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("hosted_mailbox_lane_counter")) {
        return [{ seq: 1n }];
      }
      if (sql.includes("INSERT INTO hosted_mailbox_item")) {
        const row = buildMailboxRow({
          assistantInputLookupKey: values[2] as string | null,
          causalSeq: values[4] as bigint,
          dedupeKey: String(values[7]),
          expiresAt: values[15] as Date | null,
          id: String(values[0]),
          kind: String(values[8]),
          lane: String(values[5]),
          laneSeq: values[6] as bigint,
          occurredAt: values[9] as Date,
          payloadBytes: values[13] as number,
          payloadHash: values[14] as string,
          payloadInlineCiphertext: values[11] as string | null,
          payloadRef: values[12] as string | null,
          payloadSchema: String(values[10]),
          sourceMessageLookupKey: values[3] as string | null,
          userId: String(values[1]),
        });
        return [row];
      }
      throw new Error(`Unexpected prepared mailbox query: ${sql}`);
    },
  );
  const tx = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    hostedMailboxItem: { findUnique: txFindUnique },
    hostedMailboxPayload: { create: hostedMailboxPayloadCreate },
    hostedWorkspace: { upsert: vi.fn(async () => undefined) },
  };
  const transaction = vi.fn(async (
    run: (transactionClient: MailboxFixture["tx"]) => Promise<unknown>,
  ) => {
    events.push("transaction-start");
    try {
      input.beforeTransactionRun?.();
      const result = await run(tx);
      events.push("transaction-commit");
      return result;
    } catch (error) {
      rollbacks.count += 1;
      events.push("transaction-rollback");
      throw error;
    }
  });

  return {
    events,
    hostedMailboxPayloadCreate,
    prisma: {
      $transaction: transaction,
      hostedMailboxItem: { findUnique: rootFindUnique },
    },
    rollbacks,
    tx,
  };
}

function buildAppendInput(payloadSerializedJson = JSON.stringify({ body: "hello" })) {
  return {
    dedupeKey: "dedupe-prepared-mailbox",
    kind: "conversation.message",
    lane: "conversation",
    occurredAt: FIXED_NOW,
    payloadSerializedJson,
    userId: USER_ID,
  };
}

beforeEach(() => {
  domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx.mockReset();
  domainRootMocks.unwrapHostedDomainRootForWeb.mockReset();
  domainRootMocks.prepareHostedDomainRootForWeb.mockReset();
  domainRootMocks.revalidatePreparedHostedDomainRootForWebTx.mockReset();
  domainRootMocks.preparedRoots = new WeakMap();
  domainRootMocks.prepareHostedDomainRootForWeb.mockImplementation(
    async (input: { domain: string; userId: string }) => {
      const unwrapped = await domainRootMocks.unwrapHostedDomainRootForWeb(input);
      const rootKeyId = unwrapped.envelope.rootKeyId as string;
      const cached = getHostedDomainRootUnwrapCache()?.get(
        `${input.userId}|${input.domain}|${rootKeyId}`,
      );
      if (!cached) {
        throw new Error("Prepared root fixture did not retain its exact cache entry.");
      }
      const prepared = Object.freeze({
        domain: input.domain,
        rootKeyId,
        userId: input.userId,
      });
      domainRootMocks.preparedRoots.set(prepared, cached);
      return prepared;
    },
  );
  domainRootMocks.revalidatePreparedHostedDomainRootForWebTx.mockImplementation(
    async (input: { prepared: { domain: string; rootKeyId: string; userId: string } }) => {
      const cached = getHostedDomainRootUnwrapCache()?.get(
        `${input.prepared.userId}|${input.prepared.domain}|${input.prepared.rootKeyId}`,
      );
      const preparedRoot = domainRootMocks.preparedRoots.get(input.prepared);
      if (!cached || cached !== preparedRoot) {
        throw new TypeError(
          "Hosted mailbox append prepared root is not the exact scoped cache entry.",
        );
      }
      const activeRootKeyId = await domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx();
      if (activeRootKeyId !== input.prepared.rootKeyId) {
        throw new domainRootMocks.PreparationMismatchError();
      }
      return { root: cached, rootKeyId: input.prepared.rootKeyId };
    },
  );
  mailboxEncryptionMocks.decryptHostedMailboxPayloadString.mockReset();
  mailboxEncryptionMocks.encryptHostedMailboxPayloadString.mockReset();
  mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot.mockReset();
  mailboxEncryptionMocks.encryptHostedMailboxPayloadString.mockRejectedValue(
    new Error("Legacy mailbox encryption must not run from the prepared owner."),
  );
  mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot
    .mockImplementation(async (input: { payloadStorage: string }) =>
      `cipher:${input.payloadStorage}`
    );
});

describe("appendHostedMailboxItem prepared crypto owner", () => {
  it("settles provider preparation before starting the transaction", async () => {
    const fixture = createMailboxFixture();
    const gate = createDeferred<string>();
    installPreparedRootSequence({
      events: fixture.events,
      gates: [gate.promise],
    });
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx
      .mockImplementation(async () => {
        fixture.events.push("root-authority-revalidated");
        return "root-prepared-1";
      });
    mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot
      .mockImplementation(async (input: { payloadStorage: string }) => {
        fixture.events.push("local-seal");
        return `cipher:${input.payloadStorage}`;
      });

    const pending = appendHostedMailboxItem({
      ...buildAppendInput(),
      prisma: fixture.prisma as never,
    });
    await vi.waitFor(() => {
      expect(domainRootMocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledTimes(1);
    });
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();

    gate.resolve("root-prepared-1");
    await expect(pending).resolves.toMatchObject({
      duplicate: false,
      inserted: true,
    });

    expect(fixture.events.indexOf("prepare-settled:1")).toBeLessThan(
      fixture.events.indexOf("transaction-start"),
    );
    expect(fixture.events.indexOf("root-authority-revalidated")).toBeLessThan(
      fixture.events.indexOf("mailbox-lock"),
    );
    expect(fixture.events.indexOf("mailbox-lock")).toBeLessThan(
      fixture.events.indexOf("local-seal"),
    );
    expect(mailboxEncryptionMocks.encryptHostedMailboxPayloadString).not.toHaveBeenCalled();
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "dedupe-prepared-mailbox",
      laneSeq: 1n,
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      payloadStorage: "inline",
      preparedRootKeyId: "root-prepared-1",
      userId: USER_ID,
    }));
  });

  it("keeps envelope projection on the transaction-local prepared path", async () => {
    const fixture = createMailboxFixture();
    installPreparedRootSequence({ rootKeyIds: ["root-prepared-envelope"] });
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx
      .mockResolvedValue("root-prepared-envelope");
    const envelope = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:prepared-envelope",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      memberId: USER_ID,
      occurredAt: FIXED_NOW.toISOString(),
      signupWelcome: null,
    });

    await runWithHostedDomainRootUnwrapCache(async () => {
      const prepared = await prepareHostedMailboxItemAppendCrypto({
        prisma: fixture.prisma as never,
        userId: USER_ID,
      });
      await expect(appendHostedMailboxEnvelopeWithPreparedCryptoTx({
        envelope,
        prepared,
        tx: fixture.tx as never,
      })).resolves.toMatchObject({
        duplicate: false,
        inserted: true,
      });
    });

    expect(fixture.tx.hostedWorkspace.upsert).toHaveBeenCalledWith({
      create: { userId: USER_ID },
      update: {},
      where: { userId: USER_ID },
    });
    expect(domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx)
      .toHaveBeenCalledTimes(1);
    expect(mailboxEncryptionMocks.encryptHostedMailboxPayloadString)
      .not.toHaveBeenCalled();
    expect(mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot)
      .toHaveBeenCalledWith(expect.objectContaining({
        preparedRootKeyId: "root-prepared-envelope",
        userId: USER_ID,
      }));
  });

  it("rejects a same-key cache replacement before taking mailbox locks", async () => {
    const rootKeyId = "root-exact-cache-entry";
    const fixture = createMailboxFixture({
      beforeTransactionRun: () => {
        const cache = getHostedDomainRootUnwrapCache();
        const prepared = cache?.get(`${USER_ID}|ingress|${rootKeyId}`);
        if (!cache || !prepared) {
          throw new Error("Expected prepared mailbox cache entry before transaction callback.");
        }
        cache.set(`${USER_ID}|ingress|${rootKeyId}`, prepared.then((root) => ({
          envelope: root.envelope,
          rootKey: Uint8Array.from(root.rootKey),
        })));
      },
    });
    installPreparedRootSequence({ rootKeyIds: [rootKeyId] });

    await expect(appendHostedMailboxItem({
      ...buildAppendInput(),
      prisma: fixture.prisma as never,
    })).rejects.toThrow(
      "Hosted mailbox append prepared root is not the exact scoped cache entry.",
    );

    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fixture.rollbacks.count).toBe(1);
    expect(domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx).not.toHaveBeenCalled();
    expect(fixture.tx.$executeRaw).not.toHaveBeenCalled();
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).not.toHaveBeenCalled();
  });

  it("opens zero transactions when provider preparation fails", async () => {
    const fixture = createMailboxFixture();
    const providerFailure = new Error("kms unavailable");
    domainRootMocks.unwrapHostedDomainRootForWeb.mockRejectedValue(providerFailure);

    await expect(appendHostedMailboxItem({
      ...buildAppendInput(),
      prisma: fixture.prisma as never,
    })).rejects.toBe(providerFailure);

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx).not.toHaveBeenCalled();
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).not.toHaveBeenCalled();
  });

  it("rolls back exact root drift, fully prepares again once, and then commits", async () => {
    const fixture = createMailboxFixture();
    const cachedRootKeys = installPreparedRootSequence({
      rootKeyIds: ["root-before-drift", "root-after-drift"],
    });
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx
      .mockResolvedValueOnce("root-won-by-another-writer")
      .mockResolvedValueOnce("root-after-drift");

    await expect(appendHostedMailboxItem({
      ...buildAppendInput(),
      prisma: fixture.prisma as never,
    })).resolves.toMatchObject({
      duplicate: false,
      inserted: true,
    });

    expect(domainRootMocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.rollbacks.count).toBe(1);
    expect(fixture.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).toHaveBeenCalledTimes(1);
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).toHaveBeenCalledWith(expect.objectContaining({
      preparedRootKeyId: "root-after-drift",
    }));
    for (const cachedRootKey of cachedRootKeys) {
      expect([...cachedRootKey]).toEqual(Array.from({ length: 32 }, () => 0));
    }
  });

  it("fails closed after a second exact root drift", async () => {
    const fixture = createMailboxFixture();
    installPreparedRootSequence({
      rootKeyIds: ["root-drift-attempt-1", "root-drift-attempt-2"],
    });
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx
      .mockResolvedValueOnce("root-current-1")
      .mockResolvedValueOnce("root-current-2");

    await expect(appendHostedMailboxItem({
      ...buildAppendInput(),
      prisma: fixture.prisma as never,
    })).rejects.toBeInstanceOf(HostedMailboxAppendPreparationMismatchError);

    expect(domainRootMocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.rollbacks.count).toBe(2);
    expect(fixture.tx.$executeRaw).not.toHaveBeenCalled();
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).not.toHaveBeenCalled();
  });

  it("does not retry a non-preparation transaction failure", async () => {
    const fixture = createMailboxFixture();
    installPreparedRootSequence({ rootKeyIds: ["root-non-preparation-error"] });
    const transactionFailure = new Error("database authority read failed");
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx
      .mockRejectedValue(transactionFailure);

    await expect(appendHostedMailboxItem({
      ...buildAppendInput(),
      prisma: fixture.prisma as never,
    })).rejects.toBe(transactionFailure);

    expect(domainRootMocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledTimes(1);
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fixture.rollbacks.count).toBe(1);
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).not.toHaveBeenCalled();
  });

  it("returns an already durable dedupe replay without crypto preparation or a transaction", async () => {
    const payloadSerializedJson = JSON.stringify({ body: "hello" });
    const existing = buildMailboxRow({
      dedupeKey: "dedupe-prepared-mailbox",
      payloadBytes: Buffer.byteLength(payloadSerializedJson, "utf8"),
      payloadHash: hashHostedMailboxStoredPayload({
        serialized: payloadSerializedJson,
        userId: USER_ID,
      }),
    });
    const fixture = createMailboxFixture({
      existingBeforePreparation: existing,
    });

    await expect(appendHostedMailboxItem({
      ...buildAppendInput(payloadSerializedJson),
      prisma: fixture.prisma as never,
    })).resolves.toMatchObject({
      duplicate: true,
      inserted: false,
      item: {
        id: existing.id,
      },
    });

    expect(domainRootMocks.unwrapHostedDomainRootForWeb).not.toHaveBeenCalled();
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).not.toHaveBeenCalled();
  });

  it("keeps oversized payloads sidecar-backed with sequence-bound prepared AAD", async () => {
    const fixture = createMailboxFixture();
    installPreparedRootSequence({ rootKeyIds: ["root-sidecar"] });
    domainRootMocks.lockAndReadActiveHostedDomainRootKeyIdTx
      .mockResolvedValue("root-sidecar");
    const payloadSerializedJson = JSON.stringify({ body: "x".repeat(140_000) });

    const result = await appendHostedMailboxItem({
      ...buildAppendInput(payloadSerializedJson),
      kind: "assistant.notification.requested",
      lane: "system",
      prisma: fixture.prisma as never,
    });

    expect(result.item).toMatchObject({
      payloadInlineCiphertext: null,
      payloadRef: `hosted-mailbox-payload:${result.item.id}`,
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    });
    expect(
      mailboxEncryptionMocks.encryptHostedMailboxPayloadStringFromPreparedRoot,
    ).toHaveBeenCalledWith(expect.objectContaining({
      itemId: result.item.id,
      laneSeq: 1n,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadStorage: "sidecar",
      preparedRootKeyId: "root-sidecar",
    }));
    expect(fixture.hostedMailboxPayloadCreate).toHaveBeenCalledWith({
      data: {
        mailboxItemId: result.item.id,
        payloadCiphertext: "cipher:sidecar",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        userId: USER_ID,
      },
    });
  });
});
