import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionOutboxPayload as SharedHostedExecutionOutboxPayload,
  HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  buildHostedExecutionOutboxPayload as buildSharedHostedExecutionOutboxPayload,
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  readHostedExecutionOutboxPayload as readSharedHostedExecutionOutboxPayload,
  readHostedExecutionDispatchRef as readSharedHostedExecutionDispatchRef,
} from "@murphai/hosted-execution";

export { HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION } from "@murphai/hosted-execution";

export type HostedExecutionDispatchRef = Prisma.InputJsonObject & SharedHostedExecutionDispatchRef;
export type HostedExecutionOutboxPayload = SharedHostedExecutionOutboxPayload;

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return buildSharedHostedExecutionDispatchRef(dispatch) as HostedExecutionDispatchRef;
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
): Prisma.InputJsonObject {
  return buildSharedHostedExecutionOutboxPayload(dispatch) as unknown as Prisma.InputJsonObject;
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

export function readHostedExecutionOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  fallback: {
    eventId: string;
    eventKind: string;
    occurredAt: string | null;
    userId: string;
  },
): HostedExecutionOutboxPayload | null {
  return readSharedHostedExecutionOutboxPayload(payloadJson, fallback);
}
