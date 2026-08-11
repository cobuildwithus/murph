import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
} from "@murphai/hosted-execution/pending-group-setup";

const mocks = vi.hoisted(() => ({
  getUnwrapCache: vi.fn(),
  openFromPreparedRoot: vi.fn(),
  openRoutingRecords: vi.fn(),
  readAccessSet: vi.fn(),
  readManagedLineSet: vi.fn(),
  readRecoveryAuthorities: vi.fn(),
  readRootReference: vi.fn(),
  readRoutingRecords: vi.fn(),
  seal: vi.fn(),
  unwrapRoots: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  getHostedDomainRootUnwrapCache: mocks.getUnwrapCache,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootsForWebByRootKeyIds: mocks.unwrapRoots,
}));

vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxStringFromPreparedRoot: mocks.openFromPreparedRoot,
  openHostedUserSecureBoxStrings: vi.fn(),
  readHostedUserSecureBoxStringRootReference: mocks.readRootReference,
  sealHostedUserSecureBoxString: mocks.seal,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedPhoneLookupKeyReadCandidates: (value: string | null) =>
    value ? [value] : [],
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  openHostedMemberRoutingHomeLinqRecipientPhoneRecords:
    mocks.openRoutingRecords,
  readHostedMemberRoutingHomeLinqRecipientPhoneRecords:
    mocks.readRoutingRecords,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  readHostedLinqGroupLineRecoveryAuthoritiesTx:
    mocks.readRecoveryAuthorities,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-line-store")
  >();
  return {
    ...actual,
    hasActiveHostedLinqManagedLine: vi.fn(),
    readActiveHostedLinqManagedLineLookupKeys: mocks.readManagedLineSet,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >();
  return {
    ...actual,
    readHostedRuntimeAiAccessDecision: vi.fn(),
    readHostedRuntimeAiAllowedMemberIds: mocks.readAccessSet,
  };
});

vi.mock("@/src/lib/hosted-onboarding/phone", () => ({
  normalizePhoneNumber: (value: string | null | undefined) =>
    typeof value === "string" && value.trim() ? value.trim() : null,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in pending claim crypto tests.");
  }),
}));

import {
  claimHostedPendingGroupSetupForParticipantsTx,
  prepareHostedPendingGroupSetupForParticipants,
  type HostedPreparedPendingGroupSetupPackage,
  type PreparedHostedPendingGroupSetupClaim,
} from "@/src/lib/hosted-groups/pending-group-setup";

const occurredAt = new Date("2026-08-10T18:01:00.000Z");
const now = new Date("2026-08-10T18:02:00.000Z");
const row = {
  armedAt: new Date("2026-08-10T18:00:00.000Z"),
  expiresAt: new Date("2026-08-10T18:30:00.000Z"),
  id: "hpgs_exact",
  ownerMemberId: "member_owner",
  payloadEncrypted: "secure-box-exact",
  recipientPhoneLookupKey: "hplk_line",
};
const preparedClaim: PreparedHostedPendingGroupSetupClaim = {
  id: row.id,
  ownerMemberId: row.ownerMemberId,
  payloadEncrypted: row.payloadEncrypted,
  payloadRootKeyId: "root_exact",
  recipientPhoneLookupKey: row.recipientPhoneLookupKey,
};
const validPlaintext = JSON.stringify({
  schemaVersion: HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
  setup: { roomContextMarkdown: "Keep this room focused." },
});

function routingRecord(ownerMemberId = row.ownerMemberId) {
  return {
    linqRecipientPhoneEncrypted: "sealed:test-line",
    linqRecipientPhoneLookupKey: row.recipientPhoneLookupKey,
    memberId: ownerMemberId,
  };
}

function buildPreparedPackage(input: {
  failure?: unknown;
} = {}): HostedPreparedPendingGroupSetupPackage {
  return {
    candidateRows: [row],
    candidates: [{
      ...row,
      originalLineManaged: true,
      originalRecipientPhone: row.recipientPhoneLookupKey,
      originalRecipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
      recoveryAuthority: "none",
      routing: routingRecord(),
      runtimeAccessAllowed: true,
    }],
    incomingRecipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
    occurredAt,
    participantMemberIds: [row.ownerMemberId],
    recoveredRecipientPhoneLookupKey: row.recipientPhoneLookupKey,
    selected: {
      admissionKind: "incoming_line",
      candidateId: row.id,
      reason: "only_candidate",
    },
    selectedPayload: input.failure
      ? {
          candidateId: row.id,
          error: input.failure,
          kind: "failed",
          preparedClaim,
        }
      : {
          candidateId: row.id,
          kind: "ready",
          preparedClaim,
        },
    senderMemberId: row.ownerMemberId,
    threadId: "chat_group",
  };
}

