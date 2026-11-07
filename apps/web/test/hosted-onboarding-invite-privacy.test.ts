import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInvite: vi.fn(),
  projectIdentity: vi.fn(),
  projectRouting: vi.fn(),
  readAccess: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  getPrisma: () => ({ hostedInvite: { findUnique: mocks.findInvite } }),
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", async (importOriginal) => ({
  ...await importOriginal<object>(),
  projectHostedMemberIdentityState: mocks.projectIdentity,
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-routing-store", async (importOriginal) => ({
  ...await importOriginal<object>(),
  projectHostedMemberRoutingState: mocks.projectRouting,
}));
vi.mock("../src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...await importOriginal<object>(),
  readActiveHostedMemberAccess: mocks.readAccess,
}));

import { getHostedInviteStatus } from "../src/lib/hosted-onboarding/invite-service";

const now = new Date("2026-11-06T12:00:00Z");
const member = {
  billingStatus: "active" as const,
  createdAt: now,
  id: "member_owner",
  suspendedAt: null,
  updatedAt: now,
};
const privateEmail = "invitee@example.test";
function invite(expiresAt = new Date(now.getTime() + 60_000)) {
  return {
    expiresAt,
    inviteCode: "synthetic-invite",
    memberId: member.id,
    member: { ...member, identity: {}, routing: {}, emailAuthorization: null },
  };
}

describe("invite status privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findInvite.mockResolvedValue(invite());
    mocks.projectIdentity.mockResolvedValue({});
    mocks.projectRouting.mockResolvedValue({
      pendingLinqParticipantContact: { kind: "email", value: privateEmail },
      telegramUserId: "synthetic-telegram",
    });
    mocks.readAccess.mockResolvedValue(true);
  });

  it.each([null, { ...member, id: "another_member" }])(
    "hides pending email and setup state without the matching session (%j)",
    async (authenticatedMember) => {
      const status = await getHostedInviteStatus({
        authenticatedMember, inviteCode: "synthetic-invite", now,
      });
      expect(status.stage).toBe("verify");
      expect(status.invite?.verificationMode).toBe("invite_email");
      expect(status.invite).not.toHaveProperty("emailAuthTarget");
      expect(JSON.stringify(status)).not.toContain(privateEmail);
      expect(status.messagingSetupRequired).toBe(false);
      expect(status.telegramStartRequired).toBe(false);
      expect(status.murphPhoneNumber).toBeNull();
      expect(mocks.readAccess).not.toHaveBeenCalled();
    },
  );

  it("hides messaging setup requirements from anonymous visitors", async () => {
    mocks.projectRouting.mockResolvedValue({});
    const status = await getHostedInviteStatus({ inviteCode: "synthetic-invite", now });
    expect(status.messagingSetupRequired).toBe(false);
  });

  it.each([null, member])("expires without projecting private contact or setup state (%j)", async (authenticatedMember) => {
    mocks.findInvite.mockResolvedValue(invite(now));
    const status = await getHostedInviteStatus({ authenticatedMember, inviteCode: "synthetic-invite", now });
    expect(status.stage).toBe("expired");
    expect(status.invite).toBeNull();
    expect(status.messagingSetupRequired).toBe(false);
    expect(status.telegramStartRequired).toBe(false);
    expect(mocks.projectIdentity).not.toHaveBeenCalled();
    expect(mocks.projectRouting).not.toHaveBeenCalled();
    expect(mocks.readAccess).not.toHaveBeenCalled();
  });

  it("preserves the matching member's active setup continuation", async () => {
    const status = await getHostedInviteStatus({ authenticatedMember: member, inviteCode: "synthetic-invite", now });
    expect(status.stage).toBe("active");
    expect(status.session.matchesInvite).toBe(true);
    expect(status.invite?.emailAuthTarget).toEqual({ kind: "saved", emailAddress: privateEmail });
    expect(status.telegramStartRequired).toBe(true);
  });
});
