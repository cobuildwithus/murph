import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHostedMemberPhoneWelcomeDeliveryIdentity, isHostedMemberSignupWelcomeDeliveryIdentity } from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), access: vi.fn(), route: vi.fn(), append: vi.fn(), signal: vi.fn(), unwrap: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({ readHostedMemberSnapshot: mocks.read }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ readActiveHostedMemberAccess: mocks.access }));
vi.mock("@/src/lib/hosted-onboarding/linq-home-routing", () => ({ resolveHostedMemberActivationLinqRoute: mocks.route }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ appendHostedMailboxEnvelopeTx: mocks.append }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: mocks.signal }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({ unwrapHostedDomainRootForWeb: mocks.unwrap }));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({ lockHostedMemberRow: mocks.lock, HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {} }));

import { ensureHostedMemberPhoneWelcome } from "@/src/lib/hosted-onboarding/phone-welcome";
import { areHostedDomainRootProviderCallsDisabled } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";

describe("phone welcome after signup", () => {
  const memberId = "member_phone_welcome";
  const phone = "+12025550123";
  const fromPhone = "+12025550124";
  let member: ReturnType<typeof makeMember>;
  let inTransaction: boolean;
  const tx = {};
  const prisma = { $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
    inTransaction = true;
    try { return await run(tx); } finally { inTransaction = false; }
  }) };
  const run = () => ensureHostedMemberPhoneWelcome({ memberId, prisma: prisma as never });
  function makeMember() {
    return {
      core: { id: memberId, suspendedAt: null as Date | null },
      identity: { phoneNumber: phone, phoneNumberVerifiedAt: new Date() as Date | null },
      routing: { linqChatId: null as string | null, pendingLinqChatId: null as string | null, linqRecipientPhone: null as string | null },
    };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    member = makeMember();
    inTransaction = false;
    mocks.read.mockImplementation(async () => member);
    mocks.access.mockResolvedValue(true);
    mocks.unwrap.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
      return { rootKey: new Uint8Array(32) };
    });
    mocks.route.mockImplementation(async () => {
      expect(areHostedDomainRootProviderCallsDisabled()).toBe(true);
      member.routing.linqRecipientPhone = fromPhone;
      return { welcomeRoute: {
        channel: "linq", actorId: "actor_phone", identityId: "identity_phone", threadId: null, threadIsDirect: true,
        delivery: { kind: "participant", target: phone, source: { kind: "linq", fromPhoneNumber: fromPhone } },
      } };
    });
    mocks.append.mockResolvedValue({ item: { id: "mailbox_phone_welcome" } });
    mocks.signal.mockImplementation(async () => { expect(inTransaction).toBe(false); });
  });

  it("queues the ordinary text welcome independently of an earlier email, once across retries", async () => {
    await run();
    await run();
    expect(mocks.append).toHaveBeenCalledTimes(1);
    const envelope = mocks.append.mock.calls[0]![0].envelope;
    const key = buildHostedMemberPhoneWelcomeDeliveryIdentity(memberId);
    expect(envelope).toMatchObject({
      kind: "assistant.notification.requested", userId: memberId,
      eventId: `assistant.notification.requested:${key}`,
      notification: {
        deliveryIdempotencyKey: key, deliveryDedupeToken: key, deliveryDispatchMode: "queue-only",
        firstContact: { markSeenOnDeliveryAccepted: true },
        route: { channel: "linq", delivery: { kind: "participant", target: phone } },
        responsePolicy: { kind: "require_send_exact_text" },
      },
    });
    expect(key).not.toBe(`signup-welcome:${memberId}`);
    expect(envelope.notification.instructions).toContain(envelope.notification.responsePolicy.text);
    expect(envelope.notification.responsePolicy.text).toMatch(/\?$/u);
    expect(mocks.signal).toHaveBeenCalledTimes(1);
  });

  it.each(["unverified", "suspended", "existing-thread", "pending-thread", "assigned-line", "inactive"])("does not send for %s", async (state) => {
    if (state === "unverified") member.identity.phoneNumberVerifiedAt = null;
    if (state === "suspended") member.core.suspendedAt = new Date();
    if (state === "existing-thread") member.routing.linqChatId = "existing_chat";
    if (state === "pending-thread") member.routing.pendingLinqChatId = "pending_chat";
    if (state === "assigned-line") member.routing.linqRecipientPhone = fromPhone;
    if (state === "inactive") mocks.access.mockResolvedValue(false);
    await run();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("rechecks identity and access under the member lock", async () => {
    mocks.lock.mockImplementationOnce(async () => { member.identity.phoneNumberVerifiedAt = null; });
    await run();
    expect(mocks.route).not.toHaveBeenCalled();
    member = makeMember();
    mocks.access.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await run();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("leaves unavailable line capacity to the existing assignment policy", async () => {
    mocks.route.mockResolvedValueOnce({ welcomeRoute: null });
    await run();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it("preserves the queued welcome when runtime signaling fails", async () => {
    mocks.signal.mockRejectedValueOnce(new Error("synthetic wake unavailable"));
    await expect(run()).resolves.toBeUndefined();
    await run();
    expect(mocks.append).toHaveBeenCalledTimes(1);
  });

  it("accepts only legacy and phone welcome identities for the exact member", () => {
    for (const key of [`signup-welcome:${memberId}`, buildHostedMemberPhoneWelcomeDeliveryIdentity(memberId)]) {
      expect(isHostedMemberSignupWelcomeDeliveryIdentity(key, memberId)).toBe(true);
      expect(isHostedMemberSignupWelcomeDeliveryIdentity(key, "another_member")).toBe(false);
    }
    for (const key of ["signup-welcome:", `signup-welcome:${memberId}:retry`, `signup-welcome:${memberId}:linq:extra`]) {
      expect(isHostedMemberSignupWelcomeDeliveryIdentity(key)).toBe(false);
    }
  });
});
