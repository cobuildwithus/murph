import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { normalizeString } from "./shared";

const ENCRYPTED_SECRET_PREFIX = "hbds";
const AES_256_GCM = "aes-256-gcm";
const GCM_IV_BYTES = 12;

export interface HostedSecretCodec {
  readonly keyVersion: string;
  encrypt(value: string): string;
  decrypt(payload: string): string;
}

export function decodeHostedEncryptionKey(value: string): Buffer {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY must not be empty.");
  }

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const normalizedBase64 = normalized.replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = normalizedBase64.length % 4 === 0 ? "" : "=".repeat(4 - (normalizedBase64.length % 4));
  const base64Decoded = Buffer.from(`${normalizedBase64}${padding}`, "base64");

  if (base64Decoded.length === 32) {
    return base64Decoded;
  }

  const utf8Decoded = Buffer.from(normalized, "utf8");

  if (utf8Decoded.length === 32) {
    return utf8Decoded;
  }

  throw new TypeError(
    "DEVICE_SYNC_ENCRYPTION_KEY must decode to exactly 32 bytes (hex, base64/base64url, or raw 32-byte text).",
  );
}

export function createHostedSecretCodec(input: { key: Buffer; keyVersion: string }): HostedSecretCodec {
  if (input.key.length !== 32) {
    throw new TypeError("Hosted device-sync encryption keys must be 32 bytes.");
  }

  const keyVersion = normalizeString(input.keyVersion);

  if (!keyVersion) {
    throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY_VERSION must not be empty.");
  }

  return {
    keyVersion,
    encrypt(value: string): string {
      const plaintext = Buffer.from(value, "utf8");
      const iv = randomBytes(GCM_IV_BYTES);
      const cipher = createCipheriv(AES_256_GCM, input.key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        ENCRYPTED_SECRET_PREFIX,
        keyVersion,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(":");
    },
    decrypt(payload: string): string {
      const [prefix, payloadKeyVersion, ivText, tagText, ciphertextText] = payload.split(":");

      if (prefix !== ENCRYPTED_SECRET_PREFIX || !payloadKeyVersion || !ivText || !tagText || !ciphertextText) {
        throw new TypeError("Encrypted device-sync secret payload is malformed.");
      }

      const decipher = createDecipheriv(
        AES_256_GCM,
        input.key,
        Buffer.from(ivText, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tagText, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, "base64url")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    },
  };
}
