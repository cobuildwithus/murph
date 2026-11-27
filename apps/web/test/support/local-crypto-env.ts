import { generateKeyPairSync } from "node:crypto";

export function localCryptoEnv() {
  const authority = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "jwk" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const automation = generateKeyPairSync("ec", { namedCurve: "prime256v1", publicKeyEncoding: { format: "jwk" }, privateKeyEncoding: { format: "jwk" } });
  return {
    HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/example/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authority.publicKey,
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(authority.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: "projects/example/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "synthetic-automation",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(automation.publicKey),
  };
}
