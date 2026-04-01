import type { Prisma } from "@prisma/client";

import { getPrisma } from "../src/lib/prisma";
import {
  createHostedOpaqueIdentifier,
  createHostedPhoneLookupKey,
  createHostedTelegramUserLookupKey,
  isHostedBlindIndex,
  readHostedPhoneHint,
  sanitizeHostedLinqEventForStorage,
  sanitizeHostedStripeObjectForStorage,
  sanitizeHostedTelegramUpdateForStorage,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptState,
} from "../src/lib/hosted-onboarding/webhook-receipt-codec";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

async function main() {
  const prisma = getPrisma();
  const summary = {
    hostedInvites: 0,
    hostedMembers: 0,
    hostedSessions: 0,
    linqBindings: 0,
    linqWebhookEvents: 0,
    stripeEvents: 0,
    webhookReceipts: 0,
  };

  console.log(
    "Hosted contact-privacy backfill scans each table eagerly. It is intended for the current hard cutover on an empty or small dataset; batch it before reusing at larger scale.",
  );

  try {
    for (const record of await prisma.hostedMember.findMany({
      select: {
        id: true,
        linqChatId: true,
        maskedPhoneNumberHint: true,
        normalizedPhoneNumber: true,
        telegramUserId: true,
        telegramUsername: true,
      },
    })) {
      const nextPhoneLookupKey = deriveHostedPhoneLookupKey(
        record.normalizedPhoneNumber,
        record.maskedPhoneNumberHint,
      );
      const nextPhoneHint = readHostedPhoneHint(record.maskedPhoneNumberHint);
      const nextTelegramLookupKey = deriveHostedTelegramLookupKey(record.telegramUserId);
      const nextData: Record<string, unknown> = {};

      if (nextPhoneLookupKey && nextPhoneLookupKey !== record.normalizedPhoneNumber) {
        nextData.normalizedPhoneNumber = nextPhoneLookupKey;
      }

      if (nextPhoneHint !== record.maskedPhoneNumberHint) {
        nextData.maskedPhoneNumberHint = nextPhoneHint;
      }

      if (
        record.telegramUserId
        && nextTelegramLookupKey
        && nextTelegramLookupKey !== record.telegramUserId
      ) {
        nextData.telegramUserId = nextTelegramLookupKey;
      }

      if (record.telegramUsername) {
        nextData.telegramUsername = null;
      }

      if (record.linqChatId) {
        nextData.linqChatId = null;
      }

      if (Object.keys(nextData).length === 0) {
        continue;
      }

      summary.hostedMembers += 1;
      if (apply) {
        await prisma.hostedMember.update({
          where: { id: record.id },
          data: nextData,
        });
      }
    }

    for (const record of await prisma.hostedInvite.findMany({
      where: {
        OR: [
          { triggerText: { not: null } },
          { linqChatId: { not: null } },
          { linqEventId: { not: null } },
        ],
      },
      select: { id: true },
    })) {
      summary.hostedInvites += 1;
      if (apply) {
        await prisma.hostedInvite.update({
          where: { id: record.id },
          data: {
            linqChatId: null,
            linqEventId: null,
            triggerText: null,
          },
        });
      }
    }

    for (const record of await prisma.hostedSession.findMany({
      where: { userAgent: { not: null } },
      select: { id: true },
    })) {
      summary.hostedSessions += 1;
      if (apply) {
        await prisma.hostedSession.update({
          where: { id: record.id },
          data: { userAgent: null },
        });
      }
    }

    for (const record of await prisma.linqRecipientBinding.findMany({
      select: {
        id: true,
        recipientPhone: true,
        recipientPhoneMask: true,
      },
    })) {
      const nextLookupKey = deriveHostedPhoneLookupKey(record.recipientPhone, null);
      const nextMask = record.recipientPhoneMask ?? readHostedPhoneHint(record.recipientPhone);
      const nextData: Record<string, unknown> = {};

      if (nextLookupKey && nextLookupKey !== record.recipientPhone) {
        nextData.recipientPhone = nextLookupKey;
      }

      if (nextMask !== record.recipientPhoneMask) {
        nextData.recipientPhoneMask = nextMask;
      }

      if (Object.keys(nextData).length === 0) {
        continue;
      }

      summary.linqBindings += 1;
      if (apply) {
        await prisma.linqRecipientBinding.update({
          where: { id: record.id },
          data: nextData,
        });
      }
    }

    for (const record of await prisma.linqWebhookEvent.findMany({
      select: {
        chatId: true,
        id: true,
        messageId: true,
        recipientPhone: true,
      },
    })) {
      const nextLookupKey = deriveHostedPhoneLookupKey(record.recipientPhone, null);
      const nextChatId = deriveOpaqueIdentifier(record.chatId, "linq.chat");
      const nextMessageId = deriveOpaqueIdentifier(record.messageId, "linq.message");
      const nextData: Record<string, unknown> = {};

      if (nextLookupKey && nextLookupKey !== record.recipientPhone) {
        nextData.recipientPhone = nextLookupKey;
      }

      if (nextChatId !== undefined && nextChatId !== record.chatId) {
        nextData.chatId = nextChatId;
      }

      if (nextMessageId !== undefined && nextMessageId !== record.messageId) {
        nextData.messageId = nextMessageId;
      }

      if (Object.keys(nextData).length === 0) {
        continue;
      }

      summary.linqWebhookEvents += 1;
      if (apply) {
        await prisma.linqWebhookEvent.update({
          where: { id: record.id },
          data: nextData,
        });
      }
    }

    for (const record of await prisma.hostedWebhookReceipt.findMany({
      where: {
        source: {
          in: ["linq", "telegram"],
        },
      },
      select: {
        eventId: true,
        payloadJson: true,
        source: true,
      },
    })) {
      const nextPayloadJson = sanitizeHostedWebhookReceiptPayload(record.payloadJson);
      if (jsonStableStringify(nextPayloadJson) === jsonStableStringify(record.payloadJson)) {
        continue;
      }

      summary.webhookReceipts += 1;
      if (apply) {
        await prisma.hostedWebhookReceipt.update({
          where: {
            source_eventId: {
              eventId: record.eventId,
              source: record.source,
            },
          },
          data: {
            payloadJson: nextPayloadJson as Prisma.InputJsonValue,
          },
        });
      }
    }

    for (const record of await prisma.hostedStripeEvent.findMany({
      select: {
        eventId: true,
        payloadJson: true,
      },
    })) {
      const nextPayloadJson = sanitizeHostedStripePayloadJson(record.payloadJson);
      if (jsonStableStringify(nextPayloadJson) === jsonStableStringify(record.payloadJson)) {
        continue;
      }

      summary.stripeEvents += 1;
      if (apply) {
        await prisma.hostedStripeEvent.update({
          where: { eventId: record.eventId },
          data: {
            payloadJson: nextPayloadJson as Prisma.InputJsonValue,
          },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`${apply ? "Applied" : "Planned"} hosted contact-privacy backfill:`);
  for (const [key, value] of Object.entries(summary)) {
    console.log(`- ${key}: ${value}`);
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to persist these changes.");
  }
}

function deriveHostedPhoneLookupKey(
  primaryValue: string | null | undefined,
  fallbackValue: string | null | undefined,
): string | null {
  if (isHostedBlindIndex(primaryValue, "phone")) {
    return primaryValue as string;
  }

  return createHostedPhoneLookupKey(primaryValue) ?? createHostedPhoneLookupKey(fallbackValue);
}

function deriveHostedTelegramLookupKey(value: string | null | undefined): string | null {
  if (isHostedBlindIndex(value, "telegram-user")) {
    return value as string;
  }

  return createHostedTelegramUserLookupKey(value);
}

function deriveOpaqueIdentifier(
  value: string | null | undefined,
  kind: string,
): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  return value.startsWith(`hbid:${kind}:`)
    ? value
    : createHostedOpaqueIdentifier(kind, value);
}

function sanitizeHostedWebhookReceiptPayload(
  payloadJson: Prisma.JsonValue | null,
): Prisma.InputJsonValue | Prisma.JsonValue | null {
  if (!payloadJson) {
    return payloadJson;
  }

  const state = readHostedWebhookReceiptState(payloadJson);
  let changed = false;

  state.sideEffects = state.sideEffects.map((effect) => {
    if (effect.kind === "hosted_execution_dispatch") {
      if (effect.payload.linqEvent && typeof effect.payload.linqEvent === "object" && !Array.isArray(effect.payload.linqEvent)) {
        const nextLookup = deriveHostedPhoneLookupKey(effect.payload.phoneLookupKey ?? null, readLinqFromValue(effect.payload.linqEvent));
        const sanitizedLinqEvent = sanitizeHostedLinqEventForStorage(effect.payload.linqEvent);
        if (jsonStableStringify(sanitizedLinqEvent) !== jsonStableStringify(effect.payload.linqEvent)) {
          effect.payload.linqEvent = sanitizedLinqEvent;
          changed = true;
        }
        if (nextLookup && nextLookup !== effect.payload.phoneLookupKey) {
          effect.payload.phoneLookupKey = nextLookup;
          changed = true;
        }
      }

      if (effect.payload.telegramUpdate && typeof effect.payload.telegramUpdate === "object" && !Array.isArray(effect.payload.telegramUpdate)) {
        const sanitizedTelegramUpdate = sanitizeHostedTelegramUpdateForStorage(effect.payload.telegramUpdate);
        if (jsonStableStringify(sanitizedTelegramUpdate) !== jsonStableStringify(effect.payload.telegramUpdate)) {
          effect.payload.telegramUpdate = sanitizedTelegramUpdate;
          changed = true;
        }
      }
    }

    return effect;
  });

  return changed ? serializeHostedWebhookReceiptState(state) : payloadJson;
}

function sanitizeHostedStripePayloadJson(
  payloadJson: Prisma.JsonValue | null,
): Prisma.InputJsonValue | Prisma.JsonValue | null {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) {
    return payloadJson;
  }

  const record = payloadJson as Record<string, unknown>;
  const nextObject: Prisma.InputJsonValue | null =
    record.object && typeof record.object === "object" && !Array.isArray(record.object)
      ? sanitizeHostedStripeObjectForStorage(record.object as Record<string, unknown>) as Prisma.InputJsonValue
      : record.object === undefined
        ? null
        : record.object as Prisma.InputJsonValue;

  return {
    ...(record as Prisma.InputJsonObject),
    object: nextObject,
  } satisfies Prisma.InputJsonObject;
}

function readLinqFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const from = (data as Record<string, unknown>).from;
  return typeof from === "string" ? from : null;
}

function jsonStableStringify(value: unknown): string {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
