import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(payload: string): string;
}

export function createSecretCodec(secret: string): SecretCodec {
  const key = createHash("sha256").update(secret).digest();

  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
    },
    decrypt(payload) {
      const decoded = Buffer.from(payload, "base64url");

      if (decoded.length < 28) {
        throw new TypeError("Encrypted payload is invalid.");
      }

      const iv = decoded.subarray(0, 12);
      const authTag = decoded.subarray(12, 28);
      const ciphertext = decoded.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString("utf8");
    },
  };
}
