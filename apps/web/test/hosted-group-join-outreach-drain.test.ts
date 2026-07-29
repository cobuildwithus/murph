import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireDrainLock: vi.fn(),
  claimDelivery: vi.fn(),
  countHomeBindings: vi.fn(),
  claimLineCapacity: vi.fn(),
  createChat: vi.fn(),
  decideSendWindow: vi.fn(),
  listHealthyLines: vi.fn(),
  lookupMember: vi.fn(),
  markDeliveryAccepted: vi.fn(),
  markDeliveryFailed: vi.fn(),
  markSkippedDelivery: vi.fn(),
  readParticipantPhone: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedEmailLookupKey: (value: string | null | undefined) =>
    value ? `email:${value}` : null,
  createHostedLinqChatLookupKey: (value: string | null | undefined) =>
    value ? `chat:${value}` : null,
  createHostedLinqMessageLookupKey: (value: string | null | undefined) =>
    value ? `message:${value}` : null,
  createHostedPhoneLookupKey: (value: string | null | undefined) =>
    value ? `phone:${value}` : null,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  claimHostedLinqDeliveryProviderDispatchTx: mocks.claimDelivery,
  markHostedLinqDeliveryAcceptedTx: mocks.markDeliveryAccepted,
  markHostedLinqDeliverySendFailedTx: mocks.markDeliveryFailed,
}));

// Mock only the home-line load counter; chooseHostedLinqSignupWelcomeLine itself
// runs for real so these tests exercise the shared selection policy.
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-linq", () => ({
  countHostedMemberHomeLinqBindingsByRecipientPhone: mocks.countHomeBindings,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  claimHostedLinqProactiveConversationCapacityTx: mocks.claimLineCapacity,
  listHostedLinqHealthyProactiveLines: mocks.listHealthyLines,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  createHostedLinqChat: mocks.createChat,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupMember,
}));

vi.mock("@/src/lib/hosted-groups/group-join-outreach-store", () => ({
  HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE: "hosted_group_join_outreach",
  HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE: "group_join_outreach",
  acquireHostedGroupJoinOutreachDrainLockTx: mocks.acquireDrainLock,
  buildHostedGroupJoinOutreachIdempotencyKey: (outreachId: string) =>
    `group-join-outreach:${outreachId}`,
  markHostedGroupJoinOutreachSkippedDeliveryTx: mocks.markSkippedDelivery,
  readHostedGroupJoinOutreachParticipantPhone: mocks.readParticipantPhone,
}));

vi.mock("@/src/lib/hosted-groups/group-join-outreach-window", () => ({
  decideHostedGroupJoinOutreachSendWindow: mocks.decideSendWindow,
}));

import { resolveHostedLinqSignupWelcomeDailyLimit } from "@/src/lib/hosted-onboarding/linq-routing-policy";
import {
  HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT,
  buildHostedGroupJoinOutreachMessage,
  resolveHostedGroupJoinOutreachDailyLimit,
  drainHostedGroupJoinOutreachSweep,
  drainOneHostedGroupJoinOutreach,
  readHostedGroupJoinOutreachVariantIndex,
} from "@/src/lib/hosted-groups/group-join-outreach-drain";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const NOW = new Date("2026-07-24T16:00:00.000Z");
const LINE = {
  activeMemberLimit: null,
  assignmentWeight: 100,
  maxNewConversationsPerDay: 20,
  phoneNumber: "+15550000001",
  phoneNumberHint: "•••0001",
  phoneNumberLookupKey: "line_lookup_1",
  proactiveConversationCount: 0,
  proactiveConversationDayUtc: new Date("2026-07-24T00:00:00.000Z"),
};

