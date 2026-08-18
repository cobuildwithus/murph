import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/src/lib/prisma";

export const HOSTED_OUTBOUND_MESSAGE_VOLUME_CHANNELS = [
  "email",
  "telegram",
] as const;

export type HostedOutboundMessageVolumeChannel =
  (typeof HOSTED_OUTBOUND_MESSAGE_VOLUME_CHANNELS)[number];

type HostedOutboundMessageVolumePrisma = Pick<
  PrismaClient,
  "hostedOutboundMessageVolumeReceipt"
>;

const ASSISTANT_OUTBOX_DEDUPE_KEY_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * Records one anonymous company-wide receipt for a successful conversational
 * delivery. The primary key makes runtime retries/replays idempotent, while
 * `recordedAt` stays at the database's first receipt time so late callbacks
 * remain in the live window rather than rewriting completed UTC snapshots.
 */
export async function recordHostedOutboundMessageVolumeReceipt(input: {
  authenticatedUserId: string;
  channel: HostedOutboundMessageVolumeChannel;
  dedupeKey: string;
  prisma?: HostedOutboundMessageVolumePrisma;
}): Promise<{ recordedAt: Date }> {
  const authenticatedUserId = input.authenticatedUserId.trim();
  const dedupeKey = input.dedupeKey.trim();
  if (!authenticatedUserId) {
    throw new TypeError("Hosted outbound message-volume receipt requires a user.");
  }
  if (!ASSISTANT_OUTBOX_DEDUPE_KEY_PATTERN.test(dedupeKey)) {
    throw new TypeError(
      "Hosted outbound message-volume receipt requires an outbox dedupe key.",
    );
  }

  const receiptLookupKey = createHash("sha256")
    .update(JSON.stringify([
      "murph.hosted-outbound-message-volume-receipt.v1",
      authenticatedUserId,
      input.channel,
      dedupeKey,
    ]))
    .digest("hex");
  const prisma = input.prisma ?? getPrisma();
  return prisma.hostedOutboundMessageVolumeReceipt.upsert({
    create: {
      channel: input.channel,
      receiptLookupKey,
    },
    select: {
      recordedAt: true,
    },
    // The key includes channel, so this no-op value assignment lets Postgres
    // return the original row atomically under concurrent duplicate callbacks.
    update: {
      channel: input.channel,
    },
    where: {
      receiptLookupKey,
    },
  });
}
