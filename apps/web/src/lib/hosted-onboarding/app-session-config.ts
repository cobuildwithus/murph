export const HOSTED_APP_SESSION_HMAC_KEY_BYTES = 32;

export function readHostedAppSessionHmacKey(
  environment: { HOSTED_APP_SESSION_HMAC_KEY?: string; [key: string]: string | undefined } = process.env,
): Buffer {
  const encoded = environment.HOSTED_APP_SESSION_HMAC_KEY;
  if (typeof encoded !== "string" || encoded.length === 0 || encoded !== encoded.trim()) {
    throw new TypeError("HOSTED_APP_SESSION_HMAC_KEY must be configured as a canonical 32-byte base64url key.");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.byteLength !== HOSTED_APP_SESSION_HMAC_KEY_BYTES || decoded.toString("base64url") !== encoded) {
    throw new TypeError("HOSTED_APP_SESSION_HMAC_KEY must be configured as a canonical 32-byte base64url key.");
  }
  return decoded;
}
