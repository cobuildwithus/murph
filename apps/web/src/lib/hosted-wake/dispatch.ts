import type { Prisma } from "@prisma/client";
import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution/contracts";

import {
  HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
} from "./payload";
import {
  appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx,
  type AppendHostedWakeResult,
} from "./store";

export async function appendHostedOrderedDispatchWakeTx(input: {
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedOrderedWakeTx({
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: input.dispatch,
    payloadSchema: HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export async function appendHostedCoalescingDispatchWakeTx(input: {
  coalescingKey: string;
  dispatch: HostedExecutionDispatchRequest;
  tx: Prisma.TransactionClient;
}): Promise<AppendHostedWakeResult> {
  return appendHostedCoalescingWakeTx({
    coalescingKey: input.coalescingKey,
    dedupeKey: buildHostedWakeDispatchDedupeKey(input.dispatch),
    kind: input.dispatch.event.kind,
    occurredAt: input.dispatch.occurredAt,
    payload: input.dispatch,
    payloadSchema: HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA,
    tx: input.tx,
    userId: input.dispatch.event.userId,
  });
}

export function buildHostedWakeDispatchDedupeKey(
  dispatch: HostedExecutionDispatchRequest,
): string {
  return `dispatch:${dispatch.event.kind}:${dispatch.eventId}`;
}
