import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
  HostedExecutionOutboxPayload as SharedHostedExecutionOutboxPayload,
  HostedExecutionOutboxPayloadStorage,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload as buildSharedHostedExecutionOutboxPayload,
  readHostedExecutionDispatchRef as readSharedHostedExecutionDispatchRef,
  readHostedExecutionOutboxPayload as readSharedHostedExecutionOutboxPayload,
  readHostedExecutionStagedPayloadId as readSharedHostedExecutionStagedPayloadId,
} from "@murphai/hosted-execution";

export type HostedExecutionDispatchRef = SharedHostedExecutionDispatchRef;
export type HostedExecutionOutboxPayload = SharedHostedExecutionOutboxPayload;

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return buildSharedHostedExecutionDispatchRef(dispatch);
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    stagedPayloadId?: string | null;
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): Prisma.InputJsonObject {
  return toPrismaInputJsonObject(buildSharedHostedExecutionOutboxPayload(dispatch, options));
}

export function readHostedExecutionStagedPayloadId(value: unknown): string | null {
  return readSharedHostedExecutionStagedPayloadId(value);
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchRef | null {
  return readSharedHostedExecutionDispatchRef(payloadJson);
}

export function readHostedExecutionOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionOutboxPayload | null {
  return readSharedHostedExecutionOutboxPayload(payloadJson);
}

function toPrismaInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
