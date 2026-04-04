export const HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA = "murph.hosted-user-root-key-envelope.v1";
export const HOSTED_USER_ROOT_KEY_RECIPIENT_KINDS = [
  "automation",
  "user-unlock",
  "recovery",
  "tee-automation",
] as const;

export type HostedUserRootKeyEnvelopeSchema = typeof HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA;
export type HostedUserRootKeyRecipientKind =
  (typeof HOSTED_USER_ROOT_KEY_RECIPIENT_KINDS)[number];

export interface HostedWrappedRootKeyRecipient {
  ciphertext: string;
  iv: string;
  keyId: string;
  kind: HostedUserRootKeyRecipientKind;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface HostedUserRootKeyEnvelope {
  createdAt: string;
  recipients: HostedWrappedRootKeyRecipient[];
  rootKeyId: string;
  schema: HostedUserRootKeyEnvelopeSchema;
  updatedAt: string;
  userId: string;
}

export function parseHostedUserRootKeyEnvelope(
  value: unknown,
  label = "Hosted user root key envelope",
): HostedUserRootKeyEnvelope {
  const record = requireRecord(value, label);
  const recipients = readArray(record.recipients, `${label}.recipients`).map((entry, index) =>
    parseHostedWrappedRootKeyRecipient(entry, `${label}.recipients[${index}]`)
  );

  return {
    createdAt: requireString(record.createdAt, `${label}.createdAt`),
    recipients,
    rootKeyId: requireString(record.rootKeyId, `${label}.rootKeyId`),
    schema: requireEnvelopeSchema(record.schema, `${label}.schema`),
    updatedAt: requireString(record.updatedAt, `${label}.updatedAt`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

export function parseHostedWrappedRootKeyRecipient(
  value: unknown,
  label = "Hosted wrapped root key recipient",
): HostedWrappedRootKeyRecipient {
  const record = requireRecord(value, label);

  return {
    ciphertext: requireString(record.ciphertext, `${label}.ciphertext`),
    iv: requireString(record.iv, `${label}.iv`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    kind: requireRecipientKind(record.kind, `${label}.kind`),
    ...(record.metadata === undefined ? {} : { metadata: parseMetadataRecord(record.metadata, `${label}.metadata`) }),
  };
}

export function findHostedWrappedRootKeyRecipient(
  envelope: HostedUserRootKeyEnvelope,
  kind: HostedUserRootKeyRecipientKind,
): HostedWrappedRootKeyRecipient | null {
  return envelope.recipients.find((recipient) => recipient.kind === kind) ?? null;
}

function requireEnvelopeSchema(value: unknown, label: string): HostedUserRootKeyEnvelopeSchema {
  const schema = requireString(value, label);

  if (schema !== HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA) {
    throw new TypeError(`${label} must be ${HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA}.`);
  }

  return schema;
}

function requireRecipientKind(value: unknown, label: string): HostedUserRootKeyRecipientKind {
  const kind = requireString(value, label);

  if (
    kind === "automation"
    || kind === "user-unlock"
    || kind === "recovery"
    || kind === "tee-automation"
  ) {
    return kind;
  }

  throw new TypeError(`${label} must be a supported root key recipient kind.`);
}

function parseMetadataRecord(
  value: unknown,
  label: string,
): Record<string, string | number | boolean | null> {
  const record = requireRecord(value, label);
  const result: Record<string, string | number | boolean | null> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (
      entry === null
      || typeof entry === "string"
      || typeof entry === "number"
      || typeof entry === "boolean"
    ) {
      result[key] = entry;
      continue;
    }

    throw new TypeError(`${label}.${key} must be a scalar JSON value.`);
  }

  return result;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}
