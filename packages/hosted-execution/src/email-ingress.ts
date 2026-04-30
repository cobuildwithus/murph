import {
  requireObject,
  requireString,
  readNullableStringValue,
  readOptionalNullableString,
} from "./parsers/assertions.ts";

export interface HostedEmailIngressWakeAppendRequest {
  eventId: string;
  identityId: string | null;
  messageId?: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  threadKey?: string | null;
  threadTarget?: string | null;
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
    ...(record.messageId === undefined
      ? {}
      : {
          messageId: readOptionalNullableString(
            record.messageId,
            "Hosted email ingress wake append request messageId",
          ),
        }),
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
    ...(record.threadKey === undefined
      ? {}
      : {
          threadKey: readOptionalNullableString(
            record.threadKey,
            "Hosted email ingress wake append request threadKey",
          ),
        }),
    ...(record.threadTarget === undefined
      ? {}
      : {
          threadTarget: readOptionalNullableString(
            record.threadTarget,
            "Hosted email ingress wake append request threadTarget",
          ),
        }),
  };
}
