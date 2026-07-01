import "server-only";

import {
  buildHostedExecutionVaultShareDeliveryWake,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareDeliveryDedupeKey,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  isHostedVaultShareProjectionKind,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import type { Prisma, PrismaClient } from "@prisma/client";

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
  lastAppendedMailboxItemId: string | null;
}

type HostedVaultShareAuthorityRow = {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  status: string;
};

/**
 * Appends one typed `vault-share.delivery` wake envelope per shared record into the
 * destination mailbox, all in a single transaction per share. The envelope eventId doubles
 * as the mailbox dedupe key — derived from (shareId, recordKey) — and occurredAt comes from
 * the record itself (parser-pinned to the night date for sleep-times), so the envelope is
 * fully deterministic for a given (share, record) and re-offering an already-delivered
 * record is a byte-identical no-op rather than a dedupe conflict. Payload data rides the
 * standard encrypted mailbox path; only the dedupe key and night-date occurredAt are
 * plaintext mailbox metadata.
 */
export async function deliverHostedVaultShareRecords(input: {
  prisma?: PrismaClient;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: ActiveHostedVaultShare;
}): Promise<DeliverHostedVaultShareRecordsResult> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    let lastAppendedMailboxItemId: string | null = null;
    const share = await readGrantedHostedVaultShareForUpdateTx({
      share: input.share,
      tx,
    });

    if (!share) {
      return { lastAppendedMailboxItemId };
    }

    for (const record of input.records) {
      const envelope = buildHostedExecutionVaultShareDeliveryWake({
        delivery: {
          grantorMemberId: share.grantorMemberId,
          projectionKind: share.projectionKind,
          record,
          schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
          shareId: share.id,
        },
        eventId: buildHostedVaultShareDeliveryDedupeKey({
          recordKey: record.recordKey,
          shareId: share.id,
        }),
        memberId: share.destinationMemberId,
      });
      const result = await appendHostedMailboxEnvelopeTx({
        envelope,
        tx,
      });

      if (result.inserted) {
        lastAppendedMailboxItemId = result.item.id;
      }
    }

    return { lastAppendedMailboxItemId };
  });
}

async function readGrantedHostedVaultShareForUpdateTx(input: {
  share: ActiveHostedVaultShare;
  tx: Prisma.TransactionClient;
}): Promise<ActiveHostedVaultShare | null> {
  const rows = await input.tx.$queryRaw<HostedVaultShareAuthorityRow[]>`
    SELECT
      id,
      grantor_member_id AS "grantorMemberId",
      projection_kind AS "projectionKind",
      destination_member_id AS "destinationMemberId",
      status
    FROM hosted_vault_share
    WHERE id = ${input.share.id}
    FOR UPDATE
  `;
  const row = rows[0];

  if (
    !row
    || row.status !== "granted"
    || row.grantorMemberId !== input.share.grantorMemberId
    || row.destinationMemberId !== input.share.destinationMemberId
    || row.projectionKind !== input.share.projectionKind
  ) {
    return null;
  }

  return input.share;
}
