import { generateKeyPairSync } from "node:crypto";

export interface EcP256JwkPairJson {
  privateJwkJson: string;
  publicJwkJson: string;
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

export function parsePrivateEcP256Jwk(value: string): Record<string, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK in apps/cloudflare/.dev.vars must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK in apps/cloudflare/.dev.vars must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  if (
    record.kty !== "EC"
    || record.crv !== "P-256"
    || typeof record.x !== "string"
    || typeof record.y !== "string"
    || typeof record.d !== "string"
  ) {
    throw new Error("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK in apps/cloudflare/.dev.vars must be an EC P-256 private JWK.");
  }

  return record as Record<string, string>;
}

export function toPublicEcP256Jwk(privateJwk: Record<string, string>): Record<string, string> {
  return {
    crv: privateJwk.crv,
    kty: privateJwk.kty,
    x: privateJwk.x,
    y: privateJwk.y,
  };
}