describe("hosted group join outreach drain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireDrainLock.mockResolvedValue(undefined);
    mocks.claimDelivery.mockResolvedValue({
      claimed: true,
      id: "hld_opaque",
    });
    mocks.claimLineCapacity.mockResolvedValue(true);
    mocks.countHomeBindings.mockResolvedValue(new Map());
    mocks.createChat.mockResolvedValue({
      chatId: "chat_direct_opaque",
      messageId: "message_opaque",
    });
    mocks.decideSendWindow.mockReturnValue({ kind: "send_now" });
    mocks.listHealthyLines.mockResolvedValue([LINE]);
    mocks.lookupMember.mockResolvedValue(null);
    mocks.markDeliveryAccepted.mockResolvedValue({
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    });
    mocks.markDeliveryFailed.mockResolvedValue(undefined);
    mocks.markSkippedDelivery.mockResolvedValue(undefined);
    mocks.readParticipantPhone.mockReturnValue("+15551234567");
  });

  it("sends one paced, link-free, group-specific first outreach", async () => {
    const { prisma } = createPrismaStub();

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "sent",
      outreachId: "hgrpjoa_opaque",
    });

    expect(mocks.claimLineCapacity).toHaveBeenCalledWith({
      dayUtc: new Date("2026-07-24T00:00:00.000Z"),
      // The line's welcome limit is 20; outreach claims against 10 so onboarding
      // keeps its reserved slots.
      limit: 10,
      phoneNumberLookupKey: "line_lookup_1",
      prisma: expect.anything(),
    });
    expect(mocks.createChat).toHaveBeenCalledTimes(1);
    const send = mocks.createChat.mock.calls[0]?.[0] as {
      message: string;
    } | undefined;
    expect(send?.message).toContain("Training circle");
    // Any bank variant is acceptable here; each one is held to the shared
    // first-contact rules by the dedicated copy tests below.
    expect(send?.message).toMatch(/repl(y|ies)|say hi|send me a message/iu);
    expect(send?.message).not.toMatch(/https?:|www\./iu);
  });

  it("defers durably without a provider call when every line is at cap", async () => {
    mocks.claimLineCapacity.mockResolvedValue(false);
    const { prisma, updateMany } = createPrismaStub();

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "line_capacity_exhausted",
    });

    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeferralReason: "line_capacity_exhausted",
        }),
      }),
    );
  });

  // Each of these is a refusal that must never reach the provider. Proving them
  // together is what keeps an unsolicited or duplicate cold thread from becoming
  // possible while the happy-path test stays green.
  const refusals: readonly {
    arrange: () => void;
    expected: { kind: "deferred" | "skipped"; reason: string };
    name: string;
    stub?: Parameters<typeof createPrismaStub>[0];
  }[] = [
    {
      arrange: () => {
        mocks.lookupMember.mockResolvedValue({
          core: { id: "hbm_existing", suspendedAt: null },
        });
      },
      expected: { kind: "skipped", reason: "recipient_now_member" },
      name: "the recipient already has an account",
    },
    {
      arrange: () => {
        mocks.decideSendWindow.mockReturnValue({
          kind: "defer",
          nextAttemptAt: new Date("2026-07-25T13:00:00.000Z"),
          reason: "recipient_quiet_hours",
        });
      },
      expected: { kind: "deferred", reason: "recipient_quiet_hours" },
      name: "the recipient is inside quiet hours",
    },
    {
      arrange: () => {
        mocks.listHealthyLines.mockResolvedValue([]);
      },
      expected: { kind: "deferred", reason: "no_healthy_line" },
      name: "no healthy line can send",
    },
    {
      arrange: () => {
        mocks.claimDelivery.mockResolvedValue({ claimed: false, retryAt: null });
      },
      expected: { kind: "deferred", reason: "delivery_in_flight" },
      name: "a delivery attempt is already in flight",
    },
    {
      arrange: () => {
        mocks.readParticipantPhone.mockReturnValue(null);
      },
      expected: { kind: "skipped", reason: "participant_phone_unreadable" },
      name: "the stored participant phone cannot be read",
    },
    {
      arrange: () => {},
      expected: { kind: "skipped", reason: "offer_revoked" },
      name: "the offer was revoked after enqueue",
      stub: { offerRevokedAt: new Date("2026-07-24T15:00:00.000Z") },
    },
  ];

  for (const refusal of refusals) {
    it(`refuses without a provider call when ${refusal.name}`, async () => {
      refusal.arrange();
      const { prisma, updateMany } = createPrismaStub(refusal.stub);

      await expect(drainOneHostedGroupJoinOutreach({
        now: NOW,
        prisma,
      })).resolves.toEqual({
        ...refusal.expected,
        outreachId: "hgrpjoa_opaque",
      });

      expect(mocks.createChat).not.toHaveBeenCalled();
      if (refusal.expected.kind === "skipped") {
        expect(mocks.markSkippedDelivery).toHaveBeenCalledWith(
          expect.objectContaining({
            now: NOW,
            outreachId: "hgrpjoa_opaque",
            reason: refusal.expected.reason,
          }),
        );
        expect(updateMany).not.toHaveBeenCalled();
      } else {
        expect(updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              lastDeferralReason: refusal.expected.reason,
            }),
          }),
        );
      }
    });
  }

  it("persists the exact next attempt instant for a quiet-hours deferral", async () => {
    const nextAttemptAt = new Date("2026-07-25T13:00:00.000Z");
    mocks.decideSendWindow.mockReturnValue({
      kind: "defer",
      nextAttemptAt,
      reason: "recipient_quiet_hours",
    });
    const { prisma, updateMany } = createPrismaStub();

    await drainOneHostedGroupJoinOutreach({ now: NOW, prisma });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeferralReason: "recipient_quiet_hours",
          nextAttemptAt,
        }),
      }),
    );
  });

  it("retries a retryable provider failure instead of abandoning the recipient", async () => {
    mocks.createChat.mockRejectedValue(new Error("provider unavailable"));
    const { prisma, updateMany } = createPrismaStub({ attemptCount: 1 });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "provider_retry",
    });

    expect(mocks.markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterAt: expect.any(Date) }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastDeferralReason: "provider_retry" }),
      }),
    );
  });

  it("stops retrying a provider rejection that cannot succeed", async () => {
    mocks.createChat.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_LINQ_SEND_REJECTED",
      httpStatus: 400,
      message: "Provider rejected the recipient.",
      retryable: false,
    }));
    const { prisma, updateMany } = createPrismaStub({ attemptCount: 1 });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "skipped",
      outreachId: "hgrpjoa_opaque",
      reason: "provider_rejected",
    });

    expect(mocks.markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterAt: null }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("stops after the provider attempt ceiling", async () => {
    mocks.createChat.mockRejectedValue(new Error("provider unavailable"));
    const { prisma, updateMany } = createPrismaStub({ attemptCount: 5 });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "skipped",
      outreachId: "hgrpjoa_opaque",
      reason: "provider_attempt_limit",
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("never rewrites provider success as failure when acceptance persistence fails", async () => {
    mocks.markDeliveryAccepted.mockRejectedValueOnce(
      new Error("acceptance persistence failed"),
    );
    const { prisma } = createPrismaStub();

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).rejects.toThrow("acceptance persistence failed");

    expect(mocks.createChat).toHaveBeenCalledTimes(1);
    expect(mocks.markDeliveryFailed).not.toHaveBeenCalled();
  });

  it("reports idle without touching the provider when nothing is due", async () => {
    const { prisma } = createPrismaStub({ due: null });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({ kind: "idle" });

    expect(mocks.createChat).not.toHaveBeenCalled();
  });

  it("defers rather than doubling up when every healthy line sent recently", async () => {
    // Throughput must come from more lines, never from one line bursting.
    const { prisma, updateMany } = createPrismaStub({
      recentLineKeys: ["line_lookup_1"],
    });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "line_pacing",
    });

    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastDeferralReason: "line_pacing" }),
      }),
    );
  });

  it("sweeps several due outreaches per invocation and stops on the first refusal", async () => {
    const { prisma } = createPrismaStub();

    const sweep = await drainHostedGroupJoinOutreachSweep({
      max: 10,
      now: NOW,
      prisma,
    });

    // The stub always has a due row, so the cap is what bounds the sweep.
    expect(sweep.attempted).toBe(10);
    expect(sweep.sent).toBe(10);
    expect(mocks.createChat).toHaveBeenCalledTimes(10);
  });

  it("yields the sweep on elapsed time so it cannot starve the shared cron", async () => {
    // Each attempt makes a provider call and this shares a billing-critical cron,
    // so the budget must stop the sweep even while rows remain due.
    let clock = Date.parse("2026-07-24T16:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    mocks.createChat.mockImplementation(async () => {
      clock += 9_000;
      return { chatId: "chat_direct_opaque", messageId: "message_opaque" };
    });
    const { prisma } = createPrismaStub();

    const sweep = await drainHostedGroupJoinOutreachSweep({
      max: 10,
      now: NOW,
      prisma,
    });

    nowSpy.mockRestore();
    // Three attempts crosses the 20s budget, so it stops well short of ten.
    expect(sweep.attempted).toBeLessThan(10);
    expect(sweep.attempted).toBeGreaterThan(1);
  });

  it("stops the sweep as soon as an attempt does not send", async () => {
    mocks.claimLineCapacity.mockResolvedValue(false);
    const { prisma } = createPrismaStub();

    const sweep = await drainHostedGroupJoinOutreachSweep({
      max: 10,
      now: NOW,
      prisma,
    });

    expect(sweep.attempted).toBe(1);
    expect(sweep.sent).toBe(0);
    expect(mocks.createChat).not.toHaveBeenCalled();
  });

  it("leaves onboarding headroom on a shared line budget", () => {
    // Signup welcomes answer someone already waiting, so outreach must never be
    // able to consume a line's last welcome slots.
    expect(resolveHostedGroupJoinOutreachDailyLimit({
      maxNewConversationsPerDay: null,
    })).toBe(40);
    expect(resolveHostedGroupJoinOutreachDailyLimit({
      maxNewConversationsPerDay: 15,
    })).toBe(5);
    // A line still warming up can be reserved entirely for onboarding.
    expect(resolveHostedGroupJoinOutreachDailyLimit({
      maxNewConversationsPerDay: 8,
    })).toBe(0);
  });

  it("claims capacity against the outreach limit, not the welcome limit", async () => {
    const { prisma } = createPrismaStub();

    await drainOneHostedGroupJoinOutreach({ now: NOW, prisma });

    expect(mocks.claimLineCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("re-assigns a retry whose pinned line left the healthy pool", async () => {
    // Otherwise the row waits on one unhealthy line forever. The idempotency key
    // is keyed to the outreach, not the line, so moving it is replay-safe.
    const { prisma } = createPrismaStub({ pinnedLineKey: "line_lookup_gone" });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({ kind: "sent", outreachId: "hgrpjoa_opaque" });

    expect(mocks.claimLineCapacity).toHaveBeenCalled();
    expect(mocks.createChat).toHaveBeenCalledTimes(1);
  });

  it("waits rather than moving when the pinned line is only inside its pace window", async () => {
    const { prisma, updateMany } = createPrismaStub({
      pinnedLineKey: "line_lookup_1",
      recentLineKeys: ["line_lookup_1"],
    });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "line_pacing",
    });

    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastDeferralReason: "line_pacing" }),
      }),
    );
  });

  it("moves to a line with outreach capacity when the lowest-count line is capped", async () => {
    // Line A has the lower shared count so the real chooser prefers it, but its
    // reduced outreach cap is already spent. B must be tried, not A again.
    const lineA = {
      ...LINE,
      maxNewConversationsPerDay: 20,
      phoneNumber: "+15550000001",
      phoneNumberLookupKey: "line_lookup_a",
      proactiveConversationCount: 10,
    };
    const lineB = {
      ...LINE,
      maxNewConversationsPerDay: 50,
      phoneNumber: "+15550000002",
      phoneNumberLookupKey: "line_lookup_b",
      proactiveConversationCount: 11,
    };
    mocks.listHealthyLines.mockResolvedValue([lineA, lineB]);
    mocks.claimLineCapacity.mockImplementation(
      async (input: { phoneNumberLookupKey: string }) =>
        input.phoneNumberLookupKey === "line_lookup_b",
    );
    const { prisma } = createPrismaStub();

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({ kind: "sent", outreachId: "hgrpjoa_opaque" });

    const send = mocks.createChat.mock.calls[0]?.[0] as { from: string } | undefined;
    expect(send?.from).toBe("+15550000002");
    // A is tried once and then dropped from the candidate set, never retried.
    const attemptedKeys = mocks.claimLineCapacity.mock.calls.map(
      ([call]) => (call as { phoneNumberLookupKey: string }).phoneNumberLookupKey,
    );
    expect(attemptedKeys.filter((key) => key === "line_lookup_a")).toHaveLength(1);
  });

  it("retries soon, not next day, when a pinned line leaves the pool and no replacement is free", async () => {
    // The pinned line can return within minutes, so a transient health event must
    // not push the only private join path past the UTC-day boundary.
    mocks.claimLineCapacity.mockResolvedValue(false);
    const { prisma, updateMany } = createPrismaStub({
      pinnedLineKey: "line_lookup_gone",
    });

    await expect(drainOneHostedGroupJoinOutreach({
      now: NOW,
      prisma,
    })).resolves.toEqual({
      kind: "deferred",
      outreachId: "hgrpjoa_opaque",
      reason: "pinned_line_unavailable",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeferralReason: "pinned_line_unavailable",
          nextAttemptAt: new Date(NOW.getTime() + 15 * 60_000),
        }),
      }),
    );
  });

  it("reserves a finite number of welcome slots, not absolute priority", () => {
    // Truthful statement of the policy: the reserve guarantees this many later
    // welcome claims per line, and enough activations can still exhaust the line.
    for (const maxNewConversationsPerDay of [50, 20, 15, null]) {
      const welcome = resolveHostedLinqSignupWelcomeDailyLimit({
        maxNewConversationsPerDay,
      });
      const outreach = resolveHostedGroupJoinOutreachDailyLimit({
        maxNewConversationsPerDay,
      });
      expect(welcome - outreach).toBe(Math.min(10, welcome));
    }
  });

  it("never lets a URL-shaped group name enter first-contact copy", () => {
    for (let variant = 0; variant < 5; variant += 1) {
      const message = buildHostedGroupJoinOutreachMessage({
        groupDisplayName: "https://example.test/join",
        outreachId: `hgrpjoa_variant_${variant}`,
      });
      expect(message).toContain("this group");
      expect(message).not.toMatch(/https?:|www\./iu);
    }
  });

  it("keeps at least 100 unique variants within the first-contact copy contract", () => {
    // The bank exists so many recipients do not get byte-identical copy, but each
    // variant is held to the same first-contact rules.
    expect(HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT).toBeGreaterThanOrEqual(100);
    const messages = new Set<string>();
    const normalizedMessages = new Set<string>();
    for (let variant = 0; variant < 600; variant += 1) {
      const message = buildHostedGroupJoinOutreachMessage({
        groupDisplayName: "Sunday Sleep Crew",
        outreachId: `hgrpjoa_opaque_${variant}`,
      });
      messages.add(message);
      normalizedMessages.add(
        message.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(),
      );
      expect(message).toContain("Sunday Sleep Crew");
      expect(message.endsWith("Reply here to start the next step.")).toBe(true);
      expect(message).not.toMatch(/\b(?:liked|hearted)\b|tapped like|your like/iu);
      expect(message).not.toMatch(/https?:|www\./iu);
      expect(message).not.toContain("\u2014");
      // Acquisition, automation, and delivery-notification framing are forbidden.
      expect(message).not.toMatch(
        /sign ?up|get started|welcome|verify|account|enroll|activate|subscribe|free trial/iu,
      );
      expect(message).not.toMatch(
        /\b(?:automate(?:d)?|automatic(?:ally)?|automation|bot|campaign|outreach|notification|delivery|delivered|privately)\b|\b(?:may|might|will|can|could)\s+(?:privately\s+)?text\b/iu,
      );
      // The reply begins the handoff; it does not itself complete the web join.
      expect(message).not.toMatch(
        /one (message|reply)|all I need|and you're into|get you (?:added|in|joined|set up)|(?:do|finish|handle|sort) the rest|make it happen|take (?:care of it|it from there)|walk you in/iu,
      );
    }

    // Real spread, not one template with a rotating word.
    expect(messages.size).toBe(HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT);
    expect(normalizedMessages.size).toBe(HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT);
  });

  it("reads correctly for every variant when the group name falls back", () => {
    // A blank or URL-shaped display name becomes "this group", so no variant may
    // depend on the name being a proper noun.
    const seen = new Set<string>();
    for (let variant = 0; variant < 600; variant += 1) {
      const message = buildHostedGroupJoinOutreachMessage({
        groupDisplayName: "",
        outreachId: `hgrpjoa_fallback_${variant}`,
      });
      seen.add(message);
      expect(message).toContain("this group");
      // Catches article-plus-fallback collisions such as "the this group invite".
      expect(message).not.toMatch(/\b(the|a|an)\s+this group\b/iu);
    }

    expect(seen.size).toBe(HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT);
  });

  it("spreads selection across the whole bank", () => {
    const counts = new Map<number, number>();
    for (let variant = 0; variant < 2500; variant += 1) {
      const index = readHostedGroupJoinOutreachVariantIndex(
        `hgrpjoa_spread_${variant}`,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }

    // Every variant is reachable, and none dominates the bank.
    expect(counts.size).toBe(HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(2500 / HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT / 3);
    }
  });

  it("composes the identical message for a replayed dispatch", () => {
    // A retried dispatch reuses the same provider idempotency key, so the body
    // must not change between attempts.
    const first = buildHostedGroupJoinOutreachMessage({
      groupDisplayName: "Sunday Sleep Crew",
      outreachId: "hgrpjoa_stable",
    });
    const second = buildHostedGroupJoinOutreachMessage({
      groupDisplayName: "Sunday Sleep Crew",
      outreachId: "hgrpjoa_stable",
    });

    expect(second).toBe(first);
    expect(readHostedGroupJoinOutreachVariantIndex("hgrpjoa_stable"))
      .toBe(readHostedGroupJoinOutreachVariantIndex("hgrpjoa_stable"));
  });

});

