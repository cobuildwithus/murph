import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    hostedGroupMember: {
      upsert: vi.fn(async () => ({})),
    },
  };
  return {
    checkpointHostedWorkspace: vi.fn(),
    disconnect: vi.fn(async () => {}),
    ensureHostedGroupForThreadContainerTx: vi.fn(async () => {
      process.env.HOSTED_CRYPTO_ENV = "conflicting-environment";
      return { id: "group_test" };
    }),
    ensureHostedWorkspace: vi.fn(),
    findActiveHostedVaultShares: vi.fn(),
    findWorkspace: vi.fn(async () => ({ version: 1n })),
    grantHostedVaultShareTx: vi.fn(async () => {}),
    observedAuthorizationCryptoEnvironments: [] as Array<string | undefined>,
    publishLatestBrowserVaultReplicaRef: vi.fn(),
    replaceHostedVaultShareProjectionSnapshot: vi.fn(),
    syncHostedMemberVerifiedEmailAuthorization: vi.fn(async () => {
      mocks.observedAuthorizationCryptoEnvironments.push(
        process.env.HOSTED_CRYPTO_ENV,
      );
    }),
    transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      await callback(tx)),
    tx,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  createPrismaClient: vi.fn(() => ({
    $disconnect: mocks.disconnect,
    $transaction: mocks.transaction,
    hostedWorkspace: {
      findUnique: mocks.findWorkspace,
    },
  })),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  advanceHostedMailboxConsumedSeqByLane: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  checkpointHostedWorkspace: mocks.checkpointHostedWorkspace,
  ensureHostedWorkspace: mocks.ensureHostedWorkspace,
  publishLatestBrowserVaultReplicaRef: mocks.publishLatestBrowserVaultReplicaRef,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  ensureHostedGroupForThreadContainerTx:
    mocks.ensureHostedGroupForThreadContainerTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  syncHostedMemberVerifiedEmailAuthorization:
    mocks.syncHostedMemberVerifiedEmailAuthorization,
}));

vi.mock("@/src/lib/hosted-vault-share/share-grant-store", () => ({
  grantHostedVaultShareTx: mocks.grantHostedVaultShareTx,
}));

vi.mock("@/src/lib/hosted-vault-share/projection-store", () => ({
  findActiveHostedVaultShares: mocks.findActiveHostedVaultShares,
  replaceHostedVaultShareProjectionSnapshot:
    mocks.replaceHostedVaultShareProjectionSnapshot,
}));

import { seedHostedGroupEmailAuthorizationForTest } from "./support/hosted-web-testkit";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.observedAuthorizationCryptoEnvironments.length = 0;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnvironment);
});

describe("seedHostedGroupEmailAuthorizationForTest", () => {
  it("restores the scenario crypto environment immediately before authorization", async () => {
    await seedHostedGroupEmailAuthorizationForTest({
      environment: {
        ...process.env,
        HOSTED_CRYPTO_ENV: "scenario-owned-environment",
      },
      participants: [{
        memberId: "member_test_participant",
        verifiedEmail: "participant@example.test",
      }],
      projectionScopes: [],
      runtimeMemberId: "member_test_runtime",
    });

    expect(mocks.ensureHostedGroupForThreadContainerTx).toHaveBeenCalledOnce();
    expect(mocks.syncHostedMemberVerifiedEmailAuthorization).toHaveBeenCalledOnce();
    expect(mocks.observedAuthorizationCryptoEnvironments).toEqual([
      "scenario-owned-environment",
    ]);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
