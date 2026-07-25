import {
  decryptHostedContactPhoneEnvelope,
  encryptHostedContactPhoneEnvelope,
  type HostedContactPhoneEnvelopeCodec,
} from "../hosted-onboarding/contact-phone-envelope";
import { normalizeNullableString } from "../hosted-onboarding/shared";

const HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA =
  "murph.hosted-group-join-outreach-phone.v1";
const HOSTED_GROUP_JOIN_OUTREACH_PHONE_KEY_PURPOSE =
  "group-join-outreach-phone";

// One phone per outreach row, so the envelope is bound to its row: an envelope
// lifted into another row fails authentication instead of decrypting. These
// bytes are part of the stored format for this schema and must not change.
function buildHostedGroupJoinOutreachPhoneCodec(
  outreachId: string,
): HostedContactPhoneEnvelopeCodec {
  return {
    aad: (version) => Buffer.from(JSON.stringify({
      purpose: HOSTED_GROUP_JOIN_OUTREACH_PHONE_KEY_PURPOSE,
      rowId: outreachId,
      schema: HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA,
      table: "hosted_group_join_outreach",
      version,
    })),
    keyPurpose: HOSTED_GROUP_JOIN_OUTREACH_PHONE_KEY_PURPOSE,
    label: "Hosted group join outreach phone",
    schema: HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA,
  };
}

export function encryptHostedGroupJoinOutreachPhoneNumber(input: {
  outreachId: string;
  phoneNumber: string | null | undefined;
}): string {
  return encryptHostedContactPhoneEnvelope({
    codec: buildHostedGroupJoinOutreachPhoneCodec(
      normalizeRequiredString(input.outreachId, "outreach id"),
    ),
    phoneNumber: normalizeRequiredString(input.phoneNumber, "phone number"),
  });
}

export function decryptHostedGroupJoinOutreachPhoneNumber(input: {
  encrypted: string;
  outreachId: string;
}): string {
  return decryptHostedContactPhoneEnvelope({
    codec: buildHostedGroupJoinOutreachPhoneCodec(
      normalizeRequiredString(input.outreachId, "outreach id"),
    ),
    encrypted: normalizeRequiredString(
      input.encrypted,
      "encrypted phone number",
    ),
  });
}

function normalizeRequiredString(
  value: string | null | undefined,
  field: string,
): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new TypeError(`Hosted group join outreach ${field} is required.`);
  }
  return normalized;
}
