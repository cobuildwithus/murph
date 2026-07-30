import {
  decryptHostedContactPhoneEnvelope,
  encryptHostedContactPhoneEnvelope,
  type HostedContactPhoneEnvelopeCodec,
} from "./contact-phone-envelope";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA = "murph.hosted-linq-line-phone.v1";
const HOSTED_LINQ_LINE_PHONE_KEY_PURPOSE = "linq-line-phone";

// A line phone is not row-bound: lines are keyed by the phone itself, so the
// envelope authenticates only its purpose, schema, and key version. These bytes
// are part of the stored format for this schema and must not change.
const HOSTED_LINQ_LINE_PHONE_CODEC: HostedContactPhoneEnvelopeCodec = {
  aad: (version) => Buffer.from(JSON.stringify({
    purpose: HOSTED_LINQ_LINE_PHONE_KEY_PURPOSE,
    schema: HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA,
    version,
  })),
  keyPurpose: HOSTED_LINQ_LINE_PHONE_KEY_PURPOSE,
  label: "Hosted Linq line phone",
  schema: HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA,
};

export function encryptHostedLinqLinePhoneNumber(
  phoneNumber: string | null | undefined,
): string | null {
  const value = normalizeNullableString(phoneNumber);
  if (!value) {
    return null;
  }

  return encryptHostedContactPhoneEnvelope({
    codec: HOSTED_LINQ_LINE_PHONE_CODEC,
    phoneNumber: value,
  });
}

export function decryptHostedLinqLinePhoneNumber(
  encrypted: string | null | undefined,
): string | null {
  const value = normalizeNullableString(encrypted);
  if (!value) {
    return null;
  }

  return decryptHostedContactPhoneEnvelope({
    codec: HOSTED_LINQ_LINE_PHONE_CODEC,
    encrypted: value,
  });
}
