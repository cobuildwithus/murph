import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import { normalizeNullableString } from "../hosted-onboarding/shared";

const HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA =
  "murph.hosted-group-join-outreach-phone.v1";
const HOSTED_GROUP_JOIN_OUTREACH_PHONE_KEY_PURPOSE =
  "group-join-outreach-phone";

type HostedGroupJoinOutreachPhoneEnvelope = {
  ciphertext: string;
  iv: string;
  schema: typeof HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA;
  tag: string;
  version: string;
};

export function encryptHostedGroupJoinOutreachPhoneNumber(input: {
  outreachId: string;
  phoneNumber: string | null | undefined;
}): string {
  const outreachId = normalizeRequiredString(input.outreachId, "outreach id");
  const phoneNumber = normalizeRequiredString(input.phoneNumber, "phone number");
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const version = keyring.currentVersion;
  const key = deriveHostedGroupJoinOutreachPhoneKey(
    keyring.keysByVersion[version],
    version,
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(buildHostedGroupJoinOutreachPhoneAad({ outreachId, version }));
  const ciphertext = Buffer.concat([
    cipher.update(phoneNumber, "utf8"),
    cipher.final(),
  ]);
  const envelope: HostedGroupJoinOutreachPhoneEnvelope = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    schema: HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA,
    tag: cipher.getAuthTag().toString("base64"),
    version,
  };

  return JSON.stringify(envelope);
}

export function decryptHostedGroupJoinOutreachPhoneNumber(input: {
  encrypted: string;
  outreachId: string;
}): string {
  const outreachId = normalizeRequiredString(input.outreachId, "outreach id");
  const encrypted = normalizeRequiredString(input.encrypted, "encrypted phone number");
  const envelope = parseHostedGroupJoinOutreachPhoneEnvelope(encrypted);
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const key = deriveHostedGroupJoinOutreachPhoneKey(
    keyring.keysByVersion[envelope.version],
    envelope.version,
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(buildHostedGroupJoinOutreachPhoneAad({
    outreachId,
    version: envelope.version,
  }));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveHostedGroupJoinOutreachPhoneKey(
  keyMaterial: Buffer | undefined,
  version: string,
): Buffer {
  if (!keyMaterial) {
    throw new TypeError(`Hosted contact privacy keyring is missing ${version}.`);
  }

  return createHmac("sha256", keyMaterial)
    .update(
      `hosted-contact-privacy:${version}:${HOSTED_GROUP_JOIN_OUTREACH_PHONE_KEY_PURPOSE}`,
    )
    .digest();
}

function buildHostedGroupJoinOutreachPhoneAad(input: {
  outreachId: string;
  version: string;
}): Buffer {
  return Buffer.from(JSON.stringify({
    purpose: HOSTED_GROUP_JOIN_OUTREACH_PHONE_KEY_PURPOSE,
    rowId: input.outreachId,
    schema: HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA,
    table: "hosted_group_join_outreach",
    version: input.version,
  }));
}

function parseHostedGroupJoinOutreachPhoneEnvelope(
  value: string,
): HostedGroupJoinOutreachPhoneEnvelope {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted group join outreach phone envelope must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA) {
    throw new TypeError("Hosted group join outreach phone envelope schema is invalid.");
  }

  return {
    ciphertext: requireEnvelopeString(record.ciphertext, "ciphertext"),
    iv: requireEnvelopeString(record.iv, "iv"),
    schema: HOSTED_GROUP_JOIN_OUTREACH_PHONE_ENVELOPE_SCHEMA,
    tag: requireEnvelopeString(record.tag, "tag"),
    version: requireEnvelopeString(record.version, "version"),
  };
}

function requireEnvelopeString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `Hosted group join outreach phone envelope ${field} is required.`,
    );
  }
  return value;
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
