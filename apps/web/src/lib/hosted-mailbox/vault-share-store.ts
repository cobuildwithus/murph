import "server-only";

import {
  buildHostedExecutionVaultShareDeliveryWake,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareDeliveryDedupeKey,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  isHostedVaultShareProjectionKind,
  type HostedVaultShareDeliveryPayload,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareSleepNight,
} from "@murphai/hosted-execution/vault-share";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { appendHostedMailboxEnvelopeTx } from "./store";

export interface ActiveHostedVaultShare {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: HostedVaultShareProjectionKind;
}

export async function findActiveHostedVaultShares(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionKind: HostedVaultShareProjectionKind;
}): Promise<ActiveHostedVaultShare[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedVaultShare.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
    },
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionKind: input.projectionKind,
      status: "granted",
    },
  });

  return rows.flatMap((row) => {
    // The query already filters on a registry kind; this narrows the Prisma string column
    // back to the closed registry without a cast and drops anything unexpected.
    if (!isHostedVaultShareProjectionKind(row.projectionKind)) {
      return [];
    }

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: row.projectionKind,
    }];
  });
}

export interface DeliverHostedVaultShareNightsResult {
  appendedDates: string[];
  duplicateDates: string[];
  lastAppendedMailboxItemId: string | null;
}

/**
 * Appends one typed `vault-share.delivery` wake envelope per shared night into the
 * destination mailbox. The envelope eventId doubles as the mailbox dedupe key — derived
 * from (shareId, night date) — so re-offering an already-delivered night is a no-op.
 * Payloads ride the standard encrypted mailbox path; nothing lands in plaintext.
 */
export async function deliverHostedVaultShareNights(input: {
  nights: readonly HostedVaultShareSleepNight[];
  prisma?: PrismaClient;
  share: ActiveHostedVaultShare;
}): Promise<DeliverHostedVaultShareNightsResult> {
  const prisma = input.prisma ?? getPrisma();
  const appendedDates: string[] = [];
  const duplicateDates: string[] = [];
  let lastAppendedMailboxItemId: string | null = null;

  for (const night of input.nights) {
    const delivery: HostedVaultShareDeliveryPayload = {
      grantorMemberId: input.share.grantorMemberId,
      night,
      projectionKind: input.share.projectionKind,
      schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
      shareId: input.share.id,
    };
    const envelope = buildHostedExecutionVaultShareDeliveryWake({
      delivery,
      eventId: buildHostedVaultShareDeliveryDedupeKey({
        date: night.date,
        shareId: input.share.id,
      }),
      memberId: input.share.destinationMemberId,
      occurredAt: new Date().toISOString(),
    });
    const result = await prisma.$transaction((tx) =>
      appendHostedMailboxEnvelopeTx({
        envelope,
        tx,
      }),
    );

    if (result.inserted) {
      appendedDates.push(night.date);
      lastAppendedMailboxItemId = result.item.id;
    } else {
      duplicateDates.push(night.date);
    }
  }

  return {
    appendedDates,
    duplicateDates,
    lastAppendedMailboxItemId,
  };
}
