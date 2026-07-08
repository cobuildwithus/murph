import { beforeEach, expect, test, vi } from "vitest";

import {
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
} from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({
  acceptHostedGroupJoinCodeTx: vi.fn(),
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-newsletter", () => ({
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort:
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  acceptHostedGroupJoinCodeTx: mocks.acceptHostedGroupJoinCodeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime: mocks.signalHostedRuntimeMaintenanceRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

let route: typeof import("../app/api/groups/join/[joinCode]/accept/route");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_grantor", suspendedAt: null },
  });
  const tx = { tx: true };
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  });
  mocks.acceptHostedGroupJoinCodeTx.mockResolvedValue({
    alreadyMember: true,
    grantedVaultShareProjectionKinds: [],
    groupId: "group_1",
    membershipId: "membership_existing",
    revokedVaultShareProjectionKinds: ["sleep-times.v0"],
    vaultShareCleanupSignals: [{
      mailboxItemId: "mailbox_item_revoke_1",
      memberId: "member_group_runtime",
    }],
  });
  mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort.mockResolvedValue(
    undefined,
  );
  mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  mocks.signalHostedRuntimeMaintenanceRuntime.mockResolvedValue(undefined);

  route = await import("../app/api/groups/join/[joinCode]/accept/route");
});

test("signals destination cleanup wakes after a group permission revoke without exposing mailbox ids", async () => {
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      selectedVaultShareProjectionKinds: [],
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });

  const response = await route.POST(request, {
    params: Promise.resolve({ joinCode: "JOIN123" }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    alreadyMember: true,
    grantedVaultShareProjectionKinds: [],
    groupId: "group_1",
    membershipId: "membership_existing",
    ok: true,
    revokedVaultShareProjectionKinds: ["sleep-times.v0"],
  });
  expect(mocks.acceptHostedGroupJoinCodeTx).toHaveBeenCalledWith({
    joinCode: "JOIN123",
    memberId: "member_grantor",
    now: expect.any(Date),
    selectedVaultShareProjectionScopes: [],
    tx: { tx: true },
  });
  expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
    .not.toHaveBeenCalled();
  expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
    expectedUserId: "member_group_runtime",
    mailboxItemId: "mailbox_item_revoke_1",
  });
});

test("enqueues a private missing-email nudge after accepting an email-sharing grant", async () => {
  mocks.acceptHostedGroupJoinCodeTx.mockResolvedValueOnce({
    alreadyMember: false,
    grantedVaultShareProjectionKinds: ["profile-name.v0", "group-email.v0"],
    groupId: "group_1",
    membershipId: "membership_created",
    revokedVaultShareProjectionKinds: [],
    vaultShareCleanupSignals: [],
  });
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      selectedVaultShareProjectionKinds: ["group-email.v0"],
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });

  const response = await route.POST(request, {
    params: Promise.resolve({ joinCode: "JOIN123" }),
  });

  expect(response.status).toBe(200);
  expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
    .toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_grantor",
      prisma: expect.any(Object),
    });
});

test("accepts the full closed set of selectable vault-share permissions", async () => {
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      selectedVaultShareProjectionScopes: HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });

  const response = await route.POST(request, {
    params: Promise.resolve({ joinCode: "JOIN123" }),
  });

  expect(response.status).toBe(200);
  expect(mocks.acceptHostedGroupJoinCodeTx).toHaveBeenCalledWith({
    joinCode: "JOIN123",
    memberId: "member_grantor",
    now: expect.any(Date),
    selectedVaultShareProjectionScopes: HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
    tx: { tx: true },
  });
});
