import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { readHostedContactPrivacyKeyring } from "./env";

/**
 * Shared AES-256-GCM envelope for phone numbers held at rest.
 *
 * Each caller owns its own `keyPurpose` (so one purpose's key never decrypts
 * another's) and its own additional authenticated data. `aad` is what binds a
 * ciphertext to its context: a caller that stores one phone per row passes the
 * row identity so a copied envelope cannot be replayed into another row, while
 * a caller with no row-level context passes only its schema and key version.
 *
 * Key derivation and AAD bytes are part of the stored format. Changing either
 * for an existing purpose makes previously stored envelopes undecryptable, so
 * new behavior belongs behind a new purpose and schema instead.
 */
export type HostedContactPhoneEnvelopeCodec = {
  aad: (version: string) => Buffer;
  keyPurpose: string;
  label: string;
  schema: string;
};

type HostedContactPhoneEnvelope = {
  ciphertext: string;
  iv: string;
  schema: string;
  tag: string;
  version: string;
};

export function encryptHostedContactPhoneEnvelope(input: {
  codec: HostedContactPhoneEnvelopeCodec;
  phoneNumber: string;
}): string {
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const version = keyring.currentVersion;
  const key = deriveHostedContactPhoneEnvelopeKey({
    keyMaterial: keyring.keysByVersion[version],
    keyPurpose: input.codec.keyPurpose,
    version,
  });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(input.codec.aad(version));
  const ciphertext = Buffer.concat([
    cipher.update(input.phoneNumber, "utf8"),
    cipher.final(),
  ]);

  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    schema: input.codec.schema,
    tag: cipher.getAuthTag().toString("base64"),
    version,
  } satisfies HostedContactPhoneEnvelope);
}

export function decryptHostedContactPhoneEnvelope(input: {
  codec: HostedContactPhoneEnvelopeCodec;
  encrypted: string;
}): string {
  const envelope = parseHostedContactPhoneEnvelope({
    codec: input.codec,
    value: input.encrypted,
  });
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const key = deriveHostedContactPhoneEnvelopeKey({
    keyMaterial: keyring.keysByVersion[envelope.version],
    keyPurpose: input.codec.keyPurpose,
    version: envelope.version,
  });
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(input.codec.aad(envelope.version));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveHostedContactPhoneEnvelopeKey(input: {
  keyMaterial: Buffer | undefined;
  keyPurpose: string;
  version: string;
}): Buffer {
  if (!input.keyMaterial) {
    throw new TypeError(
      `Hosted contact privacy keyring is missing ${input.version}.`,
    );
  }

  return createHmac("sha256", input.keyMaterial)
    .update(`hosted-contact-privacy:${input.version}:${input.keyPurpose}`)
    .digest();
}

function parseHostedContactPhoneEnvelope(input: {
  codec: HostedContactPhoneEnvelopeCodec;
  value: string;
}): HostedContactPhoneEnvelope {
  const parsed = JSON.parse(input.value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${input.codec.label} envelope must be an object.`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== input.codec.schema) {
    throw new TypeError(`${input.codec.label} envelope schema is invalid.`);
  }

  return {
    ciphertext: requireEnvelopeString(record.ciphertext, "ciphertext", input.codec),
    iv: requireEnvelopeString(record.iv, "iv", input.codec),
    schema: input.codec.schema,
    tag: requireEnvelopeString(record.tag, "tag", input.codec),
    version: requireEnvelopeString(record.version, "version", input.codec),
  };
}

function requireEnvelopeString(
  value: unknown,
  field: string,
  codec: HostedContactPhoneEnvelopeCodec,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${codec.label} envelope ${field} is required.`);
  }
  return value;
}
