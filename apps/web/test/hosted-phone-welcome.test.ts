import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedMemberChannelWelcomeDeliveryIdentity,
  buildHostedMemberPhoneWelcomeDeliveryIdentity,
  isHostedMemberSignupWelcomeDeliveryIdentity,
} from "@murphai/hosted-execution";

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
import { ensureHostedMemberChannelWelcome } from "@/src/lib/hosted-onboarding/channel-welcome";
import { areHostedDomainRootProviderCallsDisabled } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "@/src/lib/hosted-onboarding/messaging-state";

describe("welcome on a newly connected channel", () => {
  const memberId = "member_channel_welcome";
  const phone = "+12025550123";
  const fromPhone = "+12025550124";
  const email = "member@example.test";
  let member: ReturnType<typeof makeMember>;
  let lockedMember: ReturnType<typeof makeMember>;
  let queued: Set<string>;
  let lockedQueued: Set<string>;
  let inTransaction: boolean;
  let rootKey: Uint8Array;
  const findUnique = vi.fn(async (input: {
    where: { userId_dedupeKey: { userId: string; dedupeKey: string } };
    select: { id: true };
  }) => {
    expect(input.where.userId_dedupeKey.userId).toBe(memberId);
    expect(input.select).toEqual({ id: true });
    const rows = inTransaction ? lockedQueued : queued;
    return rows.has(input.where.userId_dedupeKey.dedupeKey) ? { id: "mailbox_existing" } : null;
  });
  const tx = { hostedMailboxItem: { findUnique } };
  const prisma = {
    hostedMailboxItem: { findUnique },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
      lockedMember = structuredClone(member);
      lockedQueued = new Set(queued);
      inTransaction = true;
      try {
        const result = await run(tx);
        member = lockedMember;
        queued = lockedQueued;
        return result;
      } finally {
        inTransaction = false;
      }
    }),
  };
  const run = (channel: "email" | "linq" = "linq") => channel === "linq"
    ? ensureHostedMemberPhoneWelcome({ memberId, prisma: prisma as never })
    : ensureHostedMemberChannelWelcome({ channel, memberId, prisma: prisma as never });

  function makeMember() {
    return {
      core: { id: memberId, suspendedAt: null as Date | null },
      identity: {
        phoneNumber: phone as string | null,
        phoneLookupKey: "phone_lookup" as string | null,
        phoneNumberVerifiedAt: new Date("2026-01-01T00:00:00Z") as Date | null,
      },
      emailAuthorization: {
        verifiedEmail: {
          address: email, lookupKey: "email_lookup", verifiedAt: new Date("2026-01-01T00:00:00Z"),
        } as { address: string; lookupKey: string; verifiedAt: Date } | null,
      },
      routing: {
        linqChatId: null as string | null,
        pendingLinqChatId: null as string | null,
        linqRecipientPhone: null as string | null,
        telegramThreadId: null as string | null,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    member = makeMember();
    queued = new Set();
    inTransaction = false;
    rootKey = new Uint8Array(32).fill(7);
    mocks.read.mockImplementation(async (input) => {
      expect(input.prisma === tx).toBe(inTransaction);
      if (inTransaction) expect(areHostedDomainRootProviderCallsDisabled()).toBe(true);
      return inTransaction ? lockedMember : member;
    });
    mocks.access.mockResolvedValue(true);
    mocks.unwrap.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
      return { rootKey };
    });
    mocks.lock.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      expect(rootKey.every((byte) => byte === 0)).toBe(true);
    });
    mocks.route.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      expect(areHostedDomainRootProviderCallsDisabled()).toBe(true);
      lockedMember.routing.linqRecipientPhone ??= fromPhone;
      return { welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        channel: "linq", linqChatId: null, memberId,
        linqRecipientPhone: lockedMember.routing.linqRecipientPhone,
        memberPhoneNumber: lockedMember.identity.phoneNumber,
        messaging: resolveHostedMemberMessagingState(lockedMember),
      }) };
    });
    mocks.append.mockImplementation(async ({ envelope, tx: actualTx }) => {
      expect(actualTx).toBe(tx);
      expect(inTransaction).toBe(true);
      expect(areHostedDomainRootProviderCallsDisabled()).toBe(true);
      lockedQueued.add(envelope.eventId);
      return { item: { id: "mailbox_channel_welcome" } };
    });
    mocks.signal.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
      expect(queued.size).toBeGreaterThan(0);
    });
  });

  it.each([
    ["email", "linq"], ["linq", "email"],
  ] as const)("queues each welcome independently in %s then %s order and dedupes both retries", async (first, second) => {
    member.routing.telegramThreadId = "telegram_thread";
    await run(first);
    await run(second);
    await run(first);
    await run(second);
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.route).toHaveBeenCalledTimes(1);
    expect(mocks.signal).toHaveBeenCalledTimes(2);
    const envelopes = mocks.append.mock.calls.map(([input]) => input.envelope);
    expect(envelopes.map((envelope) => envelope.notification.route.channel)).toEqual([first, second]);
    for (const envelope of envelopes) {
      const notification = envelope.notification;
      const key = buildHostedMemberChannelWelcomeDeliveryIdentity({
        memberId, channel: notification.route.channel, destinationLookupKey: notification.route.identityId,
      });
      expect(envelope).toMatchObject({
        kind: "assistant.notification.requested", userId: memberId,
        eventId: `assistant.notification.requested:${key}`,
        notification: {
          deliveryIdempotencyKey: key, deliveryDedupeToken: key,
          deliveryDispatchMode: "queue-only", firstContact: { markSeenOnDeliveryAccepted: true },
          responsePolicy: { kind: "require_send_exact_text" },
        },
      });
      expect(notification.route.delivery.target).toBe(notification.route.channel === "email" ? email : phone);
      expect(notification.instructions).toContain(notification.responsePolicy.text);
      expect(notification.responsePolicy.text).toMatch(/\?$/u);
    }
    expect(envelopes[0].eventId).not.toBe(envelopes[1].eventId);
  });

  it.each(["email", "linq"] as const)("does no work for ineligible %s members", async (channel) => {
    for (const state of ["unverified", "suspended", "inactive", "missing"] as const) {
      member = makeMember();
      if (state === "unverified" && channel === "email") member.emailAuthorization.verifiedEmail = null;
      if (state === "unverified" && channel === "linq") member.identity.phoneNumberVerifiedAt = null;
      if (state === "suspended") member.core.suspendedAt = new Date();
      if (state === "inactive") mocks.access.mockResolvedValueOnce(false);
      if (state === "missing") mocks.read.mockResolvedValueOnce(null);
      await run(channel);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.unwrap).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it.each(["linqChatId", "pendingLinqChatId"] as const)("preserves an existing %s phone conversation but still welcomes email", async (field) => {
    member.routing[field] = "existing_chat";
    member.routing.linqRecipientPhone = fromPhone;
    await run();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    await run("email");
    expect(mocks.append.mock.calls[0]?.[0].envelope.notification.route.channel).toBe("email");
  });

  it("uses a retained bare line and skips all further work once its destination is queued", async () => {
    member.routing.linqRecipientPhone = fromPhone;
    await run();
    await run();
    expect(mocks.route).toHaveBeenCalledTimes(1);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.unwrap).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(member.routing.linqRecipientPhone).toBe(fromPhone);
  });

  it.each(["email", "linq"] as const)("rechecks %s identity and access after acquiring the member lock", async (channel) => {
    mocks.lock.mockImplementationOnce(async () => {
      if (channel === "email") lockedMember.emailAuthorization.verifiedEmail = null;
      else lockedMember.identity.phoneNumberVerifiedAt = null;
    });
    await run(channel);
    member = makeMember();
    mocks.access.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await run(channel);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it.each(["email", "linq"] as const)("suppresses a concurrent %s welcome before reserving or appending again", async (channel) => {
    member.routing.linqRecipientPhone = fromPhone;
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "mailbox_concurrent" });
    await run(channel);
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it.each(["email", "linq"] as const)("uses the current %s destination when identity changes under the lock", async (channel) => {
    mocks.lock.mockImplementationOnce(async () => {
      if (channel === "email") {
        lockedMember.emailAuthorization.verifiedEmail = {
          address: "current@example.test", lookupKey: "current_email_lookup", verifiedAt: new Date(),
        };
      } else {
        lockedMember.identity.phoneNumber = "+12025550125";
        lockedMember.identity.phoneLookupKey = "current_phone_lookup";
      }
    });
    await run(channel);
    await run(channel);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.append.mock.calls[0]?.[0].envelope.notification.route.delivery.target)
      .toBe(channel === "email" ? "current@example.test" : "+12025550125");
  });

  it.each(["email", "linq"] as const)("welcomes a changed %s destination once under a distinct key", async (channel) => {
    await run(channel);
    if (channel === "email") {
      member.emailAuthorization.verifiedEmail = {
        address: "new@example.test", lookupKey: "new_email_lookup", verifiedAt: new Date(),
      };
    } else {
      member.identity.phoneNumber = "+12025550125";
      member.identity.phoneLookupKey = "new_phone_lookup";
    }
    await run(channel);
    await run(channel);
    expect(mocks.append).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.append.mock.calls.map(([input]) => input.envelope);
    expect(first.eventId).not.toBe(second.eventId);
    expect(second.notification.route.delivery.target).toBe(channel === "email" ? "new@example.test" : "+12025550125");
  });

  it("leaves unavailable line capacity to the existing policy and can recover later", async () => {
    mocks.route.mockResolvedValueOnce({ welcomeRoute: null });
    await run();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();
    await run();
    expect(mocks.append).toHaveBeenCalledTimes(1);
  });

  it("does not commit a reserved line without its welcome when mailbox append fails", async () => {
    mocks.append.mockRejectedValueOnce(new Error("synthetic mailbox failure"));
    await expect(run()).rejects.toThrow("synthetic mailbox failure");
    expect(member.routing.linqRecipientPhone).toBeNull();
    expect(queued.size).toBe(0);
    expect(mocks.signal).not.toHaveBeenCalled();
    await run();
    expect(member.routing.linqRecipientPhone).toBe(fromPhone);
    expect(queued.size).toBe(1);
  });

  it.each(["email", "linq"] as const)("preserves queued %s outreach when runtime signaling fails", async (channel) => {
    mocks.signal.mockRejectedValueOnce(new Error("synthetic wake unavailable"));
    await expect(run(channel)).resolves.toBeUndefined();
    await run(channel);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(queued.size).toBe(1);
  });

  it("accepts only supported welcome identities for the exact member", () => {
    const keys = [
      `signup-welcome:${memberId}`, buildHostedMemberPhoneWelcomeDeliveryIdentity(memberId),
      ...(["email", "linq"] as const).map((channel) => buildHostedMemberChannelWelcomeDeliveryIdentity({
        memberId, channel, destinationLookupKey: "synthetic_destination",
      })),
    ];
    for (const key of keys) {
      expect(isHostedMemberSignupWelcomeDeliveryIdentity(key, memberId)).toBe(true);
      expect(isHostedMemberSignupWelcomeDeliveryIdentity(key, "another_member")).toBe(false);
      expect(key).not.toContain("synthetic_destination");
    }
    for (const key of ["signup-welcome:", `signup-welcome:${memberId}:retry`, `signup-welcome:${memberId}:linq:extra`]) {
      expect(isHostedMemberSignupWelcomeDeliveryIdentity(key)).toBe(false);
    }
  });
});
