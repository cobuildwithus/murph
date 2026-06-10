import "server-only";

import {
  buildHostedExecutionVaultShareDeliveryWake,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareDeliveryDedupeKey,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  isHostedVaultShareProjectionKind,
  type HostedVaultShareDeliveryPayload,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
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

export interface DeliverHostedVaultShareRecordsResult {
  appendedRecordKeys: string[];
  duplicateRecordKeys: string[];
  lastAppendedMailboxItemId: string | null;
}

/**
 * Appends one typed `vault-share.delivery` wake envelope per shared record into the
 * destination mailbox. The envelope eventId doubles as the mailbox dedupe key — derived
 * from (shareId, recordKey) — and occurredAt comes from the record itself, so the
 * envelope is fully deterministic for a given (share, record) and re-offering an
 * already-delivered record is a byte-identical no-op rather than a dedupe conflict.
 * Payloads ride the standard encrypted mailbox path; nothing lands in plaintext.
 */
export async function deliverHostedVaultShareRecords(input: {
  prisma?: PrismaClient;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: ActiveHostedVaultShare;
}): Promise<DeliverHostedVaultShareRecordsResult> {
  const prisma = input.prisma ?? getPrisma();
  const appendedRecordKeys: string[] = [];
  const duplicateRecordKeys: string[] = [];
  let lastAppendedMailboxItemId: string | null = null;

  for (const record of input.records) {
    const delivery: HostedVaultShareDeliveryPayload = {
      grantorMemberId: input.share.grantorMemberId,
      projectionKind: input.share.projectionKind,
      record,
      schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
      shareId: input.share.id,
    };
    const envelope = buildHostedExecutionVaultShareDeliveryWake({
      delivery,
      eventId: buildHostedVaultShareDeliveryDedupeKey({
        recordKey: record.recordKey,
        shareId: input.share.id,
      }),
      memberId: input.share.destinationMemberId,
      occurredAt: record.occurredAt,
    });
    const result = await prisma.$transaction((tx) =>
      appendHostedMailboxEnvelopeTx({
        envelope,
        tx,
      }),
    );

    if (result.inserted) {
      appendedRecordKeys.push(record.recordKey);
      lastAppendedMailboxItemId = result.item.id;
    } else {
      duplicateRecordKeys.push(record.recordKey);
    }
  }

  return {
    appendedRecordKeys,
    duplicateRecordKeys,
    lastAppendedMailboxItemId,
  };
}
