import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emailWelcome: vi.fn(), access: vi.fn(), setup: vi.fn(), welcome: vi.fn(), invite: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ readActiveHostedMemberAccess: mocks.access }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberMessagingSetupState: mocks.setup,
  readHostedMemberEmailAuthorization: vi.fn(async () => null),
}));
vi.mock("@/src/lib/hosted-onboarding/channel-welcome", () => ({ ensureHostedMemberChannelWelcome: mocks.emailWelcome }));
vi.mock("@/src/lib/hosted-onboarding/phone-welcome", () => ({ ensureHostedMemberPhoneWelcome: mocks.welcome }));
vi.mock("@/src/lib/hosted-onboarding/activation-progress", () => ({ isHostedMemberActivationPending: vi.fn(async () => false) }));
vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInvite: mocks.invite,
  buildHostedInviteUrl: () => "https://www.withmurph.ai/join/synthetic",
}));

import { readHostedAuthenticationCompletion } from "@/src/lib/hosted-onboarding/authentication-completion";

describe("shared mobile and web authentication phone welcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(true);
    mocks.setup.mockResolvedValue({ identity: { phoneLookupKey: "synthetic-phone-key" }, routing: null });
    mocks.invite.mockResolvedValue({ inviteCode: "synthetic" });
  });
  const prisma = {} as never;
  const run = () => readHostedAuthenticationCompletion({
    member: { id: "synthetic-member", billingStatus: "active", suspendedAt: null } as never,
    emailLinked: true, prisma,
  });

  it("requests the text welcome for an active member even when email is already linked", async () => {
    await run();
    expect(mocks.welcome).toHaveBeenCalledExactlyOnceWith({ memberId: "synthetic-member", prisma });
  });
  it("repairs email outreach for active email-only authentication", async () => {
    mocks.setup.mockResolvedValue({ identity: { phoneLookupKey: null }, routing: null });
    await run();
    expect(mocks.welcome).not.toHaveBeenCalled();
    expect(mocks.emailWelcome).toHaveBeenCalledExactlyOnceWith({ channel: "email", memberId: "synthetic-member", prisma });
  });
  it("does not request a welcome before active access", async () => {
    mocks.access.mockResolvedValue(false);
    await run();
    expect(mocks.welcome).not.toHaveBeenCalled();
    expect(mocks.emailWelcome).not.toHaveBeenCalled();
  });
});
