import "server-only";

import { createHash } from "node:crypto";

import { buildHostedExecutionRuntimeControlWake } from "@murphai/hosted-execution";
import type { Prisma } from "@prisma/client";

import type { HostedMailboxLane } from "@murphai/hosted-execution/runtime-control";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";

export interface HostedVaultShareProjectionMaintenanceSignal {
  lane: HostedMailboxLane;
  laneSeq: string;
  mailboxItemId: string;
  memberId: string;
}

export async function appendHostedVaultShareProjectionMaintenanceTx(input: {
  grantIds: readonly string[];
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedVaultShareProjectionMaintenanceSignal> {
  const grantIds = [...new Set(input.grantIds)].sort();
  const deterministicOccurredAt = "1970-01-01T00:00:00.000Z";
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ grantIds, memberId: input.memberId, version: 1 }))
    .digest("hex")
    .slice(0, 32);
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionRuntimeControlWake({
      eventId: `runtime-control:group-share-projection:${fingerprint}`,
      kind: "runtime.maintenance-requested",
      occurredAt: deterministicOccurredAt,
      userId: input.memberId,
    }),
    tx: input.tx,
  });
  return {
    lane: appended.item.lane,
    laneSeq: appended.item.laneSeq,
    mailboxItemId: appended.item.id,
    memberId: appended.item.userId,
  };
}