function queryText(query: unknown): string {
  return query && typeof query === "object" && "strings" in query
    ? String((query as { strings: string[] }).strings.join(""))
    : String(query);
}

function buildClaimTx(input: {
  candidate?: typeof row;
  locked?: typeof row;
} = {}) {
  const candidate = input.candidate ?? row;
  const locked = input.locked ?? candidate;
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(async (query: unknown) =>
      queryText(query).includes("FOR UPDATE") ? [locked] : [candidate]
    ),
  };
}

async function claim(input: {
  participantMemberIds?: readonly string[];
  prepared?: HostedPreparedPendingGroupSetupPackage;
  tx?: ReturnType<typeof buildClaimTx>;
} = {}) {
  const tx = input.tx ?? buildClaimTx();
  const result = claimHostedPendingGroupSetupForParticipantsTx({
    incomingRecipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
    now,
    occurredAt,
    participantMemberIds: input.participantMemberIds ?? [row.ownerMemberId],
    ...(input.prepared ? { prepared: input.prepared } : {}),
    recipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
    recoveredRecipientPhoneLookupKey: row.recipientPhoneLookupKey,
    senderMemberId: row.ownerMemberId,
    threadId: "chat_group",
    tx: tx as never,
  });
  return { result, tx };
}

describe("pending group setup prepared payload claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAccessSet.mockImplementation(async (input: {
      memberIds: readonly string[];
    }) => new Set(input.memberIds));
    mocks.readManagedLineSet.mockResolvedValue(new Set([
      row.recipientPhoneLookupKey,
    ]));
    mocks.readRoutingRecords.mockImplementation(async (input: {
      memberIds: readonly string[];
    }) => input.memberIds.map((memberId) => routingRecord(memberId)));
    mocks.openRoutingRecords.mockImplementation(async (input: {
      records: Array<ReturnType<typeof routingRecord>>;
    }) => input.records.map((record) => ({
      ...record,
      linqRecipientPhone: row.recipientPhoneLookupKey,
    })));
    mocks.readRecoveryAuthorities.mockResolvedValue(new Map());
    mocks.readRootReference.mockReturnValue({
      domain: "control",
      rootKeyId: "root_exact",
    });
    mocks.getUnwrapCache.mockReturnValue(new Map([
      [`${row.ownerMemberId}|control|root_exact`, Promise.resolve(true)],
    ]));
    mocks.openFromPreparedRoot.mockResolvedValue(validPlaintext);
    mocks.unwrapRoots.mockResolvedValue([{
      domain: "control",
      envelope: {},
      rootKey: new Uint8Array([1, 2, 3, 4]),
      rootKeyId: "root_exact",
      userId: row.ownerMemberId,
    }]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["an unsupported schema", JSON.stringify({ schemaVersion: 999, setup: {} })],
    [
      "an invalid setup schema",
      JSON.stringify({
        schemaVersion: HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
        setup: { unexpected: true },
      }),
    ],
  ])("deletes authenticated plaintext containing %s", async (_description, plaintext) => {
    mocks.openFromPreparedRoot.mockResolvedValue(plaintext);
    const { result, tx } = await claim({ prepared: buildPreparedPackage() });

    await expect(result).resolves.toEqual({
      kind: "none",
      reason: "invalid_payload",
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it("preserves the row when secure-box authentication fails", async () => {
    const authenticationFailure = new Error("secure-box authentication failed");
    mocks.openFromPreparedRoot.mockRejectedValue(authenticationFailure);
    const { result, tx } = await claim({ prepared: buildPreparedPackage() });

    await expect(result).rejects.toBe(authenticationFailure);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("preserves the row when the locked secure-box envelope cannot be parsed", async () => {
    const envelopeFailure = new Error("secure-box envelope is malformed");
    mocks.readRootReference.mockImplementationOnce(() => {
      throw envelopeFailure;
    });
    const { result, tx } = await claim({ prepared: buildPreparedPackage() });

    await expect(result).rejects.toBe(envelopeFailure);
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("requires prepared state before inspecting production ciphertext", async () => {
    const { result, tx } = await claim();

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    expect(mocks.readRootReference).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("marks an exact failed preparation so the original failure can be preserved", async () => {
    const failure = new Error("kms unavailable");
    const { result, tx } = await claim({
      prepared: buildPreparedPackage({ failure }),
    });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: {
        preparationFailureMatched: true,
        preparationTarget: "pending_group_setup_payload",
      },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("does not attribute changed ciphertext to stale failed preparation", async () => {
    const changed = { ...row, payloadEncrypted: "secure-box-changed" };
    const { result, tx } = await claim({
      prepared: buildPreparedPackage({ failure: new Error("kms unavailable") }),
      tx: buildClaimTx({ locked: changed }),
    });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    await expect(result).rejects.not.toMatchObject({
      details: { preparationFailureMatched: true },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("requires the exact cached prepared root before decrypting", async () => {
    mocks.getUnwrapCache.mockReturnValue(new Map());
    const { result, tx } = await claim({ prepared: buildPreparedPackage() });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("does not use stale preparation after locked ciphertext changes", async () => {
    const changed = { ...row, payloadEncrypted: "secure-box-changed" };
    const { result, tx } = await claim({
      prepared: buildPreparedPackage(),
      tx: buildClaimTx({ locked: changed }),
    });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
    });
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("does not use stale preparation when a different candidate wins", async () => {
    const winner = {
      ...row,
      id: "hpgs_new_winner",
      ownerMemberId: "member_new_winner",
    };
    const { result, tx } = await claim({
      participantMemberIds: [row.ownerMemberId, winner.ownerMemberId],
      prepared: buildPreparedPackage(),
      tx: buildClaimTx({ candidate: winner, locked: winner }),
    });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
    });
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("decrypts only through the cache-only opener inside the claim", async () => {
    const { result, tx } = await claim({ prepared: buildPreparedPackage() });

    await expect(result).resolves.toMatchObject({
      kind: "claimed",
      setup: {
        id: row.id,
        setup: { roomContextMarkdown: "Keep this room focused." },
      },
    });
    expect(mocks.openFromPreparedRoot).toHaveBeenCalledExactlyOnceWith({
      aad: {
        field: "payload_encrypted",
        purpose: "pending-group-setup",
        rowId: row.id,
        table: "hosted_pending_group_setup",
      },
      lane: "hosted-member-private-field",
      preparedRootKeyId: "root_exact",
      scope: "hosted-pending-group-setup:payload:v1",
      userId: row.ownerMemberId,
      value: row.payloadEncrypted,
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns exact failed preparation without deleting on KMS failure", async () => {
    const kmsFailure = new Error("kms unavailable");
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([row]) };
    mocks.unwrapRoots.mockRejectedValue(kmsFailure);

    const prepared = await prepareHostedPendingGroupSetupForParticipants({
      incomingRecipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
      now,
      occurredAt,
      participantMemberIds: [row.ownerMemberId],
      prisma: prisma as never,
      recoveredRecipientPhoneLookupKey: row.recipientPhoneLookupKey,
      senderMemberId: row.ownerMemberId,
      threadId: "chat_group",
    });

    expect(prepared.selectedPayload).toEqual({
      candidateId: row.id,
      error: kmsFailure,
      kind: "failed",
      preparedClaim,
    });
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
  });

  it("returns preparation bound to exact row and wipes caller root copy", async () => {
    const rootKey = new Uint8Array([9, 8, 7, 6]);
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([row]) };
    mocks.unwrapRoots.mockResolvedValue([{
      domain: "control",
      envelope: {},
      rootKey,
      rootKeyId: "root_exact",
      userId: row.ownerMemberId,
    }]);

    const prepared = await prepareHostedPendingGroupSetupForParticipants({
      incomingRecipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
      now,
      occurredAt,
      participantMemberIds: [row.ownerMemberId],
      prisma: prisma as never,
      recoveredRecipientPhoneLookupKey: row.recipientPhoneLookupKey,
      senderMemberId: row.ownerMemberId,
      threadId: "chat_group",
    });

    expect(prepared.selectedPayload).toEqual({
      candidateId: row.id,
      kind: "ready",
      preparedClaim,
    });
    expect([...rootKey]).toEqual([0, 0, 0, 0]);
  });
});
