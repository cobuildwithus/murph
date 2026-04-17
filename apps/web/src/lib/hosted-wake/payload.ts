import { Buffer } from "node:buffer";

import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";

export const HOSTED_WAKE_DISPATCH_PAYLOAD_SCHEMA = "murph.hosted-wake-dispatch.v1";
const HOSTED_WAKE_INLINE_PAYLOAD_FIELD = "hosted-wake-inline-payload";
const HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES = 16 * 1024;

export interface HostedWakeInlinePayload {
  payloadBytes: number;
  payloadInlineCiphertext: string;
}

export function encodeHostedWakeInlinePayload(input: {
  userId: string;
  value: unknown;
}): HostedWakeInlinePayload {
  const serialized = JSON.stringify(input.value);

  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new TypeError("Hosted wake payload must serialize to a non-empty JSON string.");
  }

  const payloadBytes = Buffer.byteLength(serialized, "utf8");

  if (payloadBytes > HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES) {
    throw new RangeError(
      `Hosted wake payload exceeds the ${HOSTED_WAKE_MAX_INLINE_PAYLOAD_BYTES} byte inline limit.`,
    );
  }

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
  };
}

export function decodeHostedWakeInlinePayload(input: {
  payloadInlineCiphertext: string | null | undefined;
  userId: string;
}): unknown | null {
  const decrypted = decryptHostedWebNullableString({
    field: HOSTED_WAKE_INLINE_PAYLOAD_FIELD,
    memberId: input.userId,
    value: input.payloadInlineCiphertext,
  });

  if (!decrypted) {
    return null;
  }

  return JSON.parse(decrypted) as unknown;
}
