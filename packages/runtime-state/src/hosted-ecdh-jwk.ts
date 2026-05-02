export interface HostedUserRecipientPublicKeyJwk {
  crv: "P-256";
  ext?: boolean;
  key_ops?: string[];
  kty: "EC";
  x: string;
  y: string;
}

export interface HostedUserRecipientPrivateKeyJwk extends HostedUserRecipientPublicKeyJwk {
  d: string;
}

export async function generateHostedUserRecipientKeyPair(): Promise<{
  privateKeyJwk: HostedUserRecipientPrivateKeyJwk;
  publicKeyJwk: HostedUserRecipientPublicKeyJwk;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );

  return {
    privateKeyJwk: parseHostedUserRecipientPrivateKeyJwk(
      await crypto.subtle.exportKey("jwk", keyPair.privateKey),
      "Hosted user recipient private key",
    ),
    publicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      await crypto.subtle.exportKey("jwk", keyPair.publicKey),
      "Hosted user recipient public key",
    ),
  };
}

export function parseHostedUserRecipientPublicKeyJwk(
  value: unknown,
  label = "Hosted user recipient public key",
): HostedUserRecipientPublicKeyJwk {
  const record = requireRecord(value, label);
  const kty = requireString(record.kty, `${label}.kty`);
  const crv = requireString(record.crv, `${label}.crv`);

  if (kty !== "EC" || crv !== "P-256") {
    throw new TypeError(`${label} must be an EC P-256 public JWK.`);
  }

  return {
    crv: "P-256",
    ...(record.ext === undefined ? {} : { ext: requireBoolean(record.ext, `${label}.ext`) }),
    ...(record.key_ops === undefined ? {} : {
      key_ops: readArray(record.key_ops, `${label}.key_ops`).map((entry, index) =>
        requireString(entry, `${label}.key_ops[${index}]`)
      ),
    }),
    kty: "EC",
    x: requireString(record.x, `${label}.x`),
    y: requireString(record.y, `${label}.y`),
  };
}

export function parseHostedUserRecipientPrivateKeyJwk(
  value: unknown,
  label = "Hosted user recipient private key",
): HostedUserRecipientPrivateKeyJwk {
  const publicKey = parseHostedUserRecipientPublicKeyJwk(value, label);
  const record = requireRecord(value, label);

  return {
    ...publicKey,
    d: requireString(record.d, `${label}.d`),
  };
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

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}
