import {
  decryptHostedContactPhoneEnvelope,
  encryptHostedContactPhoneEnvelope,
  type HostedContactPhoneEnvelopeCodec,
} from "./contact-phone-envelope";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_DELIVERY_PARTICIPANT_PHONE_ENVELOPE_SCHEMA =
  "murph.hosted-linq-delivery-participant-phone.v1";
const HOSTED_LINQ_DELIVERY_PARTICIPANT_PHONE_KEY_PURPOSE =
  "linq-delivery-participant-phone";

function buildHostedLinqDeliveryParticipantPhoneCodec(
  deliveryId: string,
): HostedContactPhoneEnvelopeCodec {
  return {
    aad: (version) => Buffer.from(JSON.stringify({
      purpose: HOSTED_LINQ_DELIVERY_PARTICIPANT_PHONE_KEY_PURPOSE,
      rowId: deliveryId,
      schema: HOSTED_LINQ_DELIVERY_PARTICIPANT_PHONE_ENVELOPE_SCHEMA,
      table: "hosted_linq_delivery",
      version,
    })),
    keyPurpose: HOSTED_LINQ_DELIVERY_PARTICIPANT_PHONE_KEY_PURPOSE,
    label: "Hosted Linq delivery participant phone",
    schema: HOSTED_LINQ_DELIVERY_PARTICIPANT_PHONE_ENVELOPE_SCHEMA,
  };
}

export function encryptHostedLinqDeliveryParticipantPhoneNumber(input: {
  deliveryId: string;
  phoneNumber: string;
}): string {
  return encryptHostedContactPhoneEnvelope({
    codec: buildHostedLinqDeliveryParticipantPhoneCodec(
      normalizeRequiredString(input.deliveryId, "delivery id"),
    ),
    phoneNumber: normalizeRequiredString(input.phoneNumber, "phone number"),
  });
}

export function decryptHostedLinqDeliveryParticipantPhoneNumber(input: {
  deliveryId: string;
  encrypted: string;
}): string {
  return decryptHostedContactPhoneEnvelope({
    codec: buildHostedLinqDeliveryParticipantPhoneCodec(
      normalizeRequiredString(input.deliveryId, "delivery id"),
    ),
    encrypted: normalizeRequiredString(input.encrypted, "encrypted phone number"),
  });
}

function normalizeRequiredString(
  value: string | null | undefined,
  field: string,
): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new TypeError(
      `Hosted Linq delivery participant ${field} is required.`,
    );
  }
  return normalized;
}
