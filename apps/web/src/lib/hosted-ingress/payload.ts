import { Buffer } from "node:buffer";

import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution";

import {
  decryptHostedIngressNullableString,
  encryptHostedIngressNullableString,
} from "./encryption";
export const HOSTED_INGRESS_MAX_INLINE_PAYLOAD_BYTES = 16 * 1024;

const HOSTED_INGRESS_INLINE_PAYLOAD_FIELD = "hosted-ingress-inline-payload";
const HOSTED_INGRESS_REF_PAYLOAD_FIELD = "hosted-ingress-ref-payload";

export type HostedIngressPayloadStorage = "inline" | "ref";

export interface EncodedHostedIngressStoredPayload {
  payloadBytes: number;
  payloadInlineCiphertext: string | null;
  payloadRefCiphertext: string | null;
  storage: HostedIngressPayloadStorage;
}

export function encodeHostedIngressStoredPayload(input: {
  userId: string;
  value: unknown;
}): EncodedHostedIngressStoredPayload {
  const serialized = JSON.stringify(input.value);

  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new TypeError("Hosted ingress payload must serialize to a non-empty JSON string.");
  }

  const payloadBytes = Buffer.byteLength(serialized, "utf8");

  if (payloadBytes <= HOSTED_INGRESS_MAX_INLINE_PAYLOAD_BYTES) {
    const payloadInlineCiphertext = encryptHostedIngressNullableString({
      field: HOSTED_INGRESS_INLINE_PAYLOAD_FIELD,
      userId: input.userId,
      value: serialized,
    });

    if (!payloadInlineCiphertext) {
      throw new TypeError("Hosted ingress payload encryption returned an empty ciphertext.");
    }

    return {
      payloadBytes,
      payloadInlineCiphertext,
      payloadRefCiphertext: null,
      storage: "inline",
    };
  }

  const payloadRefCiphertext = encryptHostedIngressNullableString({
    field: HOSTED_INGRESS_REF_PAYLOAD_FIELD,
    userId: input.userId,
    value: serialized,
  });

  if (!payloadRefCiphertext) {
    throw new TypeError("Hosted ingress payload spill encryption returned an empty ciphertext.");
  }

  return {
    payloadBytes,
    payloadInlineCiphertext: null,
    payloadRefCiphertext,
    storage: "ref",
  };
}

export function decodeHostedIngressStoredPayload(input: {
  payloadInlineCiphertext?: string | null;
  payloadRefCiphertext?: string | null;
  userId: string;
}): unknown | null {
  const encryptedValue = input.payloadInlineCiphertext ?? input.payloadRefCiphertext ?? null;

  if (!encryptedValue) {
    return null;
  }

  const field = input.payloadInlineCiphertext
    ? HOSTED_INGRESS_INLINE_PAYLOAD_FIELD
    : HOSTED_INGRESS_REF_PAYLOAD_FIELD;
  const decrypted = decryptHostedIngressNullableString({
    field,
    userId: input.userId,
    value: encryptedValue,
  });

  if (!decrypted) {
    return null;
  }

  return JSON.parse(decrypted) as unknown;
}

export {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
};
