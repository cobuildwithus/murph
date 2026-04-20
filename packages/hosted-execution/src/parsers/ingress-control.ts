import {
  HOSTED_INGRESS_BEHAVIORS,
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  HOSTED_INGRESS_PAYLOAD_SCHEMAS,
  isHostedIngressKind,
} from "../contracts.ts";
import type {
  HostedIngressAppendResponse,
  HostedIngressBehavior,
  HostedIngressEvent,
  HostedIngressKind,
  HostedIngressPayloadSchema,
} from "../contracts.ts";
import {
  requireBigIntString,
  requireBoolean,
  requireObject,
  requireString,
  readNullableNumber,
  readNullableString,
  readOptionalNullableString,
} from "./assertions.ts";

export function parseHostedIngressEvent(
  value: unknown,
): HostedIngressEvent {
  const record = requireObject(value, "Hosted wake record");
  const kind = parseHostedIngressKind(record.kind, "Hosted wake record kind");
  const payloadSchema = parseHostedIngressPayloadSchema(record.payloadSchema);
  const opaquePayloadTransport = readHostedWakeOpaquePayloadTransport(record);

  if (payloadSchema !== HOSTED_INGRESS_PAYLOAD_SCHEMA) {
    throw new TypeError(
      "Hosted wake record requires the execution payload schema.",
    );
  }

  return {
    behavior: parseHostedIngressBehavior(record.behavior),
    coalescingKey: readOptionalNullableString(
      record.coalescingKey,
      "Hosted wake record coalescingKey",
    ),
    createdAt: requireString(record.createdAt, "Hosted wake record createdAt"),
    dedupeKey: readOptionalNullableString(record.dedupeKey, "Hosted wake record dedupeKey"),
    id: requireString(record.id, "Hosted wake record id"),
    kind,
    occurredAt: requireString(record.occurredAt, "Hosted wake record occurredAt"),
    ...opaquePayloadTransport,
    payloadSchema,
    quarantineCode: readOptionalNullableString(
      record.quarantineCode,
      "Hosted wake record quarantineCode",
    ),
    quarantinedAt: readOptionalNullableString(
      record.quarantinedAt,
      "Hosted wake record quarantinedAt",
    ),
    seq: requireBigIntString(record.seq, "Hosted wake record seq"),
    updatedAt: requireString(record.updatedAt, "Hosted wake record updatedAt"),
    userId: requireString(record.userId, "Hosted wake record userId"),
  };
}

export function parseHostedIngressAppendResponse(
  value: unknown,
): HostedIngressAppendResponse {
  const record = requireObject(value, "Hosted wake append response");

  return {
    duplicate: requireBoolean(record.duplicate, "Hosted wake append response duplicate"),
    inserted: requireBoolean(record.inserted, "Hosted wake append response inserted"),
    updatedExisting: requireBoolean(
      record.updatedExisting,
      "Hosted wake append response updatedExisting",
    ),
    wake: parseHostedIngressEvent(record.wake),
  };
}

export function parseHostedIngressKind(
  value: unknown,
  label: string,
): HostedIngressKind {
  const kind = requireString(value, label);

  if (!isHostedIngressKind(kind)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return kind;
}

function readHostedWakeOpaquePayloadTransport(
  record: Record<string, unknown>,
): Pick<HostedIngressEvent, "payloadBytes" | "payloadCiphertext"> {
  return {
    ...(record.payloadBytes === undefined
      ? {}
      : {
          payloadBytes: readNullableNumber(
            record.payloadBytes,
            "Hosted wake record payloadBytes",
          ),
        }),
    ...(record.payloadCiphertext === undefined
      ? {}
      : {
          payloadCiphertext: readNullableString(
            record.payloadCiphertext,
            "Hosted wake record payloadCiphertext",
          ),
        }),
  };
}

function parseHostedIngressBehavior(value: unknown): HostedIngressBehavior {
  const behavior = requireString(value, "Hosted wake record behavior");

  if (HOSTED_INGRESS_BEHAVIORS.includes(behavior as HostedIngressBehavior)) {
    return behavior as HostedIngressBehavior;
  }

  throw new TypeError(`Unsupported hosted wake behavior: ${behavior}`);
}

function parseHostedIngressPayloadSchema(value: unknown): HostedIngressPayloadSchema {
  const schema = requireString(value, "Hosted wake record payloadSchema");

  if (HOSTED_INGRESS_PAYLOAD_SCHEMAS.includes(schema as HostedIngressPayloadSchema)) {
    return schema as HostedIngressPayloadSchema;
  }

  throw new TypeError(`Unsupported hosted wake payload schema: ${schema}`);
}
