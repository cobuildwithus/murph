from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, before: str, after: str, label: str) -> None:
    content = read(path)
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor in {path}, found {count}")
    write(path, content.replace(before, after, 1))


def insert_before(path: str, anchor: str, addition: str, label: str) -> None:
    content = read(path)
    count = content.count(anchor)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor in {path}, found {count}")
    write(path, content.replace(anchor, addition + anchor, 1))


def run(*command: str) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def repair_refinement_generator() -> None:
    path = "scripts/agent-refine-linq-unknown-group-recovery.mjs"
    before = '    `${window.location.pathname}${window.location.search}`,\n'
    after = r'    \`\${window.location.pathname}\${window.location.search}\`,' + "\n"
    replace_once(path, before, after, "escape nested group-start template")
    run("node", "--check", path)


def scope_finalizer_to_new_group_planner() -> None:
    path = "scripts/agent-finalize-linq-unknown-group-recovery.py"
    lines = read(path).splitlines()
    label_index = next(
        index
        for index, line in enumerate(lines)
        if '"require exact pending group authority",' in line
    )
    start = label_index
    while start >= 0 and lines[start] != "replace_once(":
        start -= 1
    end = label_index
    while end < len(lines) and lines[end] != ")":
        end += 1
    if start < 0 or end >= len(lines):
        raise RuntimeError("Could not isolate pending-group audit block")

    replacement = [
        "replace_once(",
        "    provider_path,",
        "    '''  const pendingSenderLookup = senderLookup",
        "    ? null",
        "    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({",
        "        contact: participantContact,",
        "        prisma: input.prisma,",
        "      });",
        "  const sender = senderLookup?.core ?? pendingSenderLookup?.core ?? null;''',",
        "    '''  const pendingSenderLookup = senderLookup",
        "    ? null",
        "    : await lookupHostedMemberRoutingByPendingLinqParticipantContact({",
        "        contact: participantContact,",
        "        linqChatId: summary.chatId,",
        "        prisma: input.prisma,",
        "        recipientPhone: incomingRecipientPhone,",
        "      });",
        "  const sender = senderLookup?.core ?? pendingSenderLookup?.core ?? null;''',",
        '    "require exact pending group authority",',
        ")",
    ]
    lines[start : end + 1] = replacement
    write(path, "\n".join(lines) + "\n")


def harden_recovery_route() -> None:
    path = "apps/web/app/api/groups/start/recover/route.ts"
    replace_once(
        path,
        '''import {
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";''',
        '''import {
  acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";''',
        "import member routing lock",
    )
    replace_once(
        path,
        '''import { acquireHostedLinqChatOwnershipLockTx } from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
''',
        "",
        "remove reversed chat lock",
    )
    replace_once(
        path,
        '''  const status = await prisma.$transaction(async (tx) => {
    await acquireHostedLinqChatOwnershipLockTx({
      chatId: recovery.chatId,
      tx,
    });''',
        '''  const status = await prisma.$transaction(async (tx) => {
    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId: session.member.id,
      prisma: tx,
    });''',
        "follow existing member-to-chat lock order",
    )


def harden_recovery_route_tests() -> None:
    path = "apps/web/test/hosted-group-start-recovery-route.test.ts"
    replace_once(
        path,
        '''const mocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),''',
        '''const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),''',
        "mock member routing lock",
    )
    replace_once(
        path,
        '''vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,''',
        '''vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRouteLockTx:
    mocks.acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,''',
        "export mocked member routing lock",
    )
    replace_once(
        path,
        '''vi.mock("@/src/lib/hosted-routing/linq-chat-ownership-lock", () => ({
  acquireHostedLinqChatOwnershipLockTx:
    mocks.acquireHostedLinqChatOwnershipLockTx,
}));
''',
        "",
        "remove chat-lock mock",
    )
    replace_once(
        path,
        '''  mocks.acquireHostedLinqChatOwnershipLockTx.mockResolvedValue(undefined);''',
        '''  mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);''',
        "initialize member routing lock",
    )
    replace_once(
        path,
        '''  expect(mocks.acquireHostedLinqChatOwnershipLockTx).toHaveBeenCalledWith({
    chatId: recovery.chatId,
    tx,
  });''',
        '''  expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).toHaveBeenCalledWith({
    memberId: "member_existing",
    prisma: tx,
  });''',
        "assert member routing lock",
    )


