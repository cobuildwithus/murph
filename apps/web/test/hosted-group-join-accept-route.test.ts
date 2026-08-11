import { beforeEach, expect, test, vi } from "vitest";

import {
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
} from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({
  acceptHostedGroupJoinCodeTx: vi.fn(),
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  requireHostedInviteForAuthentication: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  signalHostedGroupJoinConfirmationRuntimeBestEffort: vi.fn(),
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  acceptHostedGroupJoinCodeTx: mocks.acceptHostedGroupJoinCodeTx,
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
  signalHostedGroupJoinConfirmationRuntimeBestEffort:
    mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort,
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

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  requireHostedInviteForAuthentication:
    mocks.requireHostedInviteForAuthentication,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeMaintenanceRuntime: mocks.signalHostedRuntimeMaintenanceRuntime,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
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
  mocks.requireHostedInviteForAuthentication.mockResolvedValue({
    memberId: "member_grantor",
  });
  mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://murph.example");
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
  });
  mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort.mockResolvedValue(undefined);
  mocks.signalHostedRuntimeMaintenanceRuntime.mockResolvedValue(undefined);
  mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(undefined);

  route = await import("../app/api/groups/join/[joinCode]/accept/route");
});

test("requires a phone-bound group link to match the authenticated member", async () => {
  mocks.requireHostedInviteForAuthentication.mockResolvedValueOnce({
    memberId: "member_other",
  });
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      expectedMembershipId: null,
      inviteCode: "invite_phone_bound",
      selectedVaultShareProjectionScopes: [],
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

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "AUTH_INVITE_MISMATCH" },
  });
  expect(mocks.requireHostedInviteForAuthentication).toHaveBeenCalledWith(
    "invite_phone_bound",
    { tx: true },
    expect.any(Date),
  );
  expect(mocks.acceptHostedGroupJoinCodeTx).not.toHaveBeenCalled();
});

test("accepts a phone-bound group link for its authenticated member", async () => {
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      expectedMembershipId: null,
      inviteCode: "invite_phone_bound",
      selectedVaultShareProjectionScopes: [],
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
  expect(mocks.requireHostedInviteForAuthentication).toHaveBeenCalledWith(
    "invite_phone_bound",
    { tx: true },
    expect.any(Date),
  );
  expect(mocks.acceptHostedGroupJoinCodeTx).toHaveBeenCalledTimes(1);
});

test("returns a group permission revocation without exposing internal metadata", async () => {
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      expectedMembershipId: "membership_existing",
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
    confirmationPublicBaseUrl: "https://murph.example",
    expectedMembershipId: "membership_existing",
    joinCode: "JOIN123",
    memberId: "member_grantor",
    now: expect.any(Date),
    selectedVaultShareProjectionScopes: [],
    tx: { tx: true },
  });
  expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
});

test("signals a first-join confirmation without exposing mailbox metadata", async () => {
  mocks.acceptHostedGroupJoinCodeTx.mockResolvedValueOnce({
    alreadyMember: false,
    grantedVaultShareProjectionKinds: ["profile-name.v0"],
    groupId: "group_1",
    joinConfirmationSignal: {
      mailboxItemId: "mailbox_item_join_confirmation_1",
      memberId: "member_grantor",
    },
    membershipId: "membership_created",
    revokedVaultShareProjectionKinds: [],
  });
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      expectedMembershipId: null,
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
    alreadyMember: false,
    grantedVaultShareProjectionKinds: ["profile-name.v0"],
    groupId: "group_1",
    membershipId: "membership_created",
    ok: true,
    revokedVaultShareProjectionKinds: [],
  });
  expect(mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort).toHaveBeenCalledWith({
    mailboxItemId: "mailbox_item_join_confirmation_1",
    memberId: "member_grantor",
    prisma: expect.any(Object),
    signal: request.signal,
    timeoutMs: expect.any(Number),
  });
  expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
    memberId: "member_grantor",
    membershipId: "membership_created",
    prisma: expect.any(Object),
    signal: request.signal,
    timeoutMs: expect.any(Number),
  });
});

test("starts a bounded projection wake without blocking confirmation recovery", async () => {
  vi.useFakeTimers();
  try {
    mocks.acceptHostedGroupJoinCodeTx.mockResolvedValueOnce({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      groupId: "group_1",
      membershipId: "membership_created",
      revokedVaultShareProjectionKinds: [],
    });
    mocks.signalHostedRuntimeMaintenanceRuntime.mockReturnValueOnce(new Promise(() => {}));
    const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
      body: JSON.stringify({
        expectedMembershipId: null,
        selectedVaultShareProjectionKinds: [],
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const responsePromise = route.POST(request, {
      params: Promise.resolve({ joinCode: "JOIN123" }),
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    expect(
      mocks.signalHostedRuntimeMaintenanceRuntime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
    );
    expect(
      mocks.signalHostedRuntimeMaintenanceRuntime.mock.calls[0]?.[0]?.abortSignal,
    ).not.toBe(request.signal);
  } finally {
    vi.useRealTimers();
  }
});

test("accepts an email-sharing grant without a private mailbox lifecycle", async () => {
  mocks.acceptHostedGroupJoinCodeTx.mockResolvedValueOnce({
    alreadyMember: false,
    grantedVaultShareProjectionKinds: ["profile-name.v0", "group-email.v0"],
    groupId: "group_1",
    membershipId: "membership_created",
    revokedVaultShareProjectionKinds: [],
  });
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      expectedMembershipId: null,
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
});

test("accepts the full closed set of selectable vault-share permissions", async () => {
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({
      expectedMembershipId: null,
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
    confirmationPublicBaseUrl: "https://murph.example",
    expectedMembershipId: null,
    joinCode: "JOIN123",
    memberId: "member_grantor",
    now: expect.any(Date),
    selectedVaultShareProjectionScopes: HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
    tx: { tx: true },
  });
});

test("rejects an unversioned join-page save before opening a transaction", async () => {
  const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
    body: JSON.stringify({ selectedVaultShareProjectionKinds: [] }),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });

  const response = await route.POST(request, {
    params: Promise.resolve({ joinCode: "JOIN123" }),
  });

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_GROUP_MEMBERSHIP_CHANGED" },
  });
  expect(mocks.getPrisma).not.toHaveBeenCalled();
  expect(mocks.acceptHostedGroupJoinCodeTx).not.toHaveBeenCalled();
});

test.each(["", "   ", 42, false])(
  "rejects malformed expected membership id %j",
  async (expectedMembershipId) => {
    const request = new Request("https://join.example.test/api/groups/join/JOIN123/accept", {
      body: JSON.stringify({
        expectedMembershipId,
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_GROUP_MEMBERSHIP_ID_INVALID" },
    });
    expect(mocks.acceptHostedGroupJoinCodeTx).not.toHaveBeenCalled();
  },
);