function createPrismaStub(options?: {
  attemptCount?: number;
  due?: null;
  offerRevokedAt?: Date;
  pinnedLineKey?: string;
  recentLineKeys?: readonly string[];
}): {
  prisma: Parameters<typeof drainOneHostedGroupJoinOutreach>[0]["prisma"];
  updateMany: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const dueOutreach = {
    attemptCount: options?.attemptCount ?? 0,
    id: "hgrpjoa_opaque",
    offerId: "hgrpjo_opaque",
    participantPhoneEncrypted: "encrypted",
    participantPhoneLookupKey: "participant_lookup_1",
    requestedAt: NOW,
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    hostedGroupJoinOffer: {
      findUnique: vi.fn(async () => ({
        group: {
          displayName: "Training circle",
          id: "hgrp_opaque",
          joinCode: "join_opaque",
          runtimeMember: { suspendedAt: null },
          runtimeMemberId: "hbm_runtime",
        },
        groupId: "hgrp_opaque",
        revokedAt: options?.offerRevokedAt ?? null,
      })),
    },
    hostedGroupJoinOutreach: {
      // The drain reads two shapes through findFirst: the due row, and the
      // newest attempt anywhere for global pacing.
      findFirst: vi.fn(async (input: {
        where: Record<string, unknown>;
      }) => {
        if ("nextAttemptAt" in input.where) {
          return options?.due === null ? null : dueOutreach;
        }
        return null;
      }),
      findMany: vi.fn(async () => (options?.recentLineKeys ?? []).map(
        (phoneNumberLookupKey) => ({ phoneNumberLookupKey }),
      )),
      findUnique: vi.fn(async () => ({
        attemptCount: options?.attemptCount ?? 1,
      })),
      update: vi.fn(async () => dueOutreach),
      updateMany,
    },
    hostedLinqDelivery: {
      findFirst: vi.fn(async () =>
        options?.pinnedLineKey
          ? { phoneNumberLookupKey: options.pinnedLineKey }
          : null,
      ),
      findMany: vi.fn(async () => (options?.recentLineKeys ?? []).map(
        (phoneNumberLookupKey) => ({ phoneNumberLookupKey }),
      )),
    },
  };
  const prisma = {
    $transaction: vi.fn(async <T>(
      run: (transaction: typeof tx) => Promise<T>,
    ) => run(tx)),
  } as never;
  return { prisma, updateMany };
}
