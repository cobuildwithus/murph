import { createHash } from "node:crypto";

import { buildHostedExecutionRuntimeControlWake } from "@murphai/hosted-execution";
import type { Prisma } from "@prisma/client";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";

const HOSTED_ACCESS_RESTORATION_OCCURRED_AT = "1970-01-01T00:00:00.000Z";

export interface HostedAccessRestorationRuntimeHandoff {
  hostedExecutionEventId: string;
  hostedExecutionMailboxItemId: string;
  memberId: string;
}

export function buildHostedAccessRestorationRuntimeEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      memberId: input.memberId,
      sourceEventId: input.sourceEventId,
      sourceType: input.sourceType,
      version: 1,
    }))
    .digest("hex")
    .slice(0, 32);
  return `runtime-control:access-restored:${fingerprint}`;
}

export async function appendHostedAccessRestorationRuntimeHandoffTx(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccessRestorationRuntimeHandoff> {
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionRuntimeControlWake({
      eventId: buildHostedAccessRestorationRuntimeEventId(input),
      kind: "runtime.maintenance-requested",
      occurredAt: HOSTED_ACCESS_RESTORATION_OCCURRED_AT,
      userId: input.memberId,
    }),
    tx: input.tx,
  });

  return {
    hostedExecutionEventId: appended.item.dedupeKey,
    hostedExecutionMailboxItemId: appended.item.id,
    memberId: appended.item.userId,
  };
}
