import { generateKeyPairSync } from "node:crypto";

export interface EcP256JwkPairJson {
  privateJwkJson: string;
  publicJwkJson: string;
}

export interface EcP256SigningKeyJson {
  privateJwkJson: string;
  publicKeyPem: string;
}

export function createEcP256JwkPairJson(): EcP256JwkPairJson {
  const pair = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });

  return {
    privateJwkJson: JSON.stringify(pair.privateKey),
    publicJwkJson: JSON.stringify(pair.publicKey),
  };
}

export function createEcP256SigningKeyJson(): EcP256SigningKeyJson {
  const pair = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });

  return {
    privateJwkJson: JSON.stringify(pair.privateKey),
    publicKeyPem: pair.publicKey,
  };
}

export function parsePrivateEcP256Jwk(
  value: string,
  label = "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
): Record<string, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${label} in apps/cloudflare/.dev.vars must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} in apps/cloudflare/.dev.vars must be a JSON object.`);
  }

  const record = Object.fromEntries(Object.entries(parsed));
  if (
    record.kty !== "EC"
    || record.crv !== "P-256"
    || typeof record.x !== "string"
    || typeof record.y !== "string"
    || typeof record.d !== "string"
  ) {
    throw new Error(`${label} in apps/cloudflare/.dev.vars must be an EC P-256 private JWK.`);
  }

  return {
    crv: record.crv,
    d: record.d,
    kty: record.kty,
    x: record.x,
    y: record.y,
  };
}

export function toPublicEcP256Jwk(privateJwk: Record<string, string>): Record<string, string> {
  return {
    crv: privateJwk.crv,
    kty: privateJwk.kty,
    x: privateJwk.x,
    y: privateJwk.y,
  };
}
