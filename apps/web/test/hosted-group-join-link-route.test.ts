import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedGroupJoinLinkForOwnedThreadContainerTx: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  createHostedGroupJoinLinkForOwnedThreadContainerTx:
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx,
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

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

let route: typeof import("../app/api/groups/thread-containers/[containerMemberId]/join-link/route");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_owner", suspendedAt: null },
  });
  mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://join.example.test");
  const tx = { tx: true };
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  });
  mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValue({
    group: {
      displayName: "Sunday sleep crew",
      id: "group_1",
      kind: "friends",
      memberCount: 1,
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      status: "active",
    },
    joinCode: "JOIN123",
  });

  route = await import("../app/api/groups/thread-containers/[containerMemberId]/join-link/route");
});

test("creates a hosted group join link through the signed-in owner app session", async () => {
  const request = new Request(
    "https://join.example.test/api/groups/thread-containers/member_group_runtime/join-link",
    {
      body: JSON.stringify({
        displayName: " Sunday sleep crew ",
        kind: "friends",
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    },
  );

  const response = await route.POST(request, {
    params: Promise.resolve({ containerMemberId: "member_group_runtime" }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    group: {
      displayName: "Sunday sleep crew",
      id: "group_1",
      kind: "friends",
      memberCount: 1,
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      status: "active",
    },
    joinUrl: "https://join.example.test/groups/join/JOIN123",
    ok: true,
  });
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
  expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
  expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith({
    actorMemberId: "member_owner",
    containerMemberId: "member_group_runtime",
    displayName: "Sunday sleep crew",
    kind: "friends",
    now: expect.any(Date),
    requestedVaultShareProjectionKinds: ["sleep-times.v0"],
    tx: { tx: true },
  });
});
