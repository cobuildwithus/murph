import {
  requireObject,
  requireString,
  readNullableStringValue,
  readOptionalNullableString,
} from "./parsers/assertions.ts";

export interface HostedEmailIngressWakeAppendRequest {
  eventId: string;
  identityId: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
}

export function parseHostedEmailIngressWakeAppendRequest(
  value: unknown,
): HostedEmailIngressWakeAppendRequest {
  const record = requireObject(value, "Hosted email ingress wake append request");

  return {
    eventId: requireString(record.eventId, "Hosted email ingress wake append request eventId"),
    identityId: readNullableStringValue(
      record.identityId,
      "Hosted email ingress wake append request identityId",
    ),
    occurredAt: requireString(
      record.occurredAt,
      "Hosted email ingress wake append request occurredAt",
    ),
    rawMessageKey: requireString(
      record.rawMessageKey,
      "Hosted email ingress wake append request rawMessageKey",
    ),
    ...(record.selfAddress === undefined
      ? {}
      : {
          selfAddress: readOptionalNullableString(
            record.selfAddress,
            "Hosted email ingress wake append request selfAddress",
          ),
        }),
  };
}
