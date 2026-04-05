import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchPayloadRef as SharedHostedExecutionDispatchPayloadRef,
  HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
  HostedExecutionOutboxPayload as SharedHostedExecutionOutboxPayload,
  HostedExecutionOutboxPayloadStorage,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload as buildSharedHostedExecutionOutboxPayload,
  readHostedExecutionDispatchPayloadRef as readSharedHostedExecutionDispatchPayloadRef,
  readHostedExecutionDispatchRef as readSharedHostedExecutionDispatchRef,
  readHostedExecutionOutboxPayload as readSharedHostedExecutionOutboxPayload,
} from "@murphai/hosted-execution";

export { HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION } from "@murphai/hosted-execution";

export type HostedExecutionDispatchPayloadRef =
  Prisma.InputJsonObject & SharedHostedExecutionDispatchPayloadRef;
export type HostedExecutionDispatchRef = Prisma.InputJsonObject & SharedHostedExecutionDispatchRef;
export type HostedExecutionOutboxPayload = SharedHostedExecutionOutboxPayload;

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return buildSharedHostedExecutionDispatchRef(dispatch) as HostedExecutionDispatchRef;
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    payloadRef?: HostedExecutionDispatchPayloadRef | null;
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): Prisma.InputJsonObject {
  return buildSharedHostedExecutionOutboxPayload(dispatch, options) as unknown as Prisma.InputJsonObject;
}

export function readHostedExecutionDispatchPayloadRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchPayloadRef | null {
  const payloadRef = readSharedHostedExecutionDispatchPayloadRef(payloadJson);

  return payloadRef
    ? payloadRef as HostedExecutionDispatchPayloadRef
    : null;
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchRef | null {
  const dispatchRef = readSharedHostedExecutionDispatchRef(payloadJson);

  return dispatchRef
    ? dispatchRef as HostedExecutionDispatchRef
    : null;
}

export function readHostedExecutionOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionOutboxPayload | null {
  return readSharedHostedExecutionOutboxPayload(payloadJson);
}
