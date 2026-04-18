import { Buffer } from "node:buffer";

import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution";

import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";
export const HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES = 16 * 1024;

const HOSTED_WAKE_INLINE_PAYLOAD_FIELD = "hosted-wake-inline-payload";
const HOSTED_WAKE_REF_PAYLOAD_FIELD = "hosted-wake-ref-payload";

export type HostedWakePayloadStorage = "inline" | "ref";

export interface EncodedHostedWakeStoredPayload {
  payloadBytes: number;
  payloadInlineCiphertext: string | null;
  payloadRefCiphertext: string | null;
  storage: HostedWakePayloadStorage;
}

export function encodeHostedWakeStoredPayload(input: {
  userId: string;
  value: unknown;
}): EncodedHostedWakeStoredPayload {
  const serialized = JSON.stringify(input.value);

  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new TypeError("Hosted wake payload must serialize to a non-empty JSON string.");
  }

  const payloadBytes = Buffer.byteLength(serialized, "utf8");

  if (payloadBytes <= HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES) {
    const payloadInlineCiphertext = encryptHostedWebNullableString({
      field: HOSTED_WAKE_INLINE_PAYLOAD_FIELD,
      memberId: input.userId,
      value: serialized,
    });

    if (!payloadInlineCiphertext) {
      throw new TypeError("Hosted wake payload encryption returned an empty ciphertext.");
    }

    return {
      payloadBytes,
      payloadInlineCiphertext,
      payloadRefCiphertext: null,
      storage: "inline",
    };
  }

  const payloadRefCiphertext = encryptHostedWebNullableString({
    field: HOSTED_WAKE_REF_PAYLOAD_FIELD,
    memberId: input.userId,
    value: serialized,
  });

  if (!payloadRefCiphertext) {
    throw new TypeError("Hosted wake payload spill encryption returned an empty ciphertext.");
  }

  return {
    payloadBytes,
    payloadInlineCiphertext: null,
    payloadRefCiphertext,
    storage: "ref",
  };
}

export function decodeHostedWakeStoredPayload(input: {
  payloadInlineCiphertext?: string | null;
  payloadRefCiphertext?: string | null;
  userId: string;
}): unknown | null {
  const encryptedValue = input.payloadInlineCiphertext ?? input.payloadRefCiphertext ?? null;

  if (!encryptedValue) {
    return null;
  }

  const field = input.payloadInlineCiphertext
    ? HOSTED_WAKE_INLINE_PAYLOAD_FIELD
    : HOSTED_WAKE_REF_PAYLOAD_FIELD;
  const decrypted = decryptHostedWebNullableString({
    field,
    memberId: input.userId,
    value: encryptedValue,
  });

  if (!decrypted) {
    return null;
  }

  return JSON.parse(decrypted) as unknown;
}

export {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
};
