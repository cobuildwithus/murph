from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} did not match expected head")
    return text.replace(old, new, 1)


source_path = Path("apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts")
source = source_path.read_text()
source = replace_once(
    source,
    """/**
 * Group chats with no explicit thread route stay ignored unless the sender is
 * an active member and the recipient resolves to an active managed Murph Linq
 * line; only then is the dedicated thread-container runtime provisioned and
 * the triggering message routed into it. The webhook recipient alone is never
 * line authority. Existing routes are handled before this admission path.
 */""",
    """/**
 * An unbound group can be admitted by either one roster-matched pending setup
 * or the existing active-sender fallback. The recipient must still resolve to
 * an active managed Murph Linq line; the webhook recipient alone is never line
 * authority. Existing routes are handled before this admission path.
 */""",
    "planner comment",
)
source = replace_once(
    source,
    """  const sender = senderLookup?.core ?? null;
  if (!sender) {
    return ignored("sender-identity-unresolved");
  }
  const senderIdentityMatch: HostedLinqExistingMemberMatch =
    participantContact.kind === "phone" ? "phone-identity" : "verified-email";
  if (
    isHostedMemberSuspended(sender.suspendedAt)
    || !(await readHostedRuntimeAiAccessDecision({
      memberId: sender.id,
      prisma: input.prisma,
    })).allowed
  ) {
    return ignored("sender-inactive", senderIdentityMatch);
  }

  if (!(await hasActiveHostedLinqManagedLine({
    phoneNumberLookupKeys: input.threadRouteAccountLookupKeys,
    prisma: input.prisma,
  }))) {
    return ignored("recipient-line-unmanaged", senderIdentityMatch);
  }
""",
    """  const sender = senderLookup?.core ?? null;
  const senderIdentityMatch: HostedLinqExistingMemberMatch = sender
    ? participantContact.kind === "phone"
      ? "phone-identity"
      : "verified-email"
    : "none";

  if (!(await hasActiveHostedLinqManagedLine({
    phoneNumberLookupKeys: input.threadRouteAccountLookupKeys,
    prisma: input.prisma,
  }))) {
    return ignored("recipient-line-unmanaged", senderIdentityMatch);
  }

  const activeSenderMemberId = sender
    && !isHostedMemberSuspended(sender.suspendedAt)
    && (await readHostedRuntimeAiAccessDecision({
      memberId: sender.id,
      prisma: input.prisma,
    })).allowed
      ? sender.id
      : null;
""",
    "sender admission",
)
source = replace_once(
    source,
    """      fallbackOwnerMemberId: sender.id,
      mailboxDedupeKey: input.event.event_id,
      occurredAt: new Date(occurredAt),
      participantMemberIds: input.participantMemberIds,
      recipientPhoneLookupKeys: input.threadRouteAccountLookupKeys,
      senderMemberId: sender.id,
""",
    """      fallbackOwnerMemberId: activeSenderMemberId,
      mailboxDedupeKey: input.event.event_id,
      occurredAt: new Date(occurredAt),
      participantMemberIds: input.participantMemberIds,
      recipientPhoneLookupKeys: input.threadRouteAccountLookupKeys,
      senderMemberId: activeSenderMemberId,
""",
    "prepared route call",
)
source = replace_once(
    source,
    """    if (preparedResult.kind !== "ensured") {
      return ignored("provision-unavailable", senderIdentityMatch);
    }
""",
    """    if (preparedResult.kind !== "ensured") {
      return !sender
        ? ignored("sender-identity-unresolved")
        : activeSenderMemberId === null
          ? ignored("sender-inactive", senderIdentityMatch)
          : ignored("provision-unavailable", senderIdentityMatch);
    }
""",
    "prepared result fallback",
)
source = replace_once(
    source,
    """    prisma: input.prisma,
    resolvedParticipantMemberId: sender.id,
    route,
""",
    """    prisma: input.prisma,
    ...(activeSenderMemberId
      ? { resolvedParticipantMemberId: activeSenderMemberId }
      : {}),
    route,
""",
    "explicit route sender",
)
source_path.write_text(source)


test_path = Path("apps/web/test/hosted-onboarding-linq-thread-route.test.ts")
tests = test_path.read_text()
test_name = (
    "allows a uniquely prepared roster member to own the group "
    "when a non-member speaks first"
)
marker = '  it("ignores routed thread traffic when the container is inactive", async () => {\n'
regression = '''  it("allows a uniquely prepared roster member to own the group when a non-member speaks first", async () => {
    const prisma = createStatefulThreadRoutePrisma();
    prisma.seedActiveManagedLinqLine("+15550000000");
    vi.mocked(memberIdentityStore.lookupHostedMemberIdentityByPhoneNumber)
      .mockResolvedValue(null);
    vi.mocked(hostedMemberStore.readHostedMemberCoreState).mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-07-29T17:00:00.000Z"),
      id: "member_prepared_owner",
      suspendedAt: null,
      updatedAt: new Date("2026-07-29T17:00:00.000Z"),
    });
    vi.mocked(usageAllowance.checkHostedAiUsageGate).mockResolvedValue({
      allowed: true,
      allowanceSource: "thread_container",
      billingPlanCode: "launch_monthly",
      limitUsdMicros: 4_500_000n,
      memberId: "member_prepared_container",
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      remainingUsdMicros: 4_500_000n,
      spentUsdMicros: 0n,
      usageCreditBalanceUsdMicros: 0n,
      usageCreditLedgerVersion: 0n,
    });

    preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx
      .mockImplementationOnce(async (input) => {
        const threadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: input.accountLookupKey,
          channel: "linq",
          threadId: input.threadId,
        });
        const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "linq",
          threadId: input.threadId,
        });
        if (!threadLookupKey || !threadIdentityLookupKey) {
          throw new Error("Expected route lookup keys.");
        }
        prisma.seedThreadRoute({
          channel: "linq",
          containerMemberId: "member_prepared_container",
          ownerMemberId: "member_prepared_owner",
          threadIdentityLookupKey,
          threadLookupKey,
        });
        return {
          ensure: {
            activationEventId: "member.activated:prepared",
            activationMailboxItemId: "mailbox_activation_prepared",
            containerMemberId: "member_prepared_container",
            created: true,
            demotedMailboxConsumedAt: null,
          },
          kind: "ensured",
          ownerMemberId: "member_prepared_owner",
          ownerResolution: "pending_only_candidate",
          pendingSetupApplied: true,
          pendingSetupResolution: "only_candidate",
        } as never;
      });

    const plan = await planHostedOnboardingLinqWebhook({
      event: buildLinqMessageReceivedEvent({}),
      pendingGroupParticipantMemberIds: ["member_prepared_owner"],
      prisma: prisma as never,
    });

    expect(plan.response).toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-thread-route",
    });
    expect(
      preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      fallbackOwnerMemberId: null,
      participantMemberIds: ["member_prepared_owner"],
      senderMemberId: null,
    }));
    expect(readSingleWakeHandoff(plan)).toMatchObject({
      userId: "member_prepared_container",
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "conversation.message",
        message: expect.objectContaining({
          linqMessage: expect.objectContaining({
            from: "+15551112222",
          }),
        }),
        userId: "member_prepared_container",
      }),
      tx: prisma,
    });
  });

'''
if test_name not in tests:
    if marker not in tests:
        raise SystemExit("regression test insertion marker not found")
    tests = tests.replace(marker, regression + marker, 1)
test_path.write_text(tests)
