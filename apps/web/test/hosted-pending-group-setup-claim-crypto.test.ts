import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
} from "@murphai/hosted-execution/pending-group-setup";

const mocks = vi.hoisted(() => ({
  getUnwrapCache: vi.fn(),
  hasActiveManagedLine: vi.fn(),
  isTestCodecConfigured: vi.fn(),
  openFromPreparedRoot: vi.fn(),
  openProviderCapable: vi.fn(),
  readAccess: vi.fn(),
  readRootReference: vi.fn(),
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
  isHostedSecureBoxStringTestCodecConfiguredForTests:
    mocks.isTestCodecConfigured,
  openHostedUserSecureBoxString: mocks.openProviderCapable,
  openHostedUserSecureBoxStringFromPreparedRoot:
    mocks.openFromPreparedRoot,
  readHostedUserSecureBoxStringRootReference: mocks.readRootReference,
  sealHostedUserSecureBoxString: mocks.seal,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-line-store")
  >();
  return {
    ...actual,
    hasActiveHostedLinqManagedLine: mocks.hasActiveManagedLine,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >();
  return {
    ...actual,
    readHostedRuntimeAiAccessDecision: mocks.readAccess,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in pending claim crypto tests.");
  }),
}));

import {
  claimHostedPendingGroupSetupForParticipantsTx,
  prepareHostedPendingGroupSetupClaimForParticipants,
  readHostedPendingGroupSetupPreparationFailure,
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

function buildClaimTx(input: {
  candidate?: typeof row;
  locked?: typeof row;
} = {}) {
  const candidate = input.candidate ?? row;
  const locked = input.locked ?? candidate;
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([locked]),
  };
}

async function claim(input: {
  failedPrepared?: PreparedHostedPendingGroupSetupClaim;
  participantMemberIds?: readonly string[];
  prepared?: PreparedHostedPendingGroupSetupClaim;
  tx?: ReturnType<typeof buildClaimTx>;
} = {}) {
  const tx = input.tx ?? buildClaimTx();
  const result = claimHostedPendingGroupSetupForParticipantsTx({
    now,
    occurredAt,
    ...(input.failedPrepared
      ? { failedPreparedClaim: input.failedPrepared }
      : {}),
    participantMemberIds: input.participantMemberIds ?? [row.ownerMemberId],
    ...(input.prepared ? { preparedClaim: input.prepared } : {}),
    recipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
    senderMemberId: row.ownerMemberId,
    tx: tx as never,
  });
  return { result, tx };
}