def add_private_recovery_capacity() -> None:
    path = "apps/web/src/lib/hosted-onboarding/webhook-transport.ts"
    replace_once(
        path,
        '''import {
  readHostedLinqHomeLineAuthority,
  reserveHostedLinqHealthyProactiveLineTx,
} from "./linq-home-routing";''',
        '''import {
  readHostedLinqHomeLineAuthority,
  reserveHostedLinqHealthyProactiveLineTx,
  startOfUtcDay,
} from "./linq-home-routing";''',
        "import UTC capacity boundary",
    )
    replace_once(
        path,
        '''import {
  listHostedLinqHealthyProactiveLines,
  readHostedLinqIncomingLineState,
  readHostedLinqReceiptCorrelatedRecoveryLineTx,
} from "./linq-line-store";''',
        '''import {
  claimHostedLinqProactiveConversationCapacityTx,
  listHostedLinqHealthyProactiveLines,
  readHostedLinqIncomingLineState,
  readHostedLinqReceiptCorrelatedRecoveryLineTx,
} from "./linq-line-store";''',
        "import proactive capacity claim",
    )
    insert_before(
        path,
        '''import { lockHostedMemberRow } from "./shared";
''',
        '''import { resolveHostedLinqSignupWelcomeDailyLimit } from "./linq-routing-policy";
''',
        "import shared proactive limit",
    )
    replace_once(
        path,
        '''    let dispatchEffect = input.effect;
    let dispatchSourceRef = input.effect.effectId;
    let recoveryCapacityClaimed = false;''',
        '''    let dispatchEffect = input.effect;
    let dispatchSourceRef = input.effect.effectId;
    let groupEmailRecoveryCapacityClaimed = false;
    let recoveryCapacityClaimed = false;''',
        "track private recovery capacity",
    )
    replace_once(
        path,
        '''      if (incomingLineState.kind !== "assignable") {
        return { status: "target_unauthorized" };
      }
    }

    const template = dispatchEffect.payload.template;''',
        '''      if (incomingLineState.kind !== "assignable") {
        return { status: "target_unauthorized" };
      }
      const persistedRecoveryIntent =
        await readHostedLinqDeliveryProviderDispatchIntentTx({
          idempotencyKey: groupEmailRecoveryEffect.effectId,
          prisma,
        });
      if (!persistedRecoveryIntent) {
        const line = await prisma.hostedLinqLine.findUnique({
          select: {
            maxNewConversationsPerDay: true,
          },
          where: {
            phoneNumberLookupKey: incomingLineState.phoneNumberLookupKey,
          },
        });
        if (
          !line
          || !await claimHostedLinqProactiveConversationCapacityTx({
            dayUtc: startOfUtcDay(new Date(input.startedAtMs)),
            limit: resolveHostedLinqSignupWelcomeDailyLimit(line),
            phoneNumberLookupKey: incomingLineState.phoneNumberLookupKey,
            prisma,
          })
        ) {
          return { status: "target_unauthorized" };
        }
        groupEmailRecoveryCapacityClaimed = true;
      }
    }

    const template = dispatchEffect.payload.template;''',
        "claim private recovery capacity once",
    )
    replace_once(
        path,
        '''    if (recoveryCapacityClaimed && !claim.claimed) {
      throw new Error(
        "Hosted Linq group-line recovery delivery conflicted after reserving line capacity.",
      );
    }''',
        '''    if (
      (recoveryCapacityClaimed || groupEmailRecoveryCapacityClaimed)
      && !claim.claimed
    ) {
      throw new Error(
        "Hosted Linq recovery delivery conflicted after reserving line capacity.",
      );
    }''',
        "rollback capacity on dispatch conflict",
    )


