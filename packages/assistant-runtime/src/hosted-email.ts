import {
  gatewayDeliveryTargetKindValues,
  type GatewayDeliveryTargetKind,
} from "@murphai/gateway-core";

export const hostedEmailSendTargetKindValues = gatewayDeliveryTargetKindValues;

export type HostedEmailSendTargetKind = GatewayDeliveryTargetKind;

export interface HostedEmailSendRequest {
  identityId: string | null;
  message: string;
  target: string;
  targetKind: HostedEmailSendTargetKind;
  timeoutMs?: number | null;
}

export function parseHostedEmailSendRequest(value: unknown): HostedEmailSendRequest {
  const record = requireHostedEmailSendRequestObject(value, "Hosted email send request");

  return {
    identityId: readOptionalHostedEmailSendRequestString(
      record.identityId ?? null,
      "Hosted email send request identityId",
    ),
    message: requireHostedEmailSendRequestString(
      record.message,
      "Hosted email send request message",
    ),
    target: requireHostedEmailSendRequestString(
      record.target,
      "Hosted email send request target",
    ),
    targetKind: requireHostedEmailSendTargetKind(
      record.targetKind,
      "Hosted email send request targetKind",
    ),
  };
}

function requireHostedEmailSendRequestObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireHostedEmailSendRequestString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function readOptionalHostedEmailSendRequestString(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = requireHostedEmailSendRequestString(value, label).trim();
  return normalized.length > 0 ? normalized : null;
}

function requireHostedEmailSendTargetKind(
  value: unknown,
  label: string,
): HostedEmailSendTargetKind {
  const targetKind = requireHostedEmailSendRequestString(value, label);

  if (hostedEmailSendTargetKindValues.includes(targetKind as HostedEmailSendTargetKind)) {
    return targetKind as HostedEmailSendTargetKind;
  }

  throw new TypeError(`${label} must be explicit, participant, or thread.`);
}
