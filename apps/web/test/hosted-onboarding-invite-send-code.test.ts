import type { HostedMemberIdentity } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const codecMocks = vi.hoisted(() => ({
  readHostedMemberIdentityPhoneNumbers: vi.fn(),
}));

vi.mock("../src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/runtime")>(
    "../src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      ...actual.getHostedOnboardingEnvironment(),
      inviteTtlHours: 24,
      publicBaseUrl: "https://join.example.test",
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
    }),
    requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  };
});

vi.mock("../src/lib/hosted-onboarding/member-private-codecs", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-onboarding/member-private-codecs")
  >("../src/lib/hosted-onboarding/member-private-codecs");

  return {
    ...actual,
    readHostedMemberIdentityPhoneNumbers:
      codecMocks.readHostedMemberIdentityPhoneNumbers,
  };
});

import {
  areHostedDomainRootProviderCallsDisabled,
  getHostedDomainRootUnwrapCache,
} from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  abortHostedInvitePhoneCode,
  confirmHostedInvitePhoneCode,
  prepareHostedInvitePhoneCode,
} from "../src/lib/hosted-onboarding/invite-service";

const NOW = new Date("2026-04-07T01:00:00.000Z");

describe("invite send-code lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codecMocks.readHostedMemberIdentityPhoneNumbers.mockReset();
    codecMocks.readHostedMemberIdentityPhoneNumbers.mockResolvedValue({
      phoneNumber: null,
      signupPhoneNumber: "+15551234567",
    });
  });

  it("finishes delayed phone decryption before transaction entry and disables providers inside the transaction", async () => {
    const identity = makeIdentityRecord();
    const harness = makeInvitePrisma({ identity });
    const decryptStarted = deferred<void>();
    const releaseDecrypt = deferred<void>();

    codecMocks.readHostedMemberIdentityPhoneNumbers.mockImplementationOnce(async () => {
      expect(harness.isTransactionOpen()).toBe(false);
      decryptStarted.resolve(undefined);
      await releaseDecrypt.promise;
      expect(harness.isTransactionOpen()).toBe(false);
      return {
        phoneNumber: null,
        signupPhoneNumber: "+15551234567",
      };
    });

    const resultPromise = prepareHostedInvitePhoneCode({
      inviteCode: "invite-code",
      now: NOW,
      prisma: harness.prisma,
    });

    await decryptStarted.promise;
    expect(harness.transaction).not.toHaveBeenCalled();
    releaseDecrypt.resolve(undefined);

    await expect(resultPromise).resolves.toEqual({
      phoneHint: "*** 4567",
      phoneNumber: "+15551234567",
      sendAttemptId: expect.stringMatching(/^hbpc_/u),
    });
    expect(codecMocks.readHostedMemberIdentityPhoneNumbers).toHaveBeenCalledWith(
      identity,
      harness.prisma,
    );
    expect(harness.transactionProviderCallFences.length).toBeGreaterThan(0);
    expect(harness.transactionProviderCallFences.every(Boolean)).toBe(true);
    expect(harness.transactionUnwrapCacheScopes.every(Boolean)).toBe(true);
    expect(harness.rootInviteFindUnique).toHaveBeenCalledWith(inviteAuthorityQuery());
    expect(harness.txInviteFindUnique).toHaveBeenCalledWith(inviteAuthorityQuery());
    expect(harness.identityUpdate).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        signupPhoneCodeSendAttemptId: expect.stringMatching(/^hbpc_/u),
        signupPhoneCodeSendAttemptStartedAt: NOW,
      },
    });
  });

  it("falls back to the canonical stored phone after signup-only state has been cleared", async () => {
    const harness = makeInvitePrisma();
    codecMocks.readHostedMemberIdentityPhoneNumbers.mockResolvedValue({
      phoneNumber: "+15557654321",
      signupPhoneNumber: null,
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: NOW,
        prisma: harness.prisma,
      }),
    ).resolves.toEqual({
      phoneHint: "*** 4567",
      phoneNumber: "+15557654321",
      sendAttemptId: expect.stringMatching(/^hbpc_/u),
    });
  });

  it("preserves the manual-entry error after exact raw identity revalidation", async () => {
    const harness = makeInvitePrisma();
    codecMocks.readHostedMemberIdentityPhoneNumbers.mockResolvedValue({
      phoneNumber: null,
      signupPhoneNumber: null,
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: NOW,
        prisma: harness.prisma,
      }),
    ).rejects.toMatchObject({
      code: "SIGNUP_PHONE_UNAVAILABLE",
      httpStatus: 409,
    });
    expect(harness.identityUpdate).not.toHaveBeenCalled();
  });

  it("rate limits repeated invite send-code requests while an attempt is in flight", async () => {
    const identity = makeIdentityRecord({
      signupPhoneCodeSendAttemptId: "hbpc_in_flight",
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:30.000Z"),
    });
    const harness = makeInvitePrisma({ identity });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:45.000Z"),
        prisma: harness.prisma,
      }),
    ).rejects.toMatchObject({
      code: "PHONE_CODE_COOLDOWN",
      httpStatus: 429,
    });
    expect(harness.identityUpdate).not.toHaveBeenCalled();
  });

  it("rejects persistent exact raw-row drift after one fresh preparation", async () => {
    const preparedFirst = makeIdentityRecord();
    const currentFirst = makeIdentityRecord({
      updatedAt: new Date("2026-04-07T01:00:01.000Z"),
      walletAddressEncrypted: "ciphertext-wallet-v2",
    });
    const currentSecond = makeIdentityRecord({
      updatedAt: new Date("2026-04-07T01:00:02.000Z"),
      walletAddressEncrypted: "ciphertext-wallet-v3",
    });
    const harness = makeInvitePrisma({
      preparedIdentityRecords: [preparedFirst, currentFirst],
      transactionIdentityRecords: [currentFirst, currentSecond],
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: NOW,
        prisma: harness.prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_DOMAIN_ROOT_PREPARATION_MISMATCH",
    });
    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(codecMocks.readHostedMemberIdentityPhoneNumbers).toHaveBeenCalledTimes(2);
    expect(harness.identityUpdate).not.toHaveBeenCalled();
  });

  it("rejects a concurrent send replay through the existing cooldown after fresh preparation", async () => {
    const prepared = makeIdentityRecord();
    const replayWinner = makeIdentityRecord({
      signupPhoneCodeSendAttemptId: "hbpc_replay_winner",
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:30.000Z"),
      updatedAt: new Date("2026-04-07T01:00:30.000Z"),
    });
    const harness = makeInvitePrisma({
      preparedIdentityRecords: [prepared, replayWinner],
      transactionIdentityRecords: [replayWinner, replayWinner],
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:45.000Z"),
        prisma: harness.prisma,
      }),
    ).rejects.toMatchObject({
      code: "PHONE_CODE_COOLDOWN",
      httpStatus: 429,
    });
    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(harness.identityUpdate).not.toHaveBeenCalled();
  });

  it("confirms through a scalar-only attempt read with providers disabled", async () => {
    const harness = makeInvitePrisma({
      signupPhoneCodeSendAttemptIds: ["hbpc_confirm"],
    });

    await expect(
      confirmHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:02.000Z"),
        prisma: harness.prisma,
        sendAttemptId: "hbpc_confirm",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(harness.rootIdentityFindUnique).not.toHaveBeenCalled();
    expect(codecMocks.readHostedMemberIdentityPhoneNumbers).not.toHaveBeenCalled();
    expect(harness.txInviteFindUnique).toHaveBeenCalledWith(inviteAuthorityQuery());
    expect(harness.txIdentityFindUnique).toHaveBeenCalledTimes(1);
    expect(harness.txIdentityFindUnique).toHaveBeenCalledWith(attemptIdQuery());
    expect(harness.transactionProviderCallFences.every(Boolean)).toBe(true);
    expect(harness.transactionUnwrapCacheScopes.every(Boolean)).toBe(true);
    expect(harness.identityUpdate).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: new Date("2026-04-07T01:00:02.000Z"),
      },
    });
  });

  it("aborts the current attempt through the same scalar-only provider-disabled boundary", async () => {
    const harness = makeInvitePrisma({
      signupPhoneCodeSendAttemptIds: ["hbpc_abort"],
    });

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:05.000Z"),
        prisma: harness.prisma,
        sendAttemptId: "hbpc_abort",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(harness.rootIdentityFindUnique).not.toHaveBeenCalled();
    expect(codecMocks.readHostedMemberIdentityPhoneNumbers).not.toHaveBeenCalled();
    expect(harness.txInviteFindUnique).toHaveBeenCalledWith(inviteAuthorityQuery());
    expect(harness.txIdentityFindUnique).toHaveBeenCalledTimes(1);
    expect(harness.txIdentityFindUnique).toHaveBeenCalledWith(attemptIdQuery());
    expect(harness.transactionProviderCallFences.every(Boolean)).toBe(true);
    expect(harness.transactionUnwrapCacheScopes.every(Boolean)).toBe(true);
    expect(harness.identityUpdate).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: new Date("2026-04-07T01:00:05.000Z"),
      },
    });
  });

  it("aborts through a scalar-only attempt read without clearing a later attempt", async () => {
    const harness = makeInvitePrisma({
      signupPhoneCodeSendAttemptIds: ["hbpc_current"],
    });

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:01:00.000Z"),
        prisma: harness.prisma,
        sendAttemptId: "hbpc_old",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(harness.rootIdentityFindUnique).not.toHaveBeenCalled();
    expect(codecMocks.readHostedMemberIdentityPhoneNumbers).not.toHaveBeenCalled();
    expect(harness.txInviteFindUnique).toHaveBeenCalledWith(inviteAuthorityQuery());
    expect(harness.txIdentityFindUnique).toHaveBeenCalledTimes(1);
    expect(harness.txIdentityFindUnique).toHaveBeenCalledWith(attemptIdQuery());
    expect(harness.transactionProviderCallFences.every(Boolean)).toBe(true);
    expect(harness.transactionUnwrapCacheScopes.every(Boolean)).toBe(true);
    expect(harness.identityUpdate).not.toHaveBeenCalled();
  });
});

