import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { readHostedContactPrivacyKeyring } from "./env";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA = "murph.hosted-linq-line-phone.v1";
const HOSTED_LINQ_LINE_PHONE_KEY_PURPOSE = "linq-line-phone";

type HostedLinqLinePhoneEnvelope = {
  ciphertext: string;
  iv: string;
  schema: typeof HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA;
  tag: string;
  version: string;
};

export function encryptHostedLinqLinePhoneNumber(
  phoneNumber: string | null | undefined,
): string | null {
  const value = normalizeNullableString(phoneNumber);
  if (!value) {
    return null;
  }

  const keyring = readHostedContactPrivacyKeyring(process.env);
  const version = keyring.currentVersion;
  const key = deriveHostedLinqLinePhoneKey(keyring.keysByVersion[version], version);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(buildHostedLinqLinePhoneAad(version));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const envelope: HostedLinqLinePhoneEnvelope = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    schema: HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA,
    tag: cipher.getAuthTag().toString("base64"),
    version,
  };

  return JSON.stringify(envelope);
}

export function decryptHostedLinqLinePhoneNumber(
  encrypted: string | null | undefined,
): string | null {
  const value = normalizeNullableString(encrypted);
  if (!value) {
    return null;
  }

  const envelope = parseHostedLinqLinePhoneEnvelope(value);
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const key = deriveHostedLinqLinePhoneKey(
    keyring.keysByVersion[envelope.version],
    envelope.version,
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(buildHostedLinqLinePhoneAad(envelope.version));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveHostedLinqLinePhoneKey(
  keyMaterial: Buffer | undefined,
  version: string,
): Buffer {
  if (!keyMaterial) {
    throw new TypeError(`Hosted contact privacy keyring is missing ${version}.`);
  }

  return createHmac("sha256", keyMaterial)
    .update(`hosted-contact-privacy:${version}:${HOSTED_LINQ_LINE_PHONE_KEY_PURPOSE}`)
    .digest();
}

function buildHostedLinqLinePhoneAad(version: string): Buffer {
  return Buffer.from(JSON.stringify({
    purpose: HOSTED_LINQ_LINE_PHONE_KEY_PURPOSE,
    schema: HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA,
    version,
  }));
}

function parseHostedLinqLinePhoneEnvelope(value: string): HostedLinqLinePhoneEnvelope {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted Linq line phone envelope must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA) {
    throw new TypeError("Hosted Linq line phone envelope schema is invalid.");
  }

  return {
    ciphertext: requireEnvelopeString(record.ciphertext, "ciphertext"),
    iv: requireEnvelopeString(record.iv, "iv"),
    schema: HOSTED_LINQ_LINE_PHONE_ENVELOPE_SCHEMA,
    tag: requireEnvelopeString(record.tag, "tag"),
    version: requireEnvelopeString(record.version, "version"),
  };
}

function requireEnvelopeString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Hosted Linq line phone envelope ${field} is required.`);
  }
  return value;
}
