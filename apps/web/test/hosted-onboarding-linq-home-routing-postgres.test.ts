import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
  readHostedConversationAssistantIdentifierSecret,
} from "@murphai/hosted-execution/assistant-identifiers";
import { describe, expect, it, vi } from "vitest";

import {
  handleHostedRuntimeIMessageContactTool,
} from "@/src/lib/hosted-execution/imessage-contact-tool";
import {
  claimHostedLinqProactiveConversationCapacityTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import {
  appendHostedMailboxEnvelopeWithSourceMessageTx,
  appendHostedMailboxEnvelopeTx,
  appendHostedMailboxItemTx,
  HostedMailboxSourceConversationPreparationMismatchError,
  readHostedMailboxSourceConversationEntriesTx,
  readHostedMailboxSourceConversationPreparation,
} from "@/src/lib/hosted-mailbox/store";
import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  lookupHostedMemberRoutingByHomeLinqChatId,
  readHostedMemberRoutingState,
  resolveHostedMemberRoutingByTelegramUserId,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { updateHostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { encryptHostedLinqLinePhoneNumber } from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import { buildHostedMemberIdentityPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  acquireHostedLinqParticipantPhoneLockTx,
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageEditedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import {
  buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
} from "@/src/lib/hosted-onboarding/telegram";
import { planHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import { planHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/webhook-provider-telegram";
import { runHostedLinqMessageEditPreparedTransaction } from "@/src/lib/hosted-onboarding/webhook-service";
import { createPrismaClient } from "@/src/lib/prisma";

const handlerPrismaClients = vi.hoisted(() => [] as PrismaClient[]);

vi.mock("@/src/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/prisma")>();
  return {
    ...actual,
    getPrisma: () => handlerPrismaClients.shift() ?? actual.getPrisma(),
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    provisionActiveHostedDomainRootEnvelopeForUserOnly:
      vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/src/lib/hosted-mailbox/encryption", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-mailbox/encryption")
  >();
  return {
    ...actual,
    prewarmHostedMailboxPayloadActiveRoot: vi.fn().mockResolvedValue(undefined),
  };
});

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Linq home-routing concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const transactionOptions = {
  maxWait: 5_000,
  timeout: 10_000,
} as const;

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Expected the PostgreSQL contender to wait on its current owner.",
  );
}

async function acquireHostedMailboxSourceLocksForTest(input: {
  sourceMessageLookupKeys: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<void> {
  for (const sourceMessageLookupKey of [...input.sourceMessageLookupKeys].sort()) {
    await input.tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('mailbox-source-message'),
        hashtext(${sourceMessageLookupKey})
      )
    `;
  }
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Linq home-routing PostgreSQL concurrency",
  () => {
    it("serializes edits and rejects a stale prepared lineage after the winner appends", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `member_edit_serialization_${randomUUID()}`;
      const messageId = `message_edit_serialization_${randomUUID()}`;
      const sourceMessageLookupKey = requireString(
        createHostedLinqMessageLookupKey(messageId),
      );
      const sourceMessageLookupKeyReadCandidates =
        createHostedLinqMessageLookupKeyReadCandidates(messageId);
      const accountLookupKey = requireString(
        createHostedPhoneLookupKey("+15550000000"),
      );
      const contactLookupKey = requireString(
        createHostedPhoneLookupKey("+15551112222"),
      );
      const originalOccurredAt = new Date("2026-08-11T12:00:00.000Z");
      const originalWake = buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey,
        contactKind: "phone",
        contactLookupKey,
        eventId: `event_edit_serialization_original_${randomUUID()}`,
        linqMessage: {
          chatId: `chat_edit_serialization_${randomUUID()}`,
          from: "+15551112222",
          isFromMe: false,
          messageId,
          parts: [{ type: "text", value: "Original wording" }],
          service: "iMessage",
          threadIsDirect: true,
        },
        occurredAt: originalOccurredAt.toISOString(),
        phoneLookupKey: contactLookupKey,
        userId: memberId,
      });
      const correctionWake = buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey,
        contactKind: "phone",
        contactLookupKey,
        eventId: `event_edit_serialization_correction_${randomUUID()}`,
        linqMessage: {
          ...originalWake.message.linqMessage,
          editedSourceInputId: "ain_11111111111111111111111111111111",
          editedTextPartIndex: 0,
          parts: [{ type: "text", value: "Corrected wording" }],
        },
        occurredAt: new Date(originalOccurredAt.getTime() + 1).toISOString(),
        phoneLookupKey: contactLookupKey,
        userId: memberId,
      });
      const ownerLocked = createDeferred();
      const contenderPid = createDeferred<number>();
      const releaseOwner = createDeferred();
      let memberCreated = false;
      let ownerTransaction: Promise<string> | null = null;
      let contenderTransaction: Promise<unknown> | null = null;

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        memberCreated = true;
        const originalAppend = await observer.$transaction((tx) =>
          appendHostedMailboxEnvelopeWithSourceMessageTx({
            envelope: originalWake,
            sourceMessageLookupKey,
            tx,
          }), transactionOptions);
        const ownerPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma: owner,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        const contenderPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma: contender,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });

        ownerTransaction = owner.$transaction(async (tx) => {
          await expect(readHostedMailboxSourceConversationEntriesTx({
            preparation: ownerPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          })).resolves.toMatchObject([{
            itemId: originalAppend.item.id,
          }]);
          ownerLocked.resolve();
          await releaseOwner.promise;
          const correctionAppend =
            await appendHostedMailboxEnvelopeWithSourceMessageTx({
              envelope: correctionWake,
              sourceMessageLookupKey,
              tx,
            });
          return correctionAppend.item.id;
        }, transactionOptions);
        await Promise.race([
          ownerLocked.promise,
          ownerTransaction.then(() => {
            throw new Error(
              "Edit lineage owner completed before holding its source lock.",
            );
          }),
        ]);

        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          return readHostedMailboxSourceConversationEntriesTx({
            preparation: contenderPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          });
        }, transactionOptions);
        const pid = await Promise.race([
          contenderPid.promise,
          contenderTransaction.then(() => {
            throw new Error(
              "Edit lineage contender completed before exposing its backend.",
            );
          }),
        ]);
        await waitForBlockedBackend({ observer, pid });

        releaseOwner.resolve();
        const correctionItemId = await ownerTransaction;
        await expect(contenderTransaction).rejects.toBeInstanceOf(
          HostedMailboxSourceConversationPreparationMismatchError,
        );

        const freshPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma: contender,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        await expect(contender.$transaction((tx) =>
          readHostedMailboxSourceConversationEntriesTx({
            preparation: freshPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          }), transactionOptions)).resolves.toMatchObject([
          { itemId: originalAppend.item.id },
          { itemId: correctionItemId },
        ]);
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled(
          [ownerTransaction, contenderTransaction].filter(
            (transaction): transaction is Promise<unknown> =>
              transaction !== null,
          ),
        );
        if (memberCreated) {
          await observer.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([observer, owner, contender]);
      }
    });

    it("accepts three ordered edit contenders across two stale snapshots", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const firstBlocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const retryBlocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const editClients = Array.from(
        { length: 3 },
        () => createPrismaClient({ databaseUrl, poolMax: 1 }),
      );
      const memberId = `member_edit_three_contenders_${randomUUID()}`;
      const messageId = `message_edit_three_contenders_${randomUUID()}`;
      const chatId = `chat_edit_three_contenders_${randomUUID()}`;
      const sender = "+15551112222";
      const sourceMessageLookupKey = requireString(
        createHostedLinqMessageLookupKey(messageId),
      );
      const sourceMessageLookupKeyReadCandidates =
        createHostedLinqMessageLookupKeyReadCandidates(messageId);
      const accountLookupKey = requireString(
        createHostedPhoneLookupKey("+15550000000"),
      );
      const contactLookupKey = requireString(
        createHostedPhoneLookupKey(sender),
      );
      const chatLookupKey = requireString(createHostedLinqChatLookupKey(chatId));
      const originalOccurredAt = new Date("2026-08-11T13:00:00.000Z");
      const originalWake = buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey,
        contactKind: "phone",
        contactLookupKey,
        eventId: `event_edit_three_contenders_original_${randomUUID()}`,
        linqMessage: {
          chatId,
          from: sender,
          isFromMe: false,
          messageId,
          parts: [{ type: "text", value: "Original wording" }],
          service: "iMessage",
          threadIsDirect: true,
        },
        occurredAt: originalOccurredAt.toISOString(),
        phoneLookupKey: contactLookupKey,
        userId: memberId,
      });
      const events = Array.from({ length: 3 }, (_, index) => {
        const editedAt = new Date(originalOccurredAt.getTime() + index + 1)
          .toISOString();
        const event = parseHostedLinqWebhookEvent(JSON.stringify({
          api_version: "v3",
          created_at: editedAt,
          data: {
            chat: { id: chatId },
            direction: "inbound",
            edited_at: editedAt,
            id: messageId,
            part: {
              index: 0,
              text: `Corrected wording ${index + 1}`,
            },
            sender_handle: {
              handle: sender,
              id: `sender_handle_edit_three_contenders_${index + 1}`,
              is_me: false,
              service: "iMessage",
            },
          },
          event_id: `event_edit_three_contenders_${index + 1}_${randomUUID()}`,
          event_type: "message.edited",
          webhook_version: "2026-02-03",
        }));
        if (!event) {
          throw new Error("Expected a valid Linq message.edited fixture.");
        }
        return requireHostedLinqMessageEditedEvent(event);
      });
      const firstBlockerLocked = createDeferred();
      const retryBlockerLocked = createDeferred();
      const releaseFirstBlocker = createDeferred();
      const releaseRetryBlocker = createDeferred();
      let memberCreated = false;
      let firstBlockerTransaction: Promise<void> | null = null;
      let retryBlockerTransaction: Promise<void> | null = null;
      const editRequests: Array<ReturnType<
        typeof runHostedLinqMessageEditPreparedTransaction
      >> = [];

      try {
        await observer.$transaction(async (tx) => {
          await tx.hostedMember.create({
            data: {
              billingStatus: HostedBillingStatus.active,
              id: memberId,
            },
          });
          memberCreated = true;
          await tx.hostedMemberRouting.create({
            data: {
              linqChatLookupKey: chatLookupKey,
              linqParticipantContactKind: "phone",
              linqParticipantContactLookupKey: contactLookupKey,
              memberId,
            },
          });
          await appendHostedMailboxEnvelopeWithSourceMessageTx({
            envelope: originalWake,
            sourceMessageLookupKey,
            tx,
          });
        }, transactionOptions);

        const editPids = await Promise.all(editClients.map((client) =>
          client.$transaction(readBackendPid, transactionOptions)
        ));
        firstBlockerTransaction = firstBlocker.$transaction(async (tx) => {
          await acquireHostedMailboxSourceLocksForTest({
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          });
          firstBlockerLocked.resolve();
          await releaseFirstBlocker.promise;
        }, transactionOptions);
        await Promise.race([
          firstBlockerLocked.promise,
          firstBlockerTransaction.then(() => {
            throw new Error("The first edit blocker released before the contenders queued.");
          }),
        ]);

        for (const [index, client] of editClients.entries()) {
          const event = events[index];
          const pid = editPids[index];
          if (!event || pid === undefined) {
            throw new Error("Expected one client, event, and backend per edit contender.");
          }
          editRequests.push(runHostedLinqMessageEditPreparedTransaction({
            event,
            prisma: client,
          }));
          await waitForBlockedBackend({ observer, pid });
        }

        const retryBlockerPid = await retryBlocker.$transaction(
          readBackendPid,
          transactionOptions,
        );
        retryBlockerTransaction = retryBlocker.$transaction(async (tx) => {
          await acquireHostedMailboxSourceLocksForTest({
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          });
          retryBlockerLocked.resolve();
          await releaseRetryBlocker.promise;
        }, transactionOptions);
        await waitForBlockedBackend({ observer, pid: retryBlockerPid });
        releaseFirstBlocker.resolve();
        await Promise.race([
          retryBlockerLocked.promise,
          Promise.all(editRequests).then(() => {
            throw new Error("All edit contenders completed before the retry blocker acquired.");
          }),
        ]);

        await Promise.all(editPids.slice(1).map((pid) =>
          waitForBlockedBackend({ observer, pid })
        ));
        releaseRetryBlocker.resolve();
        const plans = await Promise.all(editRequests);

        expect(plans.map((plan) => plan.response.reason)).toEqual([
          "wake-appended-message-edit",
          "wake-appended-message-edit",
          "wake-appended-message-edit",
        ]);
        expect(plans[2]?.wakeHandoffs).toEqual([
          expect.objectContaining({
            eventId: events[2]?.event_id,
            userId: memberId,
          }),
        ]);
        const finalPreparation = await readHostedMailboxSourceConversationPreparation({
          prisma: observer,
          sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
        });
        await expect(observer.$transaction((tx) =>
          readHostedMailboxSourceConversationEntriesTx({
            preparation: finalPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          }), transactionOptions)).resolves.toHaveLength(4);
      } finally {
        releaseFirstBlocker.resolve();
        releaseRetryBlocker.resolve();
        await Promise.allSettled([
          ...editRequests,
          ...[firstBlockerTransaction, retryBlockerTransaction].filter(
            (transaction): transaction is Promise<void> => transaction !== null,
          ),
        ]);
        if (memberCreated) {
          await observer.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([
          observer,
          firstBlocker,
          retryBlocker,
          ...editClients,
        ]);
      }
    });

    it("retries an edit that races an uncommitted ordinary source append", async () => {
      const original = createPrismaClient({ databaseUrl, poolMax: 1 });
      const edit = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `member_edit_race_${randomUUID()}`;
      const messageId = `message_edit_race_${randomUUID()}`;
      const sourceMessageLookupKey = requireString(
        createHostedLinqMessageLookupKey(messageId),
      );
      const sourceMessageLookupKeyReadCandidates =
        createHostedLinqMessageLookupKeyReadCandidates(messageId);
      const accountLookupKey = requireString(
        createHostedPhoneLookupKey("+15550000000"),
      );
      const contactLookupKey = requireString(
        createHostedPhoneLookupKey("+15551112222"),
      );
      const originalAppended = createDeferred<string>();
      const releaseOriginal = createDeferred();
      let memberCreated = false;
      let originalTransaction: Promise<string> | null = null;

      try {
        await original.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        memberCreated = true;

        originalTransaction = original.$transaction(async (tx) => {
          const originalWake =
            buildHostedExecutionLinqConversationMessageWake({
              accountLookupKey,
              contactKind: "phone",
              contactLookupKey,
              eventId: `event_edit_race_${randomUUID()}`,
              linqMessage: {
                chatId: `chat_edit_race_${randomUUID()}`,
                from: "+15551112222",
                isFromMe: false,
                messageId,
                parts: [{ type: "text", value: "Original wording" }],
                service: "iMessage",
                threadIsDirect: true,
              },
              occurredAt: new Date().toISOString(),
              phoneLookupKey: contactLookupKey,
              userId: memberId,
            });
          const appended =
            await appendHostedMailboxEnvelopeWithSourceMessageTx({
              envelope: originalWake,
              sourceMessageLookupKey,
              tx,
            });
          originalAppended.resolve(appended.item.id);
          await releaseOriginal.promise;
          return appended.item.id;
        }, transactionOptions);

        const originalItemId = await Promise.race([
          originalAppended.promise,
          originalTransaction.then(() => {
            throw new Error(
              "Original source append completed before exposing its uncommitted row.",
            );
          }),
        ]);
        const pendingPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma: edit,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        await expect(edit.$transaction((tx) =>
          readHostedMailboxSourceConversationEntriesTx({
            preparation: pendingPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          }), transactionOptions)).resolves.toEqual([]);

        releaseOriginal.resolve();
        await expect(originalTransaction).resolves.toBe(originalItemId);

        const committedPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma: edit,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        await expect(edit.$transaction((tx) =>
          readHostedMailboxSourceConversationEntriesTx({
            preparation: committedPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          }), transactionOptions)).resolves.toMatchObject([{
          contentAvailable: true,
          itemId: originalItemId,
          userId: memberId,
          wake: {
            message: {
              linqMessage: {
                messageId,
              },
            },
          },
        }]);
      } finally {
        releaseOriginal.resolve();
        if (originalTransaction) {
          await Promise.allSettled([originalTransaction]);
        }
        if (memberCreated) {
          await original.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([original, edit]);
      }
    });

    it("round-trips original and correction lineage through the production mailbox store", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `member_edit_lineage_${randomUUID()}`;
      const messageId = `message_edit_lineage_${randomUUID()}`;
      const originalEventId = `event_edit_original_${randomUUID()}`;
      const correctionEventId = `event_edit_correction_${randomUUID()}`;
      const sourceMessageLookupKey = requireString(
        createHostedLinqMessageLookupKey(messageId),
      );
      const sourceMessageLookupKeyReadCandidates =
        createHostedLinqMessageLookupKeyReadCandidates(messageId);
      const accountLookupKey = requireString(
        createHostedPhoneLookupKey("+15550000000"),
      );
      const contactLookupKey = requireString(
        createHostedPhoneLookupKey("+15551112222"),
      );
      const originalOccurredAt = new Date();
      const correctionOccurredAt = new Date(originalOccurredAt.getTime() + 1);
      let memberCreated = false;

      try {
        await prisma.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        memberCreated = true;
        const originalWake =
          buildHostedExecutionLinqConversationMessageWake({
            accountLookupKey,
            contactKind: "phone",
            contactLookupKey,
            eventId: originalEventId,
            linqMessage: {
              chatId: `chat_edit_lineage_${randomUUID()}`,
              from: "+15551112222",
              isFromMe: false,
              messageId,
              parts: [{ type: "text", value: "Original wording" }],
              service: "iMessage",
              threadIsDirect: true,
            },
            occurredAt: originalOccurredAt.toISOString(),
            phoneLookupKey: contactLookupKey,
            userId: memberId,
          });
        const originalAppend = await prisma.$transaction((tx) =>
          appendHostedMailboxEnvelopeWithSourceMessageTx({
            envelope: originalWake,
            sourceMessageLookupKey,
            tx,
          }), transactionOptions);
        const correctionWake =
          buildHostedExecutionLinqConversationMessageWake({
            accountLookupKey,
            contactKind: "phone",
            contactLookupKey,
            eventId: correctionEventId,
            linqMessage: {
              ...originalWake.message.linqMessage,
              editedSourceInputId:
                "ain_11111111111111111111111111111111",
              editedTextPartIndex: 0,
              parts: [{ type: "text", value: "Corrected wording" }],
            },
            occurredAt: correctionOccurredAt.toISOString(),
            phoneLookupKey: contactLookupKey,
            userId: memberId,
          });
        const originalPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        const correctionAppend = await prisma.$transaction(async (tx) => {
          await expect(readHostedMailboxSourceConversationEntriesTx({
            preparation: originalPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          })).resolves.toMatchObject([{
            contentAvailable: true,
            itemId: originalAppend.item.id,
            userId: memberId,
            wake: {
              eventId: originalEventId,
              message: {
                linqMessage: {
                  messageId,
                  parts: [{ type: "text", value: "Original wording" }],
                },
              },
            },
          }]);
          return appendHostedMailboxEnvelopeWithSourceMessageTx({
            envelope: correctionWake,
            sourceMessageLookupKey,
            tx,
          });
        }, transactionOptions);

        const acceptedPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        const acceptedLineage = await prisma.$transaction((tx) =>
          readHostedMailboxSourceConversationEntriesTx({
            preparation: acceptedPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          }), transactionOptions);
        expect(acceptedLineage.map((entry) => ({
          contentAvailable: entry.contentAvailable,
          editedTextPartIndex:
            entry.wake?.message.channel === "linq"
              ? entry.wake.message.linqMessage.editedTextPartIndex
              : undefined,
          eventId: entry.wake?.eventId,
          itemId: entry.itemId,
          text: entry.wake?.message.channel === "linq"
            ? entry.wake.message.linqMessage.parts.find(
                (part) => part.type === "text",
              )?.value
            : undefined,
        }))).toEqual([
          {
            contentAvailable: true,
            editedTextPartIndex: undefined,
            eventId: originalEventId,
            itemId: originalAppend.item.id,
            text: "Original wording",
          },
          {
            contentAvailable: true,
            editedTextPartIndex: 0,
            eventId: correctionEventId,
            itemId: correctionAppend.item.id,
            text: "Corrected wording",
          },
        ]);

        await prisma.$transaction(async (tx) => {
          await tx.hostedMailboxPayload.deleteMany({
            where: { mailboxItemId: originalAppend.item.id },
          });
          await tx.hostedMailboxItem.update({
            data: {
              contentRetiredAt: new Date(),
              payloadInlineCiphertext: null,
              payloadRef: null,
              retentionDisposition: "test-content-retired",
            },
            where: { id: originalAppend.item.id },
          });
        }, transactionOptions);
        const retiredPreparation =
          await readHostedMailboxSourceConversationPreparation({
            prisma,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
          });
        const retiredLineage = await prisma.$transaction((tx) =>
          readHostedMailboxSourceConversationEntriesTx({
            preparation: retiredPreparation,
            sourceMessageLookupKeys: sourceMessageLookupKeyReadCandidates,
            tx,
          }), transactionOptions);
        expect(retiredLineage.map((entry) => ({
          contentAvailable: entry.contentAvailable,
          eventId: entry.wake?.eventId ?? null,
          itemId: entry.itemId,
        }))).toEqual([
          {
            contentAvailable: false,
            eventId: null,
            itemId: originalAppend.item.id,
          },
          {
            contentAvailable: true,
            eventId: correctionEventId,
            itemId: correctionAppend.item.id,
          },
        ]);
      } finally {
        if (memberCreated) {
          await prisma.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([prisma]);
      }
    });

    it("admits only one concurrent claim for the final daily slot", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const phoneNumberLookupKey =
        `test:linq-proactive-capacity:${randomUUID()}`;
      const dayUtc = new Date("2026-07-23T00:00:00.000Z");
      const limit = 50;
      const ownerClaimed = createDeferred<boolean>();
      const contenderPid = createDeferred<number>();
      const releaseOwner = createDeferred();
      let contenderTransaction: Promise<boolean> | null = null;
      let ownerTransaction: Promise<boolean> | null = null;
      let rowCreated = false;

      try {
        await owner.hostedLinqLine.create({
          data: {
            phoneNumberHint: "*** test",
            phoneNumberLookupKey,
            proactiveConversationCount: limit - 1,
            proactiveConversationDayUtc: dayUtc,
            source: "test",
          },
        });
        rowCreated = true;

        ownerTransaction = owner.$transaction(async (tx) => {
          const claimed =
            await claimHostedLinqProactiveConversationCapacityTx({
              dayUtc,
              limit,
              phoneNumberLookupKey,
              prisma: tx,
            });
          ownerClaimed.resolve(claimed);
          await releaseOwner.promise;
          return claimed;
        }, transactionOptions);

        await expect(
          Promise.race([ownerClaimed.promise, ownerTransaction]),
        ).resolves.toBe(true);

        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          return claimHostedLinqProactiveConversationCapacityTx({
            dayUtc,
            limit,
            phoneNumberLookupKey,
            prisma: tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer,
          pid: await contenderPid.promise,
        });
        releaseOwner.resolve();

        await expect(
          Promise.all([ownerTransaction, contenderTransaction]),
        ).resolves.toEqual([true, false]);
        await expect(owner.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey },
          select: { proactiveConversationCount: true },
        })).resolves.toEqual({
          proactiveConversationCount: limit,
        });
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled(
          [ownerTransaction, contenderTransaction].filter(
            (transaction): transaction is Promise<boolean> =>
              transaction !== null,
          ),
        );
        if (rowCreated) {
          await owner.hostedLinqLine.deleteMany({
            where: { phoneNumberLookupKey },
          });
        }
        await disconnectClients([observer, owner, contender]);
      }
    });

    it("converges concurrent Telegram contact requests on one persisted home-line assignment", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const first = createPrismaClient({ databaseUrl, poolMax: 1 });
      const second = createPrismaClient({ databaseUrl, poolMax: 1 });
      const uniqueDigits = randomUUID().replaceAll("-", "").slice(0, 7);
      const numericSuffix = String(
        Number.parseInt(uniqueDigits, 16) % 10_000_000,
      ).padStart(7, "0");
      const memberPhone = `+1555${numericSuffix}`;
      const recipientPhone = `+1556${numericSuffix}`;
      const memberPhoneLookupKey = requireString(
        createHostedPhoneLookupKey(memberPhone),
      );
      const recipientPhoneLookupKey = requireString(
        createHostedPhoneLookupKey(recipientPhone),
      );
      const memberId = `hbm_imessage_contact_${randomUUID()}`;
      const telegramUserId = String(
        Number.parseInt(
          randomUUID().replaceAll("-", "").slice(0, 12),
          16,
        ),
      );
      const telegramThreadId = telegramUserId;
      const wake = buildHostedExecutionTelegramConversationMessageWake({
        eventId: `telegram-contact-request-${randomUUID()}`,
        occurredAt: "2026-07-29T12:00:00.000Z",
        telegramMessage: {
          messageId: String(
            Number.parseInt(
              randomUUID().replaceAll("-", "").slice(0, 12),
              16,
            ),
          ),
          schema: "murph.hosted-telegram-message.v1",
          text: "What number can I use for iMessage?",
          threadId: telegramThreadId,
          threadIsDirect: true,
        },
        userId: memberId,
      });
      const assistantInputId = createHostedMailboxAssistantInputId({
        dedupeKey: wake.eventId,
        eventId: wake.eventId,
        lane: "conversation",
        secret: readHostedConversationAssistantIdentifierSecret(wake),
        userId: memberId,
      });
      const blockerLocked = createDeferred();
      const releaseBlocker = createDeferred();
      let blockerTransaction: Promise<void> | null = null;
      let firstRequest:
        ReturnType<typeof handleHostedRuntimeIMessageContactTool> | null = null;
      let secondRequest:
        ReturnType<typeof handleHostedRuntimeIMessageContactTool> | null = null;
      let memberCreated = false;
      let lineCreated = false;

      try {
        await observer.$transaction(async (tx) => {
          await tx.hostedMember.create({
            data: {
              billingStatus: HostedBillingStatus.active,
              id: memberId,
            },
          });
          memberCreated = true;
          const identityPrivate =
            await buildHostedMemberIdentityPrivateColumns({
              memberId,
              phoneNumber: memberPhone,
              prisma: tx,
              privyUserId: null,
              signupPhoneCodeSendAttemptId: null,
              signupPhoneCodeSendAttemptStartedAt: null,
              signupPhoneCodeSentAt: null,
              signupPhoneNumber: null,
            });
          await tx.hostedMemberIdentity.create({
            data: {
              ...identityPrivate,
              maskedPhoneNumberHint: "*** test",
              memberId,
              phoneLookupKey: memberPhoneLookupKey,
              phoneNumberVerifiedAt:
                new Date("2026-07-29T11:00:00.000Z"),
            },
          });
          await upsertHostedMemberTelegramRoutingBindingTx({
            memberId,
            prisma: tx,
            telegramThreadId,
            telegramUserId,
          });
          await appendHostedMailboxEnvelopeTx({
            envelope: wake,
            tx,
          });
          await tx.hostedLinqLine.create({
            data: {
              assignmentWeight: 2_147_483_647,
              configuredAt: new Date("2026-07-29T11:00:00.000Z"),
              egressPolicy: "enabled",
              healthStatus: "healthy",
              phoneNumberEncrypted:
                encryptHostedLinqLinePhoneNumber(recipientPhone),
              phoneNumberHint: "*** test",
              phoneNumberLookupKey: recipientPhoneLookupKey,
              source: "test",
            },
          });
          lineCreated = true;
        }, transactionOptions);

        const firstPid = await first.$transaction(
          readBackendPid,
          transactionOptions,
        );
        const secondPid = await second.$transaction(
          readBackendPid,
          transactionOptions,
        );
        blockerTransaction = blocker.$transaction(async (tx) => {
          await acquireHostedMemberHomeLinqRouteLockTx({
            memberId,
            prisma: tx,
          });
          blockerLocked.resolve();
          await releaseBlocker.promise;
        }, transactionOptions);
        await Promise.race([
          blockerLocked.promise,
          blockerTransaction.then(() => {
            throw new Error(
              "Route-lock blocker completed before holding the member owner.",
            );
          }),
        ]);

        handlerPrismaClients.push(first, second);
        firstRequest = handleHostedRuntimeIMessageContactTool({
          memberId,
          request: { assistantInputId },
        });
        secondRequest = handleHostedRuntimeIMessageContactTool({
          memberId,
          request: { assistantInputId },
        });

        await Promise.all([
          waitForBlockedBackend({ observer, pid: firstPid }),
          waitForBlockedBackend({ observer, pid: secondPid }),
        ]);
        releaseBlocker.resolve();

        const responses = await Promise.all([firstRequest, secondRequest]);
        expect(responses.map((response) => response.status).sort()).toEqual([
          "assigned",
          "existing",
        ]);
        for (const response of responses) {
          expect(response).toMatchObject({
            phoneNumber: recipientPhone,
            verifiedSenderPhoneHint: `*** ${memberPhone.slice(-4)}`,
          });
        }

        await expect(readHostedMemberRoutingState({
          memberId,
          prisma: observer,
        })).resolves.toMatchObject({
          linqChatId: null,
          linqHomeLineAssignedAt: expect.any(Date),
          linqRecipientPhone: recipientPhone,
          pendingLinqChatId: null,
          pendingLinqRecipientPhone: null,
          telegramThreadId,
          telegramUserId,
        });
        await expect(observer.hostedMemberRouting.findUnique({
          select: {
            linqChatIdEncrypted: true,
            linqChatLookupKey: true,
            linqRecipientPhoneEncrypted: true,
            linqRecipientPhoneLookupKey: true,
          },
          where: { memberId },
        })).resolves.toEqual({
          linqChatIdEncrypted: null,
          linqChatLookupKey: null,
          linqRecipientPhoneEncrypted: expect.any(String),
          linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
        });
        await expect(observer.hostedMemberRouting.count({
          where: { linqRecipientPhoneLookupKey: recipientPhoneLookupKey },
        })).resolves.toBe(1);
        await expect(observer.hostedLinqLine.findUnique({
          select: {
            proactiveConversationCount: true,
            proactiveConversationDayUtc: true,
          },
          where: { phoneNumberLookupKey: recipientPhoneLookupKey },
        })).resolves.toEqual({
          proactiveConversationCount: null,
          proactiveConversationDayUtc: null,
        });
      } finally {
        handlerPrismaClients.length = 0;
        releaseBlocker.resolve();
        await Promise.allSettled([
          ...(blockerTransaction ? [blockerTransaction] : []),
          ...(firstRequest ? [firstRequest] : []),
          ...(secondRequest ? [secondRequest] : []),
        ]);
        if (memberCreated) {
          await observer.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        if (lineCreated) {
          await observer.hostedLinqLine.deleteMany({
            where: { phoneNumberLookupKey: recipientPhoneLookupKey },
          });
        }
        await disconnectClients([observer, blocker, first, second]);
      }
    });

    it("keeps the uncommitted signup identity authoritative while an admitted inbound waits", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      vi.stubEnv(
        "HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES",
        "+1",
      );
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const admitted = createPrismaClient({ databaseUrl, poolMax: 1 });
      const signup = createPrismaClient({ databaseUrl, poolMax: 1 });
      const uniqueDigits = randomUUID().replaceAll("-", "").slice(0, 7);
      const numericSuffix = String(
        Number.parseInt(uniqueDigits, 16) % 10_000_000,
      ).padStart(7, "0");
      const memberPhone = `+1555${numericSuffix}`;
      const recipientPhone = `+1556${numericSuffix}`;
      const memberPhoneLookupKey = createHostedPhoneLookupKey(memberPhone);
      const recipientPhoneLookupKey =
        createHostedPhoneLookupKey(recipientPhone);
      const chatId = `linq-classifier-window-${randomUUID()}`;
      const admissionEventId =
        `linq-classifier-window-admission-${randomUUID()}`;
      const fallbackEventId =
        `linq-classifier-window-fallback-${randomUUID()}`;
      const memberId = `hbm_classifier_window_${randomUUID()}`;
      const buildInboundEvent = (input: {
        eventId: string;
        service: "iMessage" | "sms";
        text: string;
      }) => parseHostedLinqWebhookEvent(JSON.stringify({
        api_version: "v3",
        created_at: "2026-07-28T12:00:00.000Z",
        data: {
          chat: {
            id: chatId,
            is_group: false,
            owner_handle: {
              handle: recipientPhone,
              id: "owner-handle",
              is_me: true,
              service: input.service,
            },
          },
          direction: "inbound",
          id: `linq-message-${randomUUID()}`,
          parts: [{ type: "text", value: input.text }],
          sender_handle: {
            handle: memberPhone,
            id: "sender-handle",
            service: input.service,
          },
          sent_at: "2026-07-28T12:00:00.000Z",
          service: input.service,
        },
        event_id: input.eventId,
        event_type: "message.received",
        webhook_version: "2026-02-03",
      }));
      const admissionEvent = buildInboundEvent({
        eventId: admissionEventId,
        service: "iMessage",
        text: "What can you help me with?",
      });
      const fallbackEvent = buildInboundEvent({
        eventId: fallbackEventId,
        service: "sms",
        text: "Following up",
      });
      const signupIdentityCreated = createDeferred();
      const releaseSignup = createDeferred();
      const admittedPid = createDeferred<number>();
      let lineCreated = false;
      let admittedTransaction:
        Promise<Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>>
        | null = null;
      let signupTransaction:
        Promise<Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>>
        | null = null;

      if (!memberPhoneLookupKey || !recipientPhoneLookupKey) {
        throw new Error("Expected valid classifier-window phone inputs.");
      }

      try {
        await observer.hostedLinqLine.create({
          data: {
            configuredAt: new Date("2026-07-28T11:00:00.000Z"),
            egressPolicy: "enabled",
            healthStatus: "healthy",
            phoneNumberEncrypted:
              encryptHostedLinqLinePhoneNumber(recipientPhone),
            phoneNumberHint: "*** test",
            phoneNumberLookupKey: recipientPhoneLookupKey,
            source: "test",
          },
        });
        lineCreated = true;

        const waitingPlan = await admitted.$transaction(
          (tx) => planHostedOnboardingLinqWebhook({
            event: admissionEvent,
            prisma: tx,
            requireFirstContactAdmission: true,
          }),
          transactionOptions,
        );
        expect(waitingPlan.firstContactAdmissionRequest).not.toBeNull();
        await expect(observer.hostedMemberIdentity.count({
          where: { phoneLookupKey: memberPhoneLookupKey },
        })).resolves.toBe(0);

        signupTransaction = signup.$transaction(async (tx) => {
          await acquireHostedLinqParticipantPhoneLockTx({
            phoneNumber: memberPhone,
            tx,
          });
          await tx.hostedMember.create({
            data: {
              billingStatus: HostedBillingStatus.not_started,
              id: memberId,
            },
          });
          const identityPrivate =
            await buildHostedMemberIdentityPrivateColumns({
              memberId,
              phoneNumber: memberPhone,
              prisma: tx,
              privyUserId: null,
              signupPhoneCodeSendAttemptId: null,
              signupPhoneCodeSendAttemptStartedAt: null,
              signupPhoneCodeSentAt: null,
              signupPhoneNumber: null,
            });
          await tx.hostedMemberIdentity.create({
            data: {
              ...identityPrivate,
              maskedPhoneNumberHint: "*** test",
              memberId,
              phoneLookupKey: memberPhoneLookupKey,
              phoneNumberVerifiedAt:
                new Date("2026-07-28T12:00:00.000Z"),
            },
          });
          signupIdentityCreated.resolve();
          await releaseSignup.promise;
          return planHostedOnboardingLinqWebhook({
            event: fallbackEvent,
            prisma: tx,
          });
        }, transactionOptions);
        await signupIdentityCreated.promise;

        admittedTransaction = admitted.$transaction(async (tx) => {
          admittedPid.resolve(await readBackendPid(tx));
          return planHostedOnboardingLinqWebhook({
            event: admissionEvent,
            firstContactAdmissionDecision: {
              confidence: 0.99,
              kind: "allow",
              source: "model",
            },
            instantStartAllowed: true,
            prisma: tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer,
          pid: await admittedPid.promise,
        });
        releaseSignup.resolve();

        const fallbackPlan = await signupTransaction;
        expect(fallbackPlan.response.reason).toBe("sent-signup-link");
        expect(fallbackPlan.instantStartEnrollment).toBeUndefined();
        const admittedPlan = await admittedTransaction;
        expect(admittedPlan.response.reason).toBe("sent-signup-link");
        expect(admittedPlan.instantStartEnrollment).toBeUndefined();
        expect(admittedPlan.desiredSideEffects).toHaveLength(1);
        expect(admittedPlan.desiredSideEffects[0]?.effectId).toBe(
          fallbackPlan.desiredSideEffects[0]?.effectId,
        );
        await expect(observer.hostedInvite.findFirst({
          select: {
            instantStartAdmissionEventId: true,
            sentAt: true,
          },
          where: { memberId },
        })).resolves.toEqual({
          instantStartAdmissionEventId: null,
          sentAt: null,
        });
        await expect(observer.hostedLinqDailyState.findMany({
          select: { inboundCount: true },
          where: { memberId },
        })).resolves.toEqual([{ inboundCount: 2 }]);
        await expect(observer.hostedMemberIdentity.count({
          where: { phoneLookupKey: memberPhoneLookupKey },
        })).resolves.toBe(1);
      } finally {
        releaseSignup.resolve();
        await Promise.allSettled([
          ...(admittedTransaction ? [admittedTransaction] : []),
          ...(signupTransaction ? [signupTransaction] : []),
        ]);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        if (lineCreated) {
          await observer.hostedLinqLine.deleteMany({
            where: {
              phoneNumberLookupKey: recipientPhoneLookupKey,
            },
          });
        }
        await disconnectClients([observer, admitted, signup]);
        vi.unstubAllEnvs();
      }
    });

    it.each([
      "fallback-first",
      "activation-first",
    ] as const)(
      "keeps the admitted instant start authoritative for an overlapping SMS with %s lock order",
      async (lockOrder) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const activation = createPrismaClient({ databaseUrl, poolMax: 1 });
        const fallbackBase = createPrismaClient({ databaseUrl, poolMax: 1 });
        const uniqueDigits = randomUUID().replaceAll("-", "").slice(0, 7);
        const numericSuffix = String(
          Number.parseInt(uniqueDigits, 16) % 10_000_000,
        ).padStart(7, "0");
        const memberPhone = `+1555${numericSuffix}`;
        const recipientPhone = `+1556${numericSuffix}`;
        const recipientPhoneLookupKey =
          createHostedPhoneLookupKey(recipientPhone);
        const participantContact = createHostedLinqParticipantContact({
          kind: "phone",
          value: memberPhone,
        });
        const chatId = `linq-instant-start-${randomUUID()}`;
        const admissionEventId =
          `linq-instant-start-admission-${randomUUID()}`;
        const followUpEventId =
          `linq-instant-start-follow-up-${randomUUID()}`;
        const inviteId = `invite_instant_start_${randomUUID()}`;
        const inviteCode = `code_instant_start_${randomUUID()}`;
        const followUpEvent = parseHostedLinqWebhookEvent(JSON.stringify({
          api_version: "v3",
          created_at: "2026-07-28T12:00:00.000Z",
          data: {
            chat: {
              id: chatId,
              is_group: false,
              owner_handle: {
                handle: recipientPhone,
                id: "owner-handle",
                is_me: true,
                service: "sms",
              },
            },
            direction: "inbound",
            id: `linq-message-${randomUUID()}`,
            parts: [{ type: "text", value: "one more question" }],
            sender_handle: {
              handle: memberPhone,
              id: "sender-handle",
              service: "sms",
            },
            sent_at: "2026-07-28T12:00:00.000Z",
            service: "sms",
          },
          event_id: followUpEventId,
          event_type: "message.received",
          webhook_version: "2026-02-03",
        }));
        if (!participantContact || !recipientPhoneLookupKey) {
          throw new Error("Expected valid instant-start concurrency inputs.");
        }

        const fallbackMarkerReadReached = createDeferred();
        const releaseFallbackMarkerRead = createDeferred();
        const activationLocked = createDeferred();
        const releaseActivation = createDeferred();
        const activationPid = createDeferred<number>();
        const fallbackPid = createDeferred<number>();
        const fallbackClient = fallbackBase.$extends({
          query: {
            hostedInvite: {
              async findFirst({ args, query }) {
                if (
                  lockOrder === "fallback-first"
                  && typeof args.where?.instantStartAdmissionEventId
                    === "object"
                ) {
                  fallbackMarkerReadReached.resolve();
                  await releaseFallbackMarkerRead.promise;
                }
                return query(args);
              },
            },
          },
        });
        let activationTransaction: Promise<void> | null = null;
        let fallbackTransaction:
          Promise<Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>>
          | null = null;
        let memberId: string | null = null;
        let lineCreated = false;

        const runActivation = () => {
          activationTransaction = activation.$transaction(async (tx) => {
            const currentMemberId = requireString(memberId);
            activationPid.resolve(await readBackendPid(tx));
            await lockHostedMemberRow(tx, currentMemberId);
            activationLocked.resolve();
            if (lockOrder === "activation-first") {
              await releaseActivation.promise;
            }
            await updateHostedMemberCoreState({
              billingStatus: HostedBillingStatus.active,
              memberId: currentMemberId,
              prisma: tx,
            });
            await tx.hostedInvite.updateMany({
              data: {
                instantStartAdmissionEventId: null,
              },
              where: {
                id: inviteId,
                instantStartAdmissionEventId: admissionEventId,
              },
            });
          }, transactionOptions);
        };
        const runFallback = () => {
          fallbackTransaction = fallbackClient.$transaction(async (tx) => {
            const prisma = tx as Prisma.TransactionClient;
            fallbackPid.resolve(await readBackendPid(prisma));
            return planHostedOnboardingLinqWebhook({
              event: followUpEvent,
              prisma,
            });
          }, transactionOptions);
        };

        try {
          await observer.hostedLinqLine.create({
            data: {
              configuredAt: new Date("2026-07-28T11:00:00.000Z"),
              egressPolicy: "enabled",
              healthStatus: "healthy",
              phoneNumberEncrypted:
                encryptHostedLinqLinePhoneNumber(recipientPhone),
              phoneNumberHint: "*** test",
              phoneNumberLookupKey: recipientPhoneLookupKey,
              source: "test",
            },
          });
          lineCreated = true;
          memberId = `hbm_instant_start_overlap_${randomUUID()}`;
          await observer.$transaction(async (tx) => {
            const phoneLookupKey = createHostedPhoneLookupKey(memberPhone);
            if (!phoneLookupKey) {
              throw new Error("Expected a valid member phone lookup key.");
            }
            await tx.hostedMember.create({
              data: {
                billingStatus: HostedBillingStatus.not_started,
                id: requireString(memberId),
              },
            });
            const identityPrivate =
              await buildHostedMemberIdentityPrivateColumns({
                memberId: requireString(memberId),
                phoneNumber: memberPhone,
                prisma: tx,
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: null,
              });
            await tx.hostedMemberIdentity.create({
              data: {
                ...identityPrivate,
                maskedPhoneNumberHint: "*** test",
                memberId: requireString(memberId),
                phoneLookupKey,
                phoneNumberVerifiedAt:
                  new Date("2026-07-28T11:00:00.000Z"),
              },
            });
            await upsertHostedMemberPendingLinqBindingTx({
              homeLineAssignedAt: new Date("2026-07-28T11:00:00.000Z"),
              linqChatId: chatId,
              memberId: requireString(memberId),
              participantContact,
              participantContactObservedAt:
                new Date("2026-07-28T11:00:00.000Z"),
              prisma: tx,
              recipientPhone,
            });
            await tx.hostedInvite.create({
              data: {
                channel: "linq",
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                id: inviteId,
                instantStartAdmissionEventId: admissionEventId,
                inviteCode,
                memberId: requireString(memberId),
              },
            });
            await tx.hostedLinqFirstContactAdmissionDecision.create({
              data: {
                confidence: 0.99,
                decision: "allow",
                eventId: admissionEventId,
                source: "model",
              },
            });
          }, transactionOptions);

          if (lockOrder === "fallback-first") {
            runFallback();
            await fallbackMarkerReadReached.promise;
            runActivation();
            await waitForBlockedBackend({
              observer,
              pid: await activationPid.promise,
            });
            releaseFallbackMarkerRead.resolve();
            await expect(fallbackTransaction).rejects.toMatchObject({
              code: "HOSTED_LINQ_INSTANT_START_IN_PROGRESS",
              retryable: true,
            });
            await activationTransaction;
            fallbackTransaction = fallbackClient.$transaction(
              (tx) => planHostedOnboardingLinqWebhook({
                event: followUpEvent,
                prisma: tx as Prisma.TransactionClient,
              }),
              transactionOptions,
            );
          } else {
            runActivation();
            await activationLocked.promise;
            runFallback();
            await waitForBlockedBackend({
              observer,
              pid: await fallbackPid.promise,
            });
            releaseActivation.resolve();
            await activationTransaction;
          }

          if (!fallbackTransaction) {
            throw new Error("Expected the fallback planner transaction.");
          }
          const finalPlan = await fallbackTransaction;
          expect(finalPlan.response.reason).toBe(
            "wake-appended-active-member",
          );
          expect(finalPlan.desiredSideEffects).toEqual([]);
          await expect(observer.hostedMailboxItem.count({
            where: {
              dedupeKey: followUpEventId,
              userId: memberId,
            },
          })).resolves.toBe(1);
          await expect(observer.hostedLinqDailyState.findMany({
            select: {
              inboundCount: true,
            },
            where: {
              memberId,
            },
          })).resolves.toEqual([
            {
              inboundCount: 1,
            },
          ]);
          await expect(observer.hostedInvite.findUnique({
            select: {
              instantStartAdmissionEventId: true,
              sentAt: true,
            },
            where: {
              id: inviteId,
            },
          })).resolves.toEqual({
            instantStartAdmissionEventId: null,
            sentAt: null,
          });
        } finally {
          releaseFallbackMarkerRead.resolve();
          releaseActivation.resolve();
          await Promise.allSettled([
            ...(activationTransaction ? [activationTransaction] : []),
            ...(fallbackTransaction ? [fallbackTransaction] : []),
          ]);
          await observer.hostedLinqFirstContactAdmissionDecision.deleteMany({
            where: {
              eventId: admissionEventId,
            },
          });
          if (memberId) {
            await observer.hostedMember.deleteMany({
              where: {
                id: memberId,
              },
            });
          }
          if (lineCreated) {
            await observer.hostedLinqLine.deleteMany({
              where: {
                phoneNumberLookupKey: recipientPhoneLookupKey,
              },
            });
          }
          await disconnectClients([observer, activation, fallbackBase]);
        }
      },
    );

    it.each([
      ["activation", "first-contact"],
      ["first-contact", "activation"],
    ] as const)(
      "serializes %s then %s through the member-row owner",
      async (ownerRole, contenderRole) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const memberId = `hbm_linq_route_order_${randomUUID()}`;
        const ownerLocked = createDeferred();
        const contenderPid = createDeferred<number>();
        const releaseOwner = createDeferred();
        let contenderTransaction: Promise<string> | null = null;
        let ownerTransaction: Promise<string> | null = null;
        let memberCreated = false;

        const lockRole = (
          tx: Prisma.TransactionClient,
          role: typeof ownerRole | typeof contenderRole,
        ) => role === "activation"
          ? lockHostedMemberRow(tx, memberId)
          : acquireHostedMemberHomeLinqRouteLockTx({
              memberId,
              prisma: tx,
            });

        try {
          await observer.hostedMember.create({
            data: { id: memberId },
          });
          memberCreated = true;

          ownerTransaction = owner.$transaction(async (tx) => {
            await lockRole(tx, ownerRole);
            ownerLocked.resolve();
            await releaseOwner.promise;
            return ownerRole;
          }, transactionOptions);
          await ownerLocked.promise;

          contenderTransaction = contender.$transaction(async (tx) => {
            contenderPid.resolve(await readBackendPid(tx));
            await lockRole(tx, contenderRole);
            return contenderRole;
          }, transactionOptions);
          await waitForBlockedBackend({
            observer,
            pid: await contenderPid.promise,
          });

          releaseOwner.resolve();
          await expect(
            Promise.all([ownerTransaction, contenderTransaction]),
          ).resolves.toEqual([ownerRole, contenderRole]);
        } finally {
          releaseOwner.resolve();
          await Promise.allSettled(
            [ownerTransaction, contenderTransaction].filter(
              (transaction): transaction is Promise<string> =>
                transaction !== null,
            ),
          );
          if (memberCreated) {
            await observer.hostedMember.deleteMany({
              where: { id: memberId },
            });
          }
          await disconnectClients([observer, owner, contender]);
        }
      },
    );

    it.each([
      ["reclassified-message", "active-message"],
      ["active-message", "reclassified-message"],
    ] as const)(
      "serializes %s then %s through the member row before mailbox append",
      async (ownerRole, contenderRole) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
        const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
        const memberId = `hbm_linq_route_mailbox_${randomUUID()}`;
        const ownerLocked = createDeferred();
        const contenderPid = createDeferred<number>();
        const releaseOwner = createDeferred();
        let ownerTransaction: Promise<string> | null = null;
        let contenderTransaction: Promise<string> | null = null;
        let memberCreated = false;

        const runMessage = async (
          tx: Prisma.TransactionClient,
          role: typeof ownerRole | typeof contenderRole,
        ): Promise<string> => {
          if (role === "reclassified-message") {
            await lockHostedMemberRow(tx, memberId);
          }
          await acquireHostedMemberHomeLinqRouteLockTx({
            memberId,
            prisma: tx,
          });
          await appendHostedMailboxItemTx({
            dedupeKey: `linq-route-mailbox:${role}:${randomUUID()}`,
            kind: "conversation.message",
            lane: "conversation",
            occurredAt: new Date(),
            payloadSerializedJson: JSON.stringify({ kind: "lock-proof" }),
            tx,
            userId: memberId,
          });
          return role;
        };

        try {
          await observer.hostedMember.create({
            data: { id: memberId },
          });
          memberCreated = true;

          ownerTransaction = owner.$transaction(async (tx) => {
            const result = await runMessage(tx, ownerRole);
            ownerLocked.resolve();
            await releaseOwner.promise;
            return result;
          }, transactionOptions);
          await ownerLocked.promise;

          contenderTransaction = contender.$transaction(async (tx) => {
            contenderPid.resolve(await readBackendPid(tx));
            return runMessage(tx, contenderRole);
          }, transactionOptions);
          await waitForBlockedBackend({
            observer,
            pid: await contenderPid.promise,
          });

          releaseOwner.resolve();
          await expect(
            Promise.all([ownerTransaction, contenderTransaction]),
          ).resolves.toEqual([ownerRole, contenderRole]);
        } finally {
          releaseOwner.resolve();
          await Promise.allSettled(
            [ownerTransaction, contenderTransaction].filter(
              (transaction): transaction is Promise<string> =>
                transaction !== null,
            ),
          );
          if (memberCreated) {
            await observer.hostedMailboxItem.deleteMany({
              where: { userId: memberId },
            });
            await observer.hostedMember.deleteMany({
              where: { id: memberId },
            });
          }
          await disconnectClients([observer, owner, contender]);
        }
      },
    );

    it("takes the member owner before a participant-contact routing claim", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_linq_participant_order_${randomUUID()}`;
      const contact = createHostedLinqParticipantContact({
        kind: "email",
        value: `${randomUUID()}@example.test`,
      });
      if (!contact) {
        throw new Error("Expected the participant contact to normalize.");
      }
      const ownerLocked = createDeferred();
      const contenderPid = createDeferred<number>();
      const releaseOwner = createDeferred();
      let ownerTransaction: Promise<void> | null = null;
      let contenderTransaction: Promise<void> | null = null;
      let memberCreated = false;

      try {
        await observer.hostedMember.create({
          data: { id: memberId },
        });
        memberCreated = true;

        ownerTransaction = owner.$transaction(async (tx) => {
          await acquireHostedMemberHomeLinqRouteLockTx({
            memberId,
            prisma: tx,
          });
          ownerLocked.resolve();
          await releaseOwner.promise;
          await upsertHostedMemberPendingLinqBindingTx({
            homeLineAssignedAt: new Date(),
            linqChatId: `linq-participant-order-${randomUUID()}`,
            memberId,
            participantContact: contact,
            participantContactObservedAt: new Date(),
            prisma: tx,
            recipientPhone: "+15550100001",
          });
        }, transactionOptions);
        await ownerLocked.promise;

        contenderTransaction = contender.$transaction(async (tx) => {
          contenderPid.resolve(await readBackendPid(tx));
          await upsertHostedMemberPendingLinqParticipantContactTx({
            contact,
            memberId,
            observedAt: new Date(),
            prisma: tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer,
          pid: await contenderPid.promise,
        });

        releaseOwner.resolve();
        await expect(
          Promise.all([ownerTransaction, contenderTransaction]),
        ).resolves.toEqual([undefined, undefined]);
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled(
          [ownerTransaction, contenderTransaction].filter(
            (transaction): transaction is Promise<void> =>
              transaction !== null,
          ),
        );
        if (memberCreated) {
          await observer.hostedMemberRouting.deleteMany({
            where: { memberId },
          });
          await observer.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([observer, owner, contender]);
      }
    });

    it.each([
      ["active", "telegram-first"],
      ["active", "linq-first"],
      ["activation-race", "telegram-first"],
      ["activation-race", "linq-first"],
    ] as const)(
      "keeps %s-member Telegram and Linq planner mailbox writes deadlock-free with %s routing",
      async (memberState, startOrder) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const activation = createPrismaClient({ databaseUrl, poolMax: 1 });
        const telegramBase = createPrismaClient({ databaseUrl, poolMax: 1 });
        const linqBase = createPrismaClient({ databaseUrl, poolMax: 1 });
        const memberId = `hbm_cross_channel_route_${randomUUID()}`;
        const linqChatId = `linq-cross-channel-${randomUUID()}`;
        const linqEventId = `linq-cross-channel-event-${randomUUID()}`;
        const telegramIdSeed = Number.parseInt(
          randomUUID().replaceAll("-", "").slice(0, 12),
          16,
        );
        const telegramUpdate = parseHostedTelegramWebhookUpdate(JSON.stringify({
          message: {
            chat: {
              id: telegramIdSeed,
              type: "private",
            },
            date: 1_784_764_800,
            from: {
              first_name: "Test",
              id: telegramIdSeed,
            },
            message_id: telegramIdSeed,
            text: "hello",
          },
          update_id: telegramIdSeed,
        }));
        const telegramUserId = String(telegramIdSeed);
        const telegramEventId = buildHostedTelegramWebhookEventId(telegramUpdate);
        const telegramThreadId =
          buildHostedTelegramMessagePayload(telegramUpdate)?.threadId;
        const participantContact = createHostedLinqParticipantContact({
          kind: "phone",
          value: "+15551234567",
        });
        const linqEvent = parseHostedLinqWebhookEvent(JSON.stringify({
          api_version: "v3",
          created_at: "2026-07-23T12:00:00.000Z",
          data: {
            chat: {
              id: linqChatId,
              is_group: false,
              owner_handle: {
                handle: "+15550000000",
                id: "owner-handle",
                is_me: true,
                service: "sms",
              },
            },
            direction: "inbound",
            id: `linq-message-${randomUUID()}`,
            parts: [{ type: "text", value: "hello" }],
            sender_handle: {
              handle: "+15551234567",
              id: "sender-handle",
              service: "sms",
            },
            sent_at: "2026-07-23T12:00:00.000Z",
            service: "sms",
          },
          event_id: linqEventId,
          event_type: "message.received",
          webhook_version: "2026-02-03",
        }));
        if (!participantContact || !telegramThreadId) {
          throw new Error("Expected valid dual-channel test routing inputs.");
        }

        const telegramRouteUpserted = createDeferred();
        const releaseTelegramUpsert = createDeferred();
        const linqRouteUpsertReached = createDeferred();
        const releaseLinqUpsert = createDeferred();
        const activationUpdated = createDeferred();
        const releaseActivation = createDeferred();
        const telegramPid = createDeferred<number>();
        const linqPid = createDeferred<number>();
        const telegramClient = telegramBase.$extends({
          query: {
            hostedMemberRouting: {
              async upsert({ args, query }) {
                const result = await query(args);
                if (startOrder === "telegram-first") {
                  telegramRouteUpserted.resolve();
                  await releaseTelegramUpsert.promise;
                }
                return result;
              },
            },
          },
        });
        const linqClient = linqBase.$extends({
          query: {
            hostedMemberRouting: {
              async upsert({ args, query }) {
                if (startOrder === "linq-first") {
                  linqRouteUpsertReached.resolve();
                  await releaseLinqUpsert.promise;
                }
                return query(args);
              },
            },
          },
        });
        let memberCreated = false;
        let activationTransaction = Promise.resolve();
        let telegramTransaction = Promise.resolve<string | undefined>(undefined);
        let linqTransaction = Promise.resolve<string | undefined>(undefined);

        try {
          await observer.hostedMember.create({
            data: {
              billingStatus: memberState === "active"
                ? HostedBillingStatus.active
                : HostedBillingStatus.not_started,
              id: memberId,
            },
          });
          memberCreated = true;
          await observer.$transaction(async (tx) => {
            await upsertHostedMemberHomeLinqBindingTx({
              clearPending: true,
              homeLineAssignedAt: new Date("2026-07-23T11:00:00.000Z"),
              linqChatId,
              memberId,
              participantContact,
              prisma: tx,
              recipientPhone: "+15550000000",
            });
            await upsertHostedMemberTelegramRoutingBindingTx({
              memberId,
              prisma: tx,
              telegramThreadId,
              telegramUserId,
            });
          }, transactionOptions);

          const runTelegram = () => {
            telegramTransaction = telegramClient.$transaction(async (tx) => {
              // Prisma's query extension preserves the transaction client's
              // runtime surface but widens only its generated generic metadata.
              const prisma = tx as Prisma.TransactionClient;
              telegramPid.resolve(await readBackendPid(prisma));
              const plan = await planHostedOnboardingTelegramWebhook({
                prisma,
                update: telegramUpdate,
              });
              return plan.response.reason;
            }, transactionOptions);
          };
          const runLinq = () => {
            linqTransaction = linqClient.$transaction(async (tx) => {
              // Keep production planners on their ordinary transaction type;
              // the extension changes only this test's routing-upsert timing.
              const prisma = tx as Prisma.TransactionClient;
              linqPid.resolve(await readBackendPid(prisma));
              const plan = await planHostedOnboardingLinqWebhook({
                event: linqEvent,
                prisma,
              });
              return plan.response.reason;
            }, transactionOptions);
          };

          if (memberState === "activation-race") {
            activationTransaction = activation.$transaction(async (tx) => {
              // Match production activation's member-row owner and core-state
              // write while keeping unrelated crypto provisioning out of this
              // lock-order proof.
              await lockHostedMemberRow(tx, memberId);
              await updateHostedMemberCoreState({
                billingStatus: HostedBillingStatus.active,
                memberId,
                prisma: tx,
              });
              activationUpdated.resolve();
              await releaseActivation.promise;
            }, transactionOptions);
            await activationUpdated.promise;
            if (startOrder === "telegram-first") {
              runTelegram();
              await waitForBlockedBackend({
                observer,
                pid: await telegramPid.promise,
              });
              releaseActivation.resolve();
              await activationTransaction;
              await telegramRouteUpserted.promise;
            } else {
              runLinq();
              await waitForBlockedBackend({
                observer,
                pid: await linqPid.promise,
              });
              releaseActivation.resolve();
              await activationTransaction;
              await linqRouteUpsertReached.promise;
            }
          }

          if (startOrder === "telegram-first") {
            if (memberState === "active") {
              runTelegram();
              await telegramRouteUpserted.promise;
            }
            runLinq();
            await waitForBlockedBackend({
              observer,
              pid: await linqPid.promise,
            });
            releaseTelegramUpsert.resolve();
          } else {
            if (memberState === "active") {
              runLinq();
              await linqRouteUpsertReached.promise;
            }
            runTelegram();
            await waitForBlockedBackend({
              observer,
              pid: await telegramPid.promise,
            });
            releaseLinqUpsert.resolve();
          }

          await expect(
            Promise.all([
              activationTransaction,
              telegramTransaction,
              linqTransaction,
            ]),
          ).resolves.toEqual([
            undefined,
            "wake-appended-active-member",
            "wake-appended-active-member",
          ]);
          await expect(observer.hostedMailboxItem.findMany({
            orderBy: { dedupeKey: "asc" },
            select: { dedupeKey: true },
            where: {
              dedupeKey: { in: [linqEventId, telegramEventId] },
              userId: memberId,
            },
          })).resolves.toEqual(
            [linqEventId, telegramEventId]
              .sort()
              .map((dedupeKey) => ({ dedupeKey })),
          );
          await expect(lookupHostedMemberRoutingByHomeLinqChatId({
            linqChatId,
            prisma: observer,
          })).resolves.toMatchObject({
            core: { id: memberId },
          });
          await expect(resolveHostedMemberRoutingByTelegramUserId({
            prisma: observer,
            telegramUserId,
          })).resolves.toMatchObject({
            lookup: { core: { id: memberId } },
            status: "found",
          });
        } finally {
          releaseTelegramUpsert.resolve();
          releaseLinqUpsert.resolve();
          releaseActivation.resolve();
          await Promise.allSettled([
            activationTransaction,
            telegramTransaction,
            linqTransaction,
          ]);
          if (memberCreated) {
            await observer.hostedMailboxItem.deleteMany({
              where: { userId: memberId },
            });
            await observer.hostedMember.deleteMany({
              where: { id: memberId },
            });
          }
          await disconnectClients([
            observer,
            activation,
            telegramBase,
            linqBase,
          ]);
        }
      },
    );
  },
);

async function disconnectClients(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
}

function requireString(value: string | null): string {
  if (!value) {
    throw new Error("Expected the test member to exist.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