function makeInvitePrisma(input: {
  identity?: HostedMemberIdentity;
  preparedIdentityRecords?: readonly HostedMemberIdentity[];
  signupPhoneCodeSendAttemptIds?: readonly (string | null)[];
  transactionIdentityRecords?: readonly HostedMemberIdentity[];
} = {}) {
  const identity = input.identity ?? makeIdentityRecord();
  const preparedIdentityRecords = [...(input.preparedIdentityRecords ?? [identity])];
  const transactionIdentityRecords = [
    ...(input.transactionIdentityRecords ?? [identity]),
  ];
  const signupPhoneCodeSendAttemptIds = [
    ...(input.signupPhoneCodeSendAttemptIds
      ?? [identity.signupPhoneCodeSendAttemptId]),
  ];
  let transactionOpen = false;
  const transactionProviderCallFences: boolean[] = [];
  const transactionUnwrapCacheScopes: boolean[] = [];
  const recordTransactionCryptoBoundary = () => {
    transactionProviderCallFences.push(areHostedDomainRootProviderCallsDisabled());
    transactionUnwrapCacheScopes.push(Boolean(getHostedDomainRootUnwrapCache()));
  };
  const rootInviteFindUnique = vi.fn().mockResolvedValue(inviteAuthority());
  const txInviteFindUnique = vi.fn().mockImplementation(async () => {
    recordTransactionCryptoBoundary();
    return inviteAuthority();
  });
  const rootIdentityFindUnique = vi.fn().mockImplementation(async () =>
    readSequence(preparedIdentityRecords)
  );
  const txIdentityFindUnique = vi.fn().mockImplementation(async (query: {
    select?: { signupPhoneCodeSendAttemptId?: boolean };
  }) => {
    recordTransactionCryptoBoundary();
    if (query.select?.signupPhoneCodeSendAttemptId) {
      return {
        signupPhoneCodeSendAttemptId: readSequence(signupPhoneCodeSendAttemptIds),
      };
    }
    return readSequence(transactionIdentityRecords);
  });
  const identityUpdate = vi.fn().mockImplementation(async () => {
    recordTransactionCryptoBoundary();
    return {};
  });
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async () => {
      recordTransactionCryptoBoundary();
      return [];
    }),
    hostedInvite: {
      findUnique: txInviteFindUnique,
    },
    hostedMemberIdentity: {
      findUnique: txIdentityFindUnique,
      update: identityUpdate,
    },
  };
  const transaction = vi.fn(async (
    callback: (innerTx: typeof tx) => Promise<unknown>,
  ) => {
    transactionOpen = true;
    try {
      return await callback(tx);
    } finally {
      transactionOpen = false;
    }
  });
  const prisma = {
    $transaction: transaction,
    hostedInvite: {
      findUnique: rootInviteFindUnique,
    },
    hostedMemberIdentity: {
      findUnique: rootIdentityFindUnique,
    },
  } as never;

  return {
    identityUpdate,
    isTransactionOpen: () => transactionOpen,
    prisma,
    rootIdentityFindUnique,
    rootInviteFindUnique,
    transaction,
    transactionProviderCallFences,
    transactionUnwrapCacheScopes,
    txIdentityFindUnique,
    txInviteFindUnique,
  };
}

