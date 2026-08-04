import {
  readHostedProviderEgressCredentialSigningSecret,
} from "./hosted-provider-egress-credential.ts";
import {
  parseHostedInferenceRuntimeTarget,
  type HostedInferenceRuntimeTarget,
} from "./hosted-inference-runtime-target.ts";

const HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA =
  "murph.hosted-inference-target-envelope.v1" as const;
const HOSTED_INFERENCE_TARGET_ENVELOPE_ALG =
  "AES-256-GCM-HKDF-SHA256" as const;
const HOSTED_INFERENCE_TARGET_ENVELOPE_IV_BYTES = 12;
const HOSTED_INFERENCE_TARGET_ENVELOPE_MAX_CODE_POINTS = 16_384;
const HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER = new TextEncoder();
const HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_DECODER = new TextDecoder();
const HOSTED_INFERENCE_TARGET_ENVELOPE_SALT =
  HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    "murph.hosted-inference-target-envelope.hkdf.v1",
  );
const HOSTED_INFERENCE_TARGET_ENVELOPE_INFO =
  HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    "murph:hosted-inference-target-envelope:aes-gcm:v1",
  );
const HOSTED_INFERENCE_TARGET_ENVELOPE_AAD =
  HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA,
  );

interface HostedInferenceTargetEnvelopeV1 {
  alg: typeof HOSTED_INFERENCE_TARGET_ENVELOPE_ALG;
  ciphertext: string;
  iv: string;
  schema: typeof HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA;
}

export async function sealHostedInferenceRuntimeTarget(input: {
  source: Readonly<Record<string, unknown>>;
  target: HostedInferenceRuntimeTarget;
}): Promise<string> {
  const target = parseHostedInferenceRuntimeTarget(input.target);
  const plaintext = HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(
    JSON.stringify(target),
  );
  const iv = new Uint8Array(HOSTED_INFERENCE_TARGET_ENVELOPE_IV_BYTES);
  crypto.getRandomValues(iv);
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      {
        additionalData: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_AAD),
        iv: toArrayBuffer(iv),
        name: "AES-GCM",
      },
      await deriveHostedInferenceTargetEnvelopeKey(input.source),
      toArrayBuffer(plaintext),
    ));
    return JSON.stringify({
      alg: HOSTED_INFERENCE_TARGET_ENVELOPE_ALG,
      ciphertext: bytesToBase64Url(ciphertext),
      iv: bytesToBase64Url(iv),
      schema: HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA,
    } satisfies HostedInferenceTargetEnvelopeV1);
  } finally {
    plaintext.fill(0);
  }
}

export async function openHostedInferenceRuntimeTarget(input: {
  envelope: string;
  source: Readonly<Record<string, unknown>>;
}): Promise<HostedInferenceRuntimeTarget> {
  const envelope = parseHostedInferenceTargetEnvelope(input.envelope);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  if (
    !iv
    || iv.byteLength !== HOSTED_INFERENCE_TARGET_ENVELOPE_IV_BYTES
    || !ciphertext
    || ciphertext.byteLength === 0
  ) {
    throw new TypeError("Hosted inference target envelope encoding is invalid.");
  }

  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_AAD),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
    },
    await deriveHostedInferenceTargetEnvelopeKey(input.source),
    toArrayBuffer(ciphertext),
  ));
  try {
    return parseHostedInferenceRuntimeTarget(
      JSON.parse(HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_DECODER.decode(plaintext)),
    );
  } finally {
    plaintext.fill(0);
  }
}

function parseHostedInferenceTargetEnvelope(
  value: string,
): HostedInferenceTargetEnvelopeV1 {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || [...value].length > HOSTED_INFERENCE_TARGET_ENVELOPE_MAX_CODE_POINTS
  ) {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4
    || record.alg !== HOSTED_INFERENCE_TARGET_ENVELOPE_ALG
    || typeof record.ciphertext !== "string"
    || typeof record.iv !== "string"
    || record.schema !== HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA
  ) {
    throw new TypeError("Hosted inference target envelope is invalid.");
  }
  return {
    alg: HOSTED_INFERENCE_TARGET_ENVELOPE_ALG,
    ciphertext: record.ciphertext,
    iv: record.iv,
    schema: HOSTED_INFERENCE_TARGET_ENVELOPE_SCHEMA,
  };
}

async function deriveHostedInferenceTargetEnvelopeKey(
  source: Readonly<Record<string, unknown>>,
): Promise<CryptoKey> {
  const secret = readHostedProviderEgressCredentialSigningSecret(source);
  const secretBytes =
    HOSTED_INFERENCE_TARGET_ENVELOPE_TEXT_ENCODER.encode(secret);
  let baseKey: CryptoKey;
  try {
    baseKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(secretBytes),
      "HKDF",
      false,
      ["deriveKey"],
    );
  } finally {
    secretBytes.fill(0);
  }
  return await crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_INFO),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_INFERENCE_TARGET_ENVELOPE_SALT),
    },
    baseKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const remainder = value.length % 4;
  if (remainder === 1) return null;
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
    remainder === 0 ? "" : "=".repeat(4 - remainder)
  }`;
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