describe("pending group setup prepared payload claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasActiveManagedLine.mockResolvedValue(true);
    mocks.isTestCodecConfigured.mockReturnValue(false);
    mocks.readAccess.mockResolvedValue({ allowed: true });
    mocks.readRootReference.mockReturnValue({
      domain: "control",
      rootKeyId: "root_exact",
    });
    mocks.getUnwrapCache.mockReturnValue(new Map([
      [
        `${row.ownerMemberId}|control|root_exact`,
        Promise.resolve({
          envelope: {
            domain: "control",
            rootKeyId: "root_exact",
            userId: row.ownerMemberId,
          },
          rootKey: new Uint8Array([1, 2, 3, 4]),
        }),
      ],
    ]));
    mocks.openFromPreparedRoot.mockResolvedValue(validPlaintext);
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "an unsupported schema",
      JSON.stringify({ schemaVersion: 999, setup: {} }),
    ],
    [
      "an invalid setup schema",
      JSON.stringify({
        schemaVersion: HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
        setup: { unexpected: true },
      }),
    ],
  ])("deletes authenticated plaintext containing %s", async (_description, plaintext) => {
    mocks.openFromPreparedRoot.mockResolvedValue(plaintext);
    const { result, tx } = await claim({ prepared: preparedClaim });

    await expect(result).resolves.toEqual({
      kind: "none",
      reason: "invalid_payload",
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
  });

  it("preserves the row when secure-box authentication fails", async () => {
    const authenticationFailure = new Error("secure-box authentication failed");
    mocks.openFromPreparedRoot.mockRejectedValue(authenticationFailure);
    const { result, tx } = await claim({ prepared: preparedClaim });

    await expect(result).rejects.toBe(authenticationFailure);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
  });

  it("preserves the row when the locked secure-box envelope cannot be parsed", async () => {
    const envelopeFailure = new Error("secure-box envelope is malformed");
    mocks.readRootReference.mockImplementationOnce(() => {
      throw envelopeFailure;
    });
    const { result, tx } = await claim({ prepared: preparedClaim });

    await expect(result).rejects.toBe(envelopeFailure);
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("requires prepared state before inspecting production ciphertext", async () => {
    const { result, tx } = await claim();

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    expect(mocks.readRootReference).not.toHaveBeenCalled();
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("marks an exact failed preparation so the original failure can be preserved", async () => {
    const { result, tx } = await claim({ failedPrepared: preparedClaim });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: {
        preparationFailureMatched: true,
        preparationTarget: "pending_group_setup_payload",
      },
    });
    expect(mocks.readRootReference).not.toHaveBeenCalled();
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("does not attribute a changed ciphertext to a stale failed preparation", async () => {
    const changed = { ...row, payloadEncrypted: "secure-box-changed" };
    const tx = buildClaimTx({ locked: changed });
    const { result } = await claim({
      failedPrepared: preparedClaim,
      tx,
    });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    await expect(result).rejects.not.toMatchObject({
      details: { preparationFailureMatched: true },
    });
    expect(mocks.readRootReference).not.toHaveBeenCalled();
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("requires the exact cached prepared root before decrypting", async () => {
    mocks.getUnwrapCache.mockReturnValue(new Map());
    const { result, tx } = await claim({ prepared: preparedClaim });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("does not use stale preparation after the locked ciphertext changes", async () => {
    const changed = { ...row, payloadEncrypted: "secure-box-changed" };
    const tx = buildClaimTx({ locked: changed });
    const { result } = await claim({ prepared: preparedClaim, tx });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    expect(mocks.readRootReference).not.toHaveBeenCalled();
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("does not use stale preparation when a different candidate wins", async () => {
    const winner = {
      ...row,
      id: "hpgs_new_winner",
      ownerMemberId: "member_new_winner",
    };
    const tx = buildClaimTx({ candidate: winner, locked: winner });
    const { result } = await claim({
      participantMemberIds: [row.ownerMemberId, winner.ownerMemberId],
      prepared: preparedClaim,
      tx,
    });

    await expect(result).rejects.toMatchObject({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      details: { preparationTarget: "pending_group_setup_payload" },
    });
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("decrypts only through the cache-only opener inside the claim", async () => {
    const { result, tx } = await claim({ prepared: preparedClaim });

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
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("prewarms the exact candidate root and preserves a KMS failure", async () => {
    const kmsFailure = new Error("kms unavailable");
    const prisma = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([row]),
    };
    mocks.unwrapRoots.mockRejectedValue(kmsFailure);

    let preparationError: unknown;
    try {
      await prepareHostedPendingGroupSetupClaimForParticipants({
        now,
        occurredAt,
        participantMemberIds: [row.ownerMemberId],
        prisma: prisma as never,
        recipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
        senderMemberId: row.ownerMemberId,
      });
    } catch (error) {
      preparationError = error;
    }
    expect(readHostedPendingGroupSetupPreparationFailure(preparationError))
      .toEqual({
        error: kmsFailure,
        preparedClaim,
      });

    expect(mocks.unwrapRoots).toHaveBeenCalledExactlyOnceWith({
      prisma,
      references: [{
        domain: "control",
        rootKeyId: "root_exact",
        userId: row.ownerMemberId,
      }],
      retainFailureInScopedCache: true,
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.openFromPreparedRoot).not.toHaveBeenCalled();
    expect(mocks.openProviderCapable).not.toHaveBeenCalled();
  });

  it("returns preparation bound to the exact row and wipes the caller root copy", async () => {
    const rootKey = new Uint8Array([9, 8, 7, 6]);
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([row]),
    };
    mocks.unwrapRoots.mockResolvedValue([{
      domain: "control",
      envelope: {
        domain: "control",
        rootKeyId: "root_exact",
        userId: row.ownerMemberId,
      },
      rootKey,
      rootKeyId: "root_exact",
      userId: row.ownerMemberId,
    }]);

    await expect(prepareHostedPendingGroupSetupClaimForParticipants({
      now,
      occurredAt,
      participantMemberIds: [row.ownerMemberId],
      prisma: prisma as never,
      recipientPhoneLookupKeys: [row.recipientPhoneLookupKey],
      senderMemberId: row.ownerMemberId,
    })).resolves.toEqual(preparedClaim);
    expect([...rootKey]).toEqual([0, 0, 0, 0]);
  });
});
