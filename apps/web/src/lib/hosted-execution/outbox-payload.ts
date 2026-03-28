import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
} from "@murph/hosted-execution";
import {
  HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef as readSharedHostedExecutionDispatchRef,
} from "@murph/hosted-execution";

export { HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION } from "@murph/hosted-execution";

export type HostedExecutionDispatchRef = Prisma.InputJsonObject & SharedHostedExecutionDispatchRef;

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return buildSharedHostedExecutionDispatchRef(dispatch) as HostedExecutionDispatchRef;
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
): Prisma.InputJsonObject {
  return {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  } satisfies Prisma.InputJsonObject;
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  fallback: {
    eventId: string;
    eventKind: string;
    occurredAt: string | null;
    userId: string;
  },
): HostedExecutionDispatchRef | null {
  const dispatchRef = readSharedHostedExecutionDispatchRef(payloadJson, fallback);

  return dispatchRef
    ? dispatchRef as HostedExecutionDispatchRef
    : null;
}
