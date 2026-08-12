import type { PrismaClient } from "@prisma/client";
import {
  HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
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
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The current-sender Assistant Ask proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "current-sender Assistant Ask privacy with PostgreSQL",
  () => {
    it("binds one exact group input to one reviewed private-runtime answer", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          priorQuestion:
            "Murph, continue this older synthetic request privately.",
          prisma,
          question: "Murph, answer this fresh synthetic request in the group.",
        });
        await expect(countSenderDisclosureGrants({ fixture, prisma }))
          .resolves.toBe(0);

        const requestId =
          createHostedGroupCurrentSenderAssistantAskRequestId({
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

        const requestWake = await readHostedMailboxWakeByItemId({
          availableAt: now,
          mailboxItemId: requestId,
          prisma,
        });
        if (!requestWake || !isHostedExecutionAssistantAskRequestedWake(requestWake)) {
          throw new Error("Expected the persisted current-sender request wake.");
        }
        expect(fixture.priorAssistantInputId).not.toBeNull();
        expect(fixture.priorAssistantInputId).not.toBe(
          fixture.assistantInputId,
        );
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
        if (requestWake.ask.target.kind !== "group_sender") {
          throw new Error("Expected a current-sender Assistant Ask target.");
        }
        expect(requestWake.ask.target.permissionDigest).toMatch(/^[a-f0-9]{64}$/u);

        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: fixture.origin,
          prisma,
        })).resolves.toEqual(expectedAdmission);
        await expect(requestHostedGroupCurrentSenderAssistantAsk({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          now,
          origin: {
            ...fixture.origin,
            sessionId: `${fixture.origin.sessionId}-changed`,
          },
          prisma,
        })).resolves.toEqual({
          mailboxWake: null,
          result: {
            status: "unavailable",
            unavailableReason: "request_conflict",
          },
        });

        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: { action: "prepare", requestId },
        })).resolves.toEqual({
          mailboxWake: null,
          response: {
            action: "prepare",
            disclosure: {
              permissionText:
                HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
            },
            question: fixture.question,
            status: "ready",
            targetLabel: null,
          },
        });

        const completionId = createHostedAssistantAskCompletionId(requestId);
        const answer = "Your recent private sleep history shows inconsistent timing.";
        const expectedCompletionWake = {
          expectedUserId: fixture.groupRuntimeMemberId,
          mailboxItemId: completionId,
        };
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: {
            action: "complete",
            requestId,
            responseDestination: "group",
            result: {
              answer,
              outcome: "answered",
            },
          },
        })).resolves.toEqual({
          mailboxWake: expectedCompletionWake,
          response: { action: "complete", status: "completed" },
        });

        const completionWake = await readHostedMailboxWakeByItemId({
          availableAt: now,
          mailboxItemId: completionId,
          prisma,
        });
        if (!completionWake || !isHostedExecutionAssistantAskCompletedWake(completionWake)) {
          throw new Error("Expected the persisted current-sender completion wake.");
        }
        expect(completionWake).toMatchObject({
          ask: {
            expiresAt: requestWake.ask.expiresAt,
            origin: fixture.origin,
            question: fixture.question,
            requestId,
            result: {
              answer,
              outcome: "answered",
            },
            targetLabel: null,
          },
          eventId: completionId,
          userId: fixture.groupRuntimeMemberId,
        });
        await expect(handleHostedRuntimeAssistantAskControl({
          boundRuntimeMemberId: fixture.senderMemberId,
          now,
          prisma,
          request: {
            action: "complete",
            requestId,
            responseDestination: "group",
            result: {
              answer,
              outcome: "answered",
            },
          },
        })).resolves.toEqual({
          mailboxWake: expectedCompletionWake,
          response: { action: "complete", status: "already_completed" },
        });
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: [requestId, completionId] } },
        })).resolves.toBe(2);

        const deliveryInput = {
          answeredMailboxItemIds: [completionId],
          assistantAskCompletionExpiresAt: completionWake.ask.expiresAt,
          boundRuntimeMemberId: fixture.groupRuntimeMemberId,
          idempotencyKey:
            createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
              completionId,
            ),
          now,
        };
        await expect(prisma.$transaction((tx) =>
          assertHostedAssistantAskCompletionDeliveryAuthorityTx({
            ...deliveryInput,
            assistantAskFallback: false,
            tx,
          })
        )).resolves.toBeUndefined();
        await expect(prisma.$transaction((tx) =>
          assertHostedAssistantAskCompletionDeliveryAuthorityTx({
            ...deliveryInput,
            boundRuntimeMemberId: fixture!.senderMemberId,
            assistantAskFallback: false,
            tx,
          })
        )).rejects.toThrow();

        await expect(countSenderDisclosureGrants({ fixture, prisma }))
          .resolves.toBe(0);

        await prisma.hostedThreadRoute.deleteMany({
          where: {
            channel: "telegram",
            containerMemberId: fixture.groupRuntimeMemberId,
          },
        });
        await expect(prisma.$transaction((tx) =>
          assertHostedAssistantAskCompletionDeliveryAuthorityTx({
            ...deliveryInput,
            assistantAskFallback: false,
            tx,
          })
        )).resolves.toEqual({ assistantAskFallbackRequired: true });
        await expect(prisma.$transaction((tx) =>
          assertHostedAssistantAskCompletionDeliveryAuthorityTx({
            ...deliveryInput,
            assistantAskFallback: true,
            tx,
          })
        )).resolves.toBeUndefined();
        await expect(countSenderDisclosureGrants({ fixture, prisma }))
          .resolves.toBe(0);
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({
            fixture,
            prisma,
          });
        }
        await prisma.$disconnect();
      }
    }, 60_000);

    it("serializes canonical and legacy audience admissions to one origin row", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          prisma,
          question: "Murph, send this synthetic answer to the group.",
        });
        const requestIds = readHostedGroupCurrentSenderAssistantAskRequestIds({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        });
        const admissions = await Promise.all([
          requestHostedGroupCurrentSenderAssistantAsk({
            groupRuntimeMemberId: fixture.groupRuntimeMemberId,
            now,
            origin: fixture.origin,
            prisma,
          }),
          requestHostedGroupCurrentSenderAssistantAsk({
            groupRuntimeMemberId: fixture.groupRuntimeMemberId,
            legacyResponseDestination: "group",
            now,
            origin: fixture.origin,
            prisma,
          }),
          requestHostedGroupCurrentSenderAssistantAsk({
            groupRuntimeMemberId: fixture.groupRuntimeMemberId,
            legacyResponseDestination: "current_sender",
            now,
            origin: fixture.origin,
            prisma,
          }),
        ]);
        const acceptedAdmissions = admissions.filter(
          (admission) => admission.result.status === "accepted",
        );
        const rejectedAdmissions = admissions.filter(
          (admission) => admission.result.status === "unavailable",
        );
        expect(acceptedAdmissions).toHaveLength(1);
        expect(rejectedAdmissions).toHaveLength(2);
        for (const admission of rejectedAdmissions) {
          expect(admission).toEqual({
            mailboxWake: null,
            result: {
              status: "unavailable",
              unavailableReason: "request_conflict",
            },
          });
        }
        const admittedRequestId = acceptedAdmissions[0]?.mailboxWake?.mailboxItemId;
        expect(acceptedAdmissions[0]?.mailboxWake?.expectedUserId).toBe(
          fixture.senderMemberId,
        );
        expect(admittedRequestId).toBeTypeOf("string");
        expect(requestIds).toContain(admittedRequestId);
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: [...requestIds] } },
        })).resolves.toBe(1);
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({ fixture, prisma });
        }
        await prisma.$disconnect();
      }
    }, 60_000);

    it("persists exactly one terminal audience under competing completions", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const now = new Date();
      let fixture: HostedCurrentSenderAssistantAskFixture | null = null;

      try {
        fixture = await seedHostedCurrentSenderAssistantAskFixture({
          now,
          prisma,
          question: "Murph, send a synthetic response to exactly one audience.",
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
          mailboxWake: { mailboxItemId: requestId },
          result: { status: "accepted" },
        });

        const answer = "Synthetic reviewed answer.";
        const completions = await Promise.all([
          handleHostedRuntimeAssistantAskControl({
            boundRuntimeMemberId: fixture.senderMemberId,
            now,
            prisma,
            request: {
              action: "complete",
              requestId,
              responseDestination: "group",
              result: { answer, outcome: "answered" },
            },
          }),
          handleHostedRuntimeAssistantAskControl({
            boundRuntimeMemberId: fixture.senderMemberId,
            now,
            prisma,
            request: {
              action: "complete",
              requestId,
              responseDestination: "current_sender",
              result: { answer, outcome: "answered" },
            },
          }),
        ]);
        expect(
          completions.map((completion) => completion.response.status).sort(),
        ).toEqual(["completed", "terminal"]);
        const completed = completions.find(
          (completion) => completion.response.status === "completed",
        );
        const rejected = completions.find(
          (completion) => completion.response.status === "terminal",
        );
        expect(completed?.mailboxWake).not.toBeNull();
        expect(rejected).toEqual({
          mailboxWake: null,
          response: {
            action: "complete",
            status: "terminal",
            terminalReason: "unavailable",
          },
        });

        const completionIds = readHostedGroupCurrentSenderAssistantAskRequestIds({
          groupRuntimeMemberId: fixture.groupRuntimeMemberId,
          originAssistantInputId: fixture.assistantInputId,
        }).map((requestId) => createHostedAssistantAskCompletionId(requestId));
        await expect(prisma.hostedMailboxItem.count({
          where: { id: { in: completionIds } },
        })).resolves.toBe(1);
        const persistedCompletion = await prisma.hostedMailboxItem.findFirst({
          select: { kind: true, userId: true },
          where: { id: { in: completionIds } },
        });
        expect(persistedCompletion?.kind).toMatch(
          /^assistant\.(ask\.completed|notification\.requested)$/u,
        );
        expect([
          fixture.groupRuntimeMemberId,
          fixture.senderMemberId,
        ]).toContain(persistedCompletion?.userId);
      } finally {
        if (fixture) {
          await deleteHostedCurrentSenderAssistantAskFixture({ fixture, prisma });
        }
        await prisma.$disconnect();
      }
    }, 60_000);
  },
);

async function countSenderDisclosureGrants(input: {
  fixture: HostedCurrentSenderAssistantAskFixture;
  prisma: PrismaClient;
}): Promise<number> {
  return input.prisma.hostedGroupDisclosureGrant.count({
    where: {
      membership: {
        memberId: input.fixture.senderMemberId,
      },
    },
  });
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
