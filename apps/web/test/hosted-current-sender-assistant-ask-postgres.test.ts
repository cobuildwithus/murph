import {
  HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
} from "@murphai/hosted-execution/contracts";
import {
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  isHostedExecutionAssistantAskCompletedWake,
  isHostedExecutionAssistantAskRequestedWake,
} from "@murphai/hosted-execution";
import { describe, expect, it } from "vitest";

import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
  createHostedAssistantAskCompletionId,
  handleHostedRuntimeAssistantAskControl,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  createHostedGroupCurrentSenderAssistantAskRequestId,
  readHostedGroupCurrentSenderAssistantAskRequestIds,
  requestHostedGroupCurrentSenderAssistantAsk,
} from "@/src/lib/hosted-groups/group-current-sender-assistant-ask";
import {
  readHostedMailboxWakeByItemId,
} from "@/src/lib/hosted-mailbox/store";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  deleteHostedCurrentSenderAssistantAskFixture,
  seedHostedCurrentSenderAssistantAskFixture,
  type HostedCurrentSenderAssistantAskFixture,
} from "./support/hosted-current-sender-assistant-ask-fixture";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error(
    "The current-sender Assistant Ask proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "current-sender Assistant Ask privacy with PostgreSQL",
  () => {
    it("binds a mixed-sender batch to the exact flat author and replays one group terminal", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          priorFromDifferentSender: true,
          priorQuestion: "Synthetic participant reply.",
          priorReplyContextPreview: "Synthetic earlier participant message.",
          prisma,
          question: "Murph, ask my Murph how my synthetic activity has changed?",
        });
        if (!fixture.priorAssistantInputId || !fixture.priorSenderMemberId) {
          throw new Error("Expected a second synthetic participant.");
        }

        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: {
            assistantInputId: fixture.priorAssistantInputId,
            kind: "accepted_input",
            sessionId: "session_prior_participant",
          },
          prisma,
        })).resolves.toMatchObject({
          mailboxWake: null,
          result: { status: "unavailable" },
        });

        const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        });
        const expectedAdmission = {
          mailboxWake: {
            expectedUserId: fixture.senderMemberId,
            mailboxItemId: requestId,
          },
          result: { status: "accepted" as const },
        };
        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: fixture.origin,
          prisma,
        })).resolves.toEqual(expectedAdmission);
        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: fixture.origin,
          prisma,
        })).resolves.toEqual(expectedAdmission);

        const requestWake = await readHostedMailboxWakeByItemId({
          availableAt: now,
          mailboxItemId: requestId,
          prisma,
        });
        if (!requestWake || !isHostedExecutionAssistantAskRequestedWake(requestWake)) {
          throw new Error("Expected the persisted current-sender request wake.");
        }
        expect(requestWake).toMatchObject({
          ask: {
            origin: fixture.origin,
            question: fixture.question,
            target: {
              groupRuntimeMemberId: fixture.groupRuntimeMemberId,
              kind: "group_sender",
            },
          },
          eventId: requestId,
          userId: fixture.senderMemberId,
        });

        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: { action: "prepare", requestId },
        })).resolves.toMatchObject({
          response: {
            disclosure: {
              permissionText: HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
            },
            status: "ready",
          },
        });

        const result = {
          answer: "Synthetic activity increased.",
          outcome: "answered" as const,
        };
        const completionId = createHostedAssistantAskCompletionId(requestId);
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: { action: "complete", requestId, result },
        })).resolves.toEqual({
          mailboxWake: {
            expectedUserId: fixture.groupRuntimeMemberId,
            mailboxItemId: completionId,
          },
          response: { action: "complete", status: "completed" },
        });
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: { action: "complete", requestId, result },
        })).resolves.toMatchObject({
          response: { status: "already_completed" },
        });

        const completionWake = await readHostedMailboxWakeByItemId({
          availableAt: now,
          mailboxItemId: completionId,
          prisma,
        });
        if (!completionWake || !isHostedExecutionAssistantAskCompletedWake(completionWake)) {
          throw new Error("Expected one persisted group completion.");
        }
        expect(completionWake.ask.result).toEqual(result);
        await expect(prisma.$transaction((tx) =>
          assertHostedAssistantAskCompletionDeliveryAuthorityTx({
            answeredMailboxItemIds: [completionId],
            assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
            assistantAskFallback: false,
            boundRuntimeMemberId: fixture!.groupRuntimeMemberId,
            idempotencyKey:
              createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
                completionId,
              ),
            now,
            tx,
          })
        )).resolves.toBeUndefined();
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: [requestId, completionId] } },
        })).resolves.toBe(2);
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({ fixture, prisma });
        }
        await prisma.$disconnect();
      }
    }, 60_000);

    it("rejects a private request before enqueue when its same-channel direct route is missing", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          prisma,
          question: "Murph, ask my Murph about my synthetic activity and DM me.",
        });
        await prisma.hostedMemberRouting.deleteMany({
          where: { memberId: fixture.senderMemberId },
        });

        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: fixture.origin,
          prisma,
        })).resolves.toMatchObject({
          mailboxWake: null,
          result: { status: "unavailable" },
        });

        const requestIds = readHostedGroupCurrentSenderAssistantAskRequestIds({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        });
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: [...requestIds] } },
        })).resolves.toBe(0);
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({ fixture, prisma });
        }
        await prisma.$disconnect();
      }
    }, 60_000);

    it("persists one non-disclosing group completion when an admitted private route is lost", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          prisma,
          question: "Murph, ask my Murph how my synthetic activity changed and DM me.",
        });
        const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        });
        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: fixture.origin,
          prisma,
        })).resolves.toMatchObject({
          mailboxWake: {
            expectedUserId: fixture.senderMemberId,
            mailboxItemId: requestId,
          },
          result: { status: "accepted" },
        });
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: { action: "prepare", requestId },
        })).resolves.toMatchObject({
          response: {
            disclosure: {
              permissionText: HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
            },
            status: "ready",
          },
        });

        await prisma.hostedMemberRouting.deleteMany({
          where: { memberId: fixture.senderMemberId },
        });
        const completionId = createHostedAssistantAskCompletionId(requestId);
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: {
            action: "complete",
            requestId,
            result: {
              answer: "Synthetic private answer that must not fall back.",
              outcome: "answered",
            },
          },
        })).resolves.toEqual({
          mailboxWake: {
            expectedUserId: fixture.groupRuntimeMemberId,
            mailboxItemId: completionId,
          },
          response: { action: "complete", status: "completed" },
        });

        const completionWake = await readHostedMailboxWakeByItemId({
          availableAt: now,
          mailboxItemId: completionId,
          prisma,
        });
        if (!completionWake || !isHostedExecutionAssistantAskCompletedWake(completionWake)) {
          throw new Error("Expected the persisted private-route-loss completion.");
        }
        expect(completionWake).toMatchObject({
          ask: {
            requestId,
            result: { answer: null, outcome: "cannot_answer" },
          },
          userId: fixture.groupRuntimeMemberId,
        });
        expect(JSON.stringify(completionWake)).not.toContain(
          "Synthetic private answer that must not fall back.",
        );
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: { action: "prepare", requestId },
        })).resolves.toMatchObject({
          response: { status: "already_completed" },
        });
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({ fixture, prisma });
        }
        await prisma.$disconnect();
      }
    }, 60_000);

    it("serializes concurrent admission and completion to one canonical request and terminal", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 6 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          prisma,
          question: "Murph, ask my Murph for one synthetic group answer.",
        });
        const requestId = createHostedGroupCurrentSenderAssistantAskRequestId({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        });
        const admissions = await Promise.all(
          Array.from({ length: 4 }, () =>
            requestHostedGroupCurrentSenderAssistantAsk({
              groupRuntimeMemberId: fixture!.groupRuntimeMemberId,
              now,
              origin: fixture!.origin,
              prisma,
            })
          ),
        );
        expect(admissions).toHaveLength(4);
        expect(admissions.every((admission) =>
          admission.result.status === "accepted"
          && admission.mailboxWake?.mailboxItemId === requestId
        )).toBe(true);
        const requestIds = readHostedGroupCurrentSenderAssistantAskRequestIds({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        });
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: [...requestIds] } },
        })).resolves.toBe(1);

        const result = {
          answer: "One synthetic answer.",
          outcome: "answered" as const,
        };
        const completions = await Promise.all(
          Array.from({ length: 4 }, () =>
            handleHostedRuntimeAssistantAskControl({
              boundRuntimeMemberId: fixture!.senderMemberId,
              now,
              prisma,
              request: { action: "complete", requestId, result },
            })
          ),
        );
        expect(completions.filter(
          (completion) => completion.response.status === "completed",
        )).toHaveLength(1);
        expect(completions.filter(
          (completion) => completion.response.status === "already_completed",
        )).toHaveLength(3);
        const completionIds = requestIds.map(
          (candidate) => createHostedAssistantAskCompletionId(candidate),
        );
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: completionIds } },
        })).resolves.toBe(1);
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({ fixture, prisma });
        }
        await prisma.$disconnect();
      }
    }, 60_000);
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
