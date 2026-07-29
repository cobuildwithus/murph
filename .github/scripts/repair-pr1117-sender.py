from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} did not match expected PR head")
    return text.replace(old, new, 1)


def replace_inside_test(text: str, title: str, old: str, new: str) -> str:
    start = text.find(title)
    if start < 0:
        raise SystemExit(f"test not found: {title}")
    end = text.find("\n  it(", start + len(title))
    if end < 0:
        end = len(text)
    section = text[start:end]
    if old not in section:
        raise SystemExit(f"expected content missing in: {title}")
    return text[:start] + section.replace(old, new, 1) + text[end:]


planner_path = Path("apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts")
planner = planner_path.read_text()
planner = replace_once(
    planner,
    '''  const activeSenderMemberId = sender
    && !isHostedMemberSuspended(sender.suspendedAt)
    && (await readHostedRuntimeAiAccessDecision({
      memberId: sender.id,
      prisma: input.prisma,
    })).allowed
      ? sender.id
      : null;

  let createdContainerMemberId: string | null = null;
''',
    '''  const activeSenderMemberId = sender
    && !isHostedMemberSuspended(sender.suspendedAt)
    && (await readHostedRuntimeAiAccessDecision({
      memberId: sender.id,
      prisma: input.prisma,
    })).allowed
      ? sender.id
      : null;
  const pendingSetupParticipantMemberIds = activeSenderMemberId
    ? [...new Set([...input.participantMemberIds, activeSenderMemberId])]
    : input.participantMemberIds;

  let createdContainerMemberId: string | null = null;
''',
    "sender candidate insertion",
)
planner = replace_once(
    planner,
    "      participantMemberIds: input.participantMemberIds,\n",
    "      participantMemberIds: pendingSetupParticipantMemberIds,\n",
    "prepared route candidates",
)
planner_path.write_text(planner)


test_path = Path("apps/web/test/hosted-onboarding-linq-thread-route.test.ts")
tests = test_path.read_text()
tests = replace_once(
    tests,
    '  it("does not select ownership from a partial oversized roster", async () => {',
    '  it("limits oversized-roster setup matching to the authenticated sender", async () => {',
    "oversized roster test title",
)
tests = replace_inside_test(
    tests,
    '  it("limits oversized-roster setup matching to the authenticated sender", async () => {',
    '''    ).toHaveBeenCalledWith(expect.objectContaining({
      participantMemberIds: [],
      senderMemberId: "member_owner_123",
    }));
''',
    '''    ).toHaveBeenCalledWith(expect.objectContaining({
      participantMemberIds: ["member_owner_123"],
      senderMemberId: "member_owner_123",
    }));
''',
)
tests = replace_inside_test(
    tests,
    '  it("still provisions and hands off the first group message when roster fetch fails", async () => {',
    '''      expect(response).toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
      expect(prisma.hostedThreadContainerParticipant.upsert).not.toHaveBeenCalled();
''',
    '''      expect(response).toMatchObject({
        ignored: false,
        ok: true,
        reason: "wake-appended-thread-route",
      });
      expect(
        preparedThreadMocks.ensureHostedPreparedLinqThreadContainerRouteTx,
      ).toHaveBeenCalledWith(expect.objectContaining({
        fallbackOwnerMemberId: "member_owner_123",
        participantMemberIds: ["member_owner_123"],
        senderMemberId: "member_owner_123",
      }));
      expect(prisma.hostedThreadContainerParticipant.upsert).not.toHaveBeenCalled();
''',
)
test_path.write_text(tests)
