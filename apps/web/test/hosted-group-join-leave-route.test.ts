import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  leaveHostedGroupMemberTx: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  leaveHostedGroupMemberTx: mocks.leaveHostedGroupMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: mocks.transaction }),
}));

type GroupLeaveRoute = typeof import("../app/api/groups/join/[joinCode]/leave/route");

let route: GroupLeaveRoute;

describe("hosted group join-page leave route", () => {
  beforeAll(async () => {
    route = await import("../app/api/groups/join/[joinCode]/leave/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_departing" },
    });
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback({ tx: true }),
    );
    mocks.leaveHostedGroupMemberTx.mockResolvedValue({ kind: "left" });
  });

  it("leaves the session member and exposes only the terminal status", async () => {
    const request = createLeaveRequest();
    const response = await route.POST(request, createRouteContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "left" });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.leaveHostedGroupMemberTx).toHaveBeenCalledWith({
      joinCode: "JOIN123",
      memberId: "member_departing",
      now: expect.any(Date),
      tx: { tx: true },
    });
  });

  it("returns an idempotent already-left result", async () => {
    mocks.leaveHostedGroupMemberTx.mockResolvedValueOnce({ kind: "already_left" });

    const response = await route.POST(createLeaveRequest(), createRouteContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: "already_left" });
  });

  it("maps a missing group to the same safe invalid-link error", async () => {
    mocks.leaveHostedGroupMemberTx.mockResolvedValueOnce({ kind: "group_not_found" });

    const response = await route.POST(createLeaveRequest(), createRouteContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_GROUP_JOIN_LINK_NOT_FOUND",
        message: "This group link is no longer valid.",
        retryable: false,
      },
    });
  });

  it("rejects the group owner without exposing group state", async () => {
    mocks.leaveHostedGroupMemberTx.mockResolvedValueOnce({ kind: "owner_cannot_leave" });

    const response = await route.POST(createLeaveRequest(), createRouteContext());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_GROUP_OWNER_CANNOT_LEAVE",
        message: "The group owner cannot leave this group.",
        retryable: false,
      },
    });
  });

  it("fails before session or database access when the mutation origin is invalid", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "CSRF_ORIGIN_REQUIRED",
        httpStatus: 403,
        message: "Hosted browser mutation routes require an Origin header.",
      });
    });

    const response = await route.POST(createLeaveRequest(), createRouteContext());

    expect(response.status).toBe(403);
    expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.leaveHostedGroupMemberTx).not.toHaveBeenCalled();
  });

  it("requires an ordinary authenticated app session before database access", async () => {
    mocks.requireHostedAppSessionFromRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_APP_SESSION_REQUIRED",
      httpStatus: 401,
      message: "Sign in to continue.",
    }));

    const response = await route.POST(createLeaveRequest(), createRouteContext());

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.leaveHostedGroupMemberTx).not.toHaveBeenCalled();
  });
});

function createLeaveRequest(): Request {
  return new Request("https://join.example.test/api/groups/join/JOIN123/leave", {
    headers: { origin: "https://join.example.test" },
    method: "POST",
  });
}

function createRouteContext(): { params: Promise<{ joinCode: string }> } {
  return { params: Promise.resolve({ joinCode: "JOIN123" }) };
}