function readSequence<T>(values: T[]): T {
  const value = values.length > 1 ? values.shift() : values[0];
  if (value === undefined) {
    throw new Error("Test sequence is empty.");
  }
  return value;
}

function makeIdentityRecord(
  overrides: Partial<HostedMemberIdentity> = {},
): HostedMemberIdentity {
  return {
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    linqEmailHandleLookupKey: null,
    maskedPhoneNumberHint: "*** 4567",
    memberId: "member_123",
    phoneLookupKey: "hbidx:phone:v1:abc123",
    phoneNumberEncrypted: null,
    phoneNumberVerifiedAt: null,
    privyUserIdEncrypted: null,
    privyUserLookupKey: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumberEncrypted: "ciphertext-signup-phone",
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    walletAddressEncrypted: null,
    walletAddressLookupKey: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

function inviteAuthority() {
  return {
    expiresAt: new Date("2026-04-08T00:00:00.000Z"),
    memberId: "member_123",
  };
}

function inviteAuthorityQuery() {
  return {
    where: {
      inviteCode: "invite-code",
    },
    select: {
      expiresAt: true,
      memberId: true,
    },
  };
}

function attemptIdQuery() {
  return {
    where: {
      memberId: "member_123",
    },
    select: {
      signupPhoneCodeSendAttemptId: true,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve,
  };
}
