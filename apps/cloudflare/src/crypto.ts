import { decodeBase64, encodeBase64 } from "./base64.js";

export interface HostedCipherEnvelope {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  keyId: string;
  schema: "healthybob.hosted-cipher.v1";
}

export async function encryptHostedBundle(input: {
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
}): Promise<HostedCipherEnvelope> {
  const cryptoKey = await importAesKey(input.key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        iv,
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(input.plaintext),
    ),
  );

  return {
    algorithm: "AES-GCM",
    ciphertext: encodeBase64(ciphertext),
    iv: encodeBase64(iv),
    keyId: input.keyId,
    schema: "healthybob.hosted-cipher.v1",
  };
}

export async function decryptHostedBundle(input: {
  envelope: HostedCipherEnvelope;
  key: Uint8Array;
}): Promise<Uint8Array> {
  if (input.envelope.schema !== "healthybob.hosted-cipher.v1" || input.envelope.algorithm !== "AES-GCM") {
    throw new Error("Hosted bundle envelope is invalid.");
  }

  const cryptoKey = await importAesKey(input.key);

  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        iv: toArrayBuffer(decodeBase64(input.envelope.iv)),
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(decodeBase64(input.envelope.ciphertext)),
    ),
  );
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
