import "server-only";

import { createHash } from "node:crypto";

import {
  buildHostedExecutionVaultShareDeliveryWake,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareProjectionScopeKey,
  buildHostedVaultShareDeliveryDedupeKey,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  isHostedVaultShareCurrentStateProjectionKind,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "./runtime-access";
import { appendHostedMailboxEnvelopeTx } from "./store";

export interface ActiveHostedVaultShare {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

export async function findActiveHostedVaultShares(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
  projectionScope: HostedVaultShareProjectionScope;
}): Promise<ActiveHostedVaultShare[]> {
  const prisma = input.prisma ?? getPrisma();
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
    input.projectionScope,
  );
  const rows = await prisma.hostedVaultShare.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      destinationMemberId: true,
      grantorMemberId: true,
      id: true,
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionScopeKey,
      status: "granted",
    },
  });

  return rows.flatMap((row) => {
    const projectionScope = parseHostedVaultShareRowProjectionScope(row);
    if (!projectionScope) {
      return [];
    }
    const rowScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);

    return [{
      destinationMemberId: row.destinationMemberId,
      grantorMemberId: row.grantorMemberId,
      id: row.id,
      projectionKind: projectionScope.projectionKind,
      projectionScope,
      projectionScopeKey: rowScopeKey,
    }];
  });
}

export async function readDeliverableHostedVaultShareProjectionScopes(input: {
  grantorMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedVaultShareProjectionScope[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedVaultShare.findMany({
    distinct: ["projectionScopeKey"],
    orderBy: { projectionScopeKey: "asc" },
    select: {
      projectionKind: true,
      projectionScopeJson: true,
      projectionScopeKey: true,
    },
    where: {
      destination: activeHostedMemberAccessWhere(),
      grantorMemberId: input.grantorMemberId,
      status: "granted",
    },
  });

  return rows
    .map(parseHostedVaultShareRowProjectionScope)
    .filter((scope): scope is HostedVaultShareProjectionScope => scope !== null);
}

export interface DeliverHostedVaultShareRecordsResult {
  lastAppendedMailboxItemId: string | null;
}

type HostedVaultShareAuthorityRow = {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  projectionScopeJson: unknown;
  projectionScopeKey: string;
  status: string;
};

/**
 * Appends one typed `vault-share.delivery` wake envelope per shared record into the
 * destination mailbox, all in a single transaction per share. The envelope eventId doubles
 * as the mailbox dedupe key — derived from (shareId, recordKey, payload/source revision) —
 * while destination replacement remains keyed by recordKey. Exact replays dedupe, but
 * corrected payloads for the same logical record append a new mailbox item and replace the
 * destination record during import. Payload data rides the standard encrypted mailbox path;
 * only the dedupe key and night-date occurredAt are plaintext mailbox metadata.
 */
export async function deliverHostedVaultShareRecords(input: {
  prisma?: PrismaClient;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: ActiveHostedVaultShare;
}): Promise<DeliverHostedVaultShareRecordsResult> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    let lastAppendedMailboxItemId: string | null = null;
    if (!await hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
      input.share.grantorMemberId,
      tx,
    )) {
      return { lastAppendedMailboxItemId };
    }

    if (!await hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
      input.share.destinationMemberId,
      tx,
    )) {
      return { lastAppendedMailboxItemId };
    }

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
          projectionScope: share.projectionScope,
          record,
          schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
          shareId: share.id,
        },
        eventId: buildHostedVaultShareDeliveryDedupeKey({
          recordKey: record.recordKey,
          recordRevision: deriveHostedVaultShareRecordRevision({
            projectionKind: share.projectionKind,
            projectionScopeKey: share.projectionScopeKey,
            record,
          }),
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

async function hasHostedVaultShareRuntimeActiveAccessForUpdateTx(
  memberId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccessForUpdateTx(memberId, {
      prisma: tx,
    });
    return true;
  } catch (error) {
    if (isHostedRuntimeInactiveAccessError(error)) {
      return false;
    }
    throw error;
  }
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
      projection_scope_json AS "projectionScopeJson",
      projection_scope_key AS "projectionScopeKey",
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
    || row.projectionScopeKey !== input.share.projectionScopeKey
  ) {
    return null;
  }

  return input.share;
}

function deriveHostedVaultShareRecordRevision(input: {
  projectionKind: HostedVaultShareProjectionKind;
  projectionScopeKey: string;
  record: HostedVaultShareDeliveryRecord;
}): string {
  const canonicalRecord = JSON.stringify({
    data: input.record.data,
    // Current-state kinds hash the content alone: occurredAt is grantor-runtime-controlled
    // metadata with no age bound for these kinds, so including it would let drifted
    // timestamps mint unbounded dedupe keys for the same unchanged fact. Time-series kinds
    // keep occurredAt in the revision (it is parser-pinned to the record identity there).
    occurredAt: isHostedVaultShareCurrentStateProjectionKind(input.projectionKind)
      ? null
      : input.record.occurredAt,
    projectionKind: input.projectionKind,
    projectionScopeKey: input.projectionScopeKey,
    recordKey: input.record.recordKey,
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    sourceRevision: input.record.sourceRevision ?? null,
  });
  return createHash("sha256")
    .update(canonicalRecord)
    .digest("base64url")
    .slice(0, 32);
}

function parseHostedVaultShareRowProjectionScope(row: {
  projectionKind: string;
  projectionScopeJson: unknown;
  projectionScopeKey: string;
}): HostedVaultShareProjectionScope | null {
  try {
    const scope = parseHostedVaultShareProjectionScope(
      row.projectionScopeJson ?? row.projectionKind,
      "Hosted vault-share row projection scope",
    );
    if (
      scope.projectionKind !== row.projectionKind
      || buildHostedVaultShareProjectionScopeKey(scope) !== row.projectionScopeKey
    ) {
      return null;
    }
    return scope;
  } catch {
    return null;
  }
}