def add_private_recovery_capacity_tests() -> None:
    path = "apps/web/test/hosted-onboarding-linq-transport.test.ts"
    replace_once(
        path,
        '''const transportBoundaryMocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),''',
        '''const transportBoundaryMocks = vi.hoisted(() => ({
  acquireHostedLinqChatOwnershipLockTx: vi.fn(),
  claimHostedLinqProactiveConversationCapacityTx: vi.fn(),''',
        "mock proactive capacity",
    )
    replace_once(
        path,
        '''vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  listHostedLinqHealthyProactiveLines:''',
        '''vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  claimHostedLinqProactiveConversationCapacityTx:
    transportBoundaryMocks.claimHostedLinqProactiveConversationCapacityTx,
  listHostedLinqHealthyProactiveLines:''',
        "export proactive capacity mock",
    )
    insert_before(
        path,
        '''    transportBoundaryMocks.acquireHostedMemberHomeLinqRouteLockTx
      .mockResolvedValue(undefined);''',
        '''    transportBoundaryMocks.claimHostedLinqProactiveConversationCapacityTx
      .mockResolvedValue(true);
''',
        "initialize proactive capacity mock",
    )
    insert_before(
        path,
        '''  it("revalidates a verified email participant before private recovery", async () => {
''',
        '''  it("claims one new-conversation slot before private group email recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const assignedRecipientPhone = "+15550100000";
    const participantEmail = "member@icloud.test";
    const lineLookupKey = createHostedPhoneLookupKey(assignedRecipientPhone);
    if (!lineLookupKey) {
      throw new Error("Expected private recovery line lookup key.");
    }
    transportBoundaryMocks.readHostedLinqIncomingLineState.mockResolvedValueOnce({
      kind: "assignable",
      phoneNumberLookupKey: lineLookupKey,
    });
    const transactionClient = {
      hostedLinqLine: {
        findUnique: vi.fn().mockResolvedValue({
          maxNewConversationsPerDay: 7,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (
        operation: (tx: typeof transactionClient) => Promise<unknown>,
      ) => operation(transactionClient)),
      hostedLinqLine: transactionClient.hostedLinqLine,
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      assignedRecipientPhone,
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "email",
        value: participantEmail,
      },
      recoveryToken: "sealed-recovery-token",
      sourceEventId: "event-group-email-recovery",
      template: "group_email_recovery",
      threadId: "chat-group-email-recovery",
    });

    try {
      await expect(drainHostedLinqSideEffectsDirect({
        prisma: prisma as never,
        sideEffects: [effect],
      })).resolves.toEqual({ sentCount: 1, skipped: [] });

      expect(transactionClient.hostedLinqLine.findUnique).toHaveBeenCalledWith({
        select: { maxNewConversationsPerDay: true },
        where: { phoneNumberLookupKey: lineLookupKey },
      });
      expect(
        transportBoundaryMocks.claimHostedLinqProactiveConversationCapacityTx,
      ).toHaveBeenCalledWith({
        dayUtc: new Date("2026-03-26T00:00:00.000Z"),
        limit: 7,
        phoneNumberLookupKey: lineLookupKey,
        prisma: transactionClient,
      });
      expect(createHostedLinqChat).toHaveBeenCalledWith({
        from: assignedRecipientPhone,
        idempotencyKey: effect.effectId,
        message: expect.stringContaining("#recover="),
        signal: undefined,
        to: [participantEmail],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start private group email recovery when line capacity is exhausted", async () => {
    const assignedRecipientPhone = "+15550100000";
    const lineLookupKey = createHostedPhoneLookupKey(assignedRecipientPhone);
    if (!lineLookupKey) {
      throw new Error("Expected private recovery line lookup key.");
    }
    transportBoundaryMocks.readHostedLinqIncomingLineState.mockResolvedValueOnce({
      kind: "assignable",
      phoneNumberLookupKey: lineLookupKey,
    });
    transportBoundaryMocks.claimHostedLinqProactiveConversationCapacityTx
      .mockResolvedValueOnce(false);
    const transactionClient = {
      hostedLinqLine: {
        findUnique: vi.fn().mockResolvedValue({
          maxNewConversationsPerDay: 1,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (
        operation: (tx: typeof transactionClient) => Promise<unknown>,
      ) => operation(transactionClient)),
      hostedLinqLine: transactionClient.hostedLinqLine,
    };
    const effect = createHostedWebhookLinqMessageSideEffect({
      assignedRecipientPhone,
      occurredAt: "2026-03-26T12:00:00.000Z",
      participantContact: {
        kind: "email",
        value: "member@icloud.test",
      },
      recoveryToken: "sealed-recovery-token",
      sourceEventId: "event-group-email-recovery-exhausted",
      template: "group_email_recovery",
      threadId: "chat-group-email-recovery",
    });

    await expect(drainHostedLinqSideEffectsDirect({
      prisma: prisma as never,
      sideEffects: [effect],
    })).resolves.toEqual({
      sentCount: 0,
      skipped: [{
        effectId: effect.effectId,
        reason: "notice_target_unauthorized",
        template: "group_email_recovery",
      }],
    });

    expect(claimHostedLinqDeliveryProviderDispatchTx).not.toHaveBeenCalled();
    expect(createHostedLinqChat).not.toHaveBeenCalled();
  });

''',
        "test private recovery capacity",
    )


def update_plan_for_capacity() -> None:
    path = "agent-docs/exec-plans/completed/2026-07-31-unknown-linq-group-setup-recovery.md"
    replace_once(
        path,
        '''- For an unknown iMessage email sender, send a private 24-hour encrypted
  recovery link from the same healthy managed line. Keep its bearer token in the
  URL fragment so it does not enter request logs or referrers.''',
        '''- For an unknown iMessage email sender, send a private 24-hour encrypted
  recovery link from the same healthy managed line. Keep its bearer token in the
  URL fragment so it does not enter request logs or referrers. Reuse the line's
  existing daily new-conversation capacity counter before starting that private
  chat; retries with a persisted delivery intent do not reserve capacity again.''',
        "document private recovery capacity",
    )


def main() -> None:
    repair_refinement_generator()
    run("node", "scripts/agent-refine-linq-unknown-group-recovery.mjs")
    scope_finalizer_to_new_group_planner()
    run("python", "scripts/agent-finalize-linq-unknown-group-recovery.py")
    harden_recovery_route()
    harden_recovery_route_tests()
    add_private_recovery_capacity()
    add_private_recovery_capacity_tests()
    update_plan_for_capacity()


if __name__ == "__main__":
    main()
