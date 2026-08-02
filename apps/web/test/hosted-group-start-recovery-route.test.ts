import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  openHostedLinqGroupEmailRecoveryToken: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
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
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx:
    mocks.upsertHostedMemberPendingLinqBindingTx,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-group-setup", () => ({
  openHostedLinqGroupEmailRecoveryToken:
    mocks.openHostedLinqGroupEmailRecoveryToken,
}));
vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));
vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

let route: typeof import("../app/api/groups/start/recover/route");
const tx = { tx: true };
const recovery = {
  chatId: "chat_group_123",
  observedAt: new Date("2026-07-31T04:00:00.000Z"),
  participantContact: {
    kind: "email" as const,
    lookupKey: "contact_lookup_key",
    value: "person@icloud.com",
  },
  recipientPhone: "+15550000000",
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_existing", suspendedAt: null },
  });
  mocks.openHostedLinqGroupEmailRecoveryToken.mockReturnValue(recovery);
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
  mocks.acquireHostedLinqChatOwnershipLockTx.mockResolvedValue(undefined);
  mocks.upsertHostedMemberPendingLinqBindingTx.mockResolvedValue(undefined);
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
  });
  route = await import("../app/api/groups/start/recover/route");
});

function buildRequest(token = "sealed_recovery_token") {
  return new Request("https://murph.example/api/groups/start/recover", {
    body: JSON.stringify({ token }),
    headers: {
      "content-type": "application/json",
      origin: "https://murph.example",
    },
    method: "POST",
  });
}

test("records one exact temporary sender bridge without creating a group", async () => {
  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.acquireHostedLinqChatOwnershipLockTx).toHaveBeenCalledWith({
    chatId: recovery.chatId,
    tx,
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledWith({
    homeLineAssignedAt: null,
    linqChatId: recovery.chatId,
    memberId: "member_existing",
    participantContact: recovery.participantContact,
    participantContactObservedAt: recovery.observedAt,
    prisma: tx,
    recipientPhone: recovery.recipientPhone,
  });
});

test("does not mutate an already connected group", async () => {
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
    containerMemberId: "group_runtime",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "already_connected",
  });
  expect(mocks.lookupHostedMemberByVerifiedEmailAddress).not.toHaveBeenCalled();
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("uses an existing verified email on the same account without a pending bridge", async () => {
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValueOnce({
    core: { id: "member_existing" },
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("refuses a Messages email already owned by another account", async () => {
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValueOnce({
    core: { id: "member_other" },
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT" },
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("refuses to overwrite another pending Messages setup", async () => {
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    pendingLinqChatId: "chat_other",
    pendingLinqParticipantContact: {
      kind: "email",
      lookupKey: "other_contact",
      value: "other@example.com",
    },
    pendingLinqRecipientPhone: "+15559999999",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT" },
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("accepts an idempotent exact pending Messages setup", async () => {
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    pendingLinqChatId: recovery.chatId,
    pendingLinqParticipantContact: recovery.participantContact,
    pendingLinqRecipientPhone: recovery.recipientPhone,
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledTimes(1);
});

test("reports a contact already bound to another member as a conflict", async () => {
  // The pre-checks above only read the session member's own bindings. The
  // routing store is the only layer that sees every member's, and it reports
  // the cross-member collision as a unique violation — the same conflict, so
  // it must not escape as a 5xx.
  mocks.upsertHostedMemberPendingLinqBindingTx.mockRejectedValueOnce({
    code: "P2002",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT" },
  });
});

test("still fails loudly when the binding upsert fails for an unrelated reason", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.upsertHostedMemberPendingLinqBindingTx.mockRejectedValueOnce(
    new Error("routing store unavailable"),
  );

  try {
    const response = await route.POST(buildRequest());

    // A conflict is the only failure the catch may reinterpret; anything else
    // must keep its original 5xx so the outage stays visible.
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  } finally {
    errorSpy.mockRestore();
  }
});

test("rejects an expired or malformed recovery token", async () => {
  mocks.openHostedLinqGroupEmailRecoveryToken.mockReturnValueOnce(null);

  const response = await route.POST(buildRequest("expired"));

  expect(response.status).toBe(410);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID" },
  });
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});
