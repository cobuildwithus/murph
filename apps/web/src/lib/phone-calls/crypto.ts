import type { HostedPhoneCall } from "@prisma/client";
import {
  hostedPhoneCallBriefSchema,
  hostedPhoneCallResultSchema,
  type HostedPhoneCallBrief,
  type HostedPhoneCallResult,
} from "@murphai/hosted-execution/phone-calls";
import type { HostedSecureBoxAadFields } from "@murphai/runtime-state";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

const HOSTED_PHONE_CALL_PRIVATE_CONTENT_PURPOSE = "hosted-phone-call-private-content";
const HOSTED_PHONE_CALL_TABLE = "hosted_phone_call";

type HostedPhoneCallPrivateField = "brief" | "result";

interface HostedPhoneCallPrivateContentBinding {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  lane: "hosted-member-private-field";
  scope: string;
}

interface HostedPhoneCallPrivateContentInput {
  callId: string;
  memberId: string;
  prisma?: HostedSecureBoxPrismaClient;
  signal?: AbortSignal;
}

export interface HostedPhoneCallCrypto {
  decryptBrief(input: HostedPhoneCallPrivateContentInput & {
    value: string;
  }): Promise<HostedPhoneCallBrief>;
  decryptResult(input: HostedPhoneCallPrivateContentInput & {
    value: string;
  }): Promise<HostedPhoneCallResult>;
  encryptBrief(input: HostedPhoneCallPrivateContentInput & {
    value: HostedPhoneCallBrief;
  }): Promise<string>;
  encryptResult(input: HostedPhoneCallPrivateContentInput & {
    value: HostedPhoneCallResult;
  }): Promise<string>;
}

export const hostedPhoneCallCrypto: HostedPhoneCallCrypto = {
  decryptBrief: decryptHostedPhoneCallBrief,
  decryptResult: decryptHostedPhoneCallResult,
  encryptBrief: encryptHostedPhoneCallBrief,
  encryptResult: encryptHostedPhoneCallResult,
};

export function createHostedPhoneCallCrypto(
  prisma: HostedSecureBoxPrismaClient,
): HostedPhoneCallCrypto {
  return {
    decryptBrief: (input) => decryptHostedPhoneCallBrief({ ...input, prisma }),
    decryptResult: (input) => decryptHostedPhoneCallResult({ ...input, prisma }),
    encryptBrief: (input) => encryptHostedPhoneCallBrief({ ...input, prisma }),
    encryptResult: (input) => encryptHostedPhoneCallResult({ ...input, prisma }),
  };
}

export async function encryptHostedPhoneCallBrief(
  input: HostedPhoneCallPrivateContentInput & { value: HostedPhoneCallBrief },
): Promise<string> {
  const binding = getHostedPhoneCallPrivateContentBinding("brief", input.callId);
  return requireEncryptedValue(await sealHostedUserSecureBoxString({
    ...binding,
    prisma: input.prisma,
    signal: input.signal,
    userId: input.memberId,
    value: JSON.stringify(hostedPhoneCallBriefSchema.parse(input.value)),
  }));
}

export async function decryptHostedPhoneCallBrief(
  input: HostedPhoneCallPrivateContentInput & { value: string },
): Promise<HostedPhoneCallBrief> {
  const binding = getHostedPhoneCallPrivateContentBinding("brief", input.callId);
  const plaintext = await openHostedUserSecureBoxString({
    ...binding,
    prisma: input.prisma,
    signal: input.signal,
    userId: input.memberId,
    value: input.value,
  });
  return hostedPhoneCallBriefSchema.parse(parseHostedPhoneCallPrivateJson(plaintext));
}

export async function encryptHostedPhoneCallResult(
  input: HostedPhoneCallPrivateContentInput & { value: HostedPhoneCallResult },
): Promise<string> {
  const binding = getHostedPhoneCallPrivateContentBinding("result", input.callId);
  return requireEncryptedValue(await sealHostedUserSecureBoxString({
    ...binding,
    prisma: input.prisma,
    signal: input.signal,
    userId: input.memberId,
    value: JSON.stringify(hostedPhoneCallResultSchema.parse(input.value)),
  }));
}

export async function decryptHostedPhoneCallResult(
  input: HostedPhoneCallPrivateContentInput & { value: string },
): Promise<HostedPhoneCallResult> {
  const binding = getHostedPhoneCallPrivateContentBinding("result", input.callId);
  const plaintext = await openHostedUserSecureBoxString({
    ...binding,
    prisma: input.prisma,
    signal: input.signal,
    userId: input.memberId,
    value: input.value,
  });
  return hostedPhoneCallResultSchema.parse(parseHostedPhoneCallPrivateJson(plaintext));
}

export async function readHostedPhoneCallBrief(input: {
  call: HostedPhoneCall;
  crypto?: HostedPhoneCallCrypto;
  prisma?: HostedSecureBoxPrismaClient;
  signal?: AbortSignal;
}): Promise<HostedPhoneCallBrief> {
  if (input.call.briefEncrypted !== null) {
    return (input.crypto ?? hostedPhoneCallCrypto).decryptBrief({
      callId: input.call.id,
      memberId: input.call.memberId,
      prisma: input.prisma,
      signal: input.signal,
      value: input.call.briefEncrypted,
    });
  }
  return hostedPhoneCallBriefSchema.parse(input.call.briefJson);
}

export async function readHostedPhoneCallResult(input: {
  call: HostedPhoneCall;
  crypto?: HostedPhoneCallCrypto;
  prisma?: HostedSecureBoxPrismaClient;
  signal?: AbortSignal;
}): Promise<HostedPhoneCallResult | null> {
  if (input.call.resultEncrypted !== null) {
    return (input.crypto ?? hostedPhoneCallCrypto).decryptResult({
      callId: input.call.id,
      memberId: input.call.memberId,
      prisma: input.prisma,
      signal: input.signal,
      value: input.call.resultEncrypted,
    });
  }
  if (input.call.resultJson === null) {
    return null;
  }
  return hostedPhoneCallResultSchema.parse(input.call.resultJson);
}

function getHostedPhoneCallPrivateContentBinding(
  field: HostedPhoneCallPrivateField,
  callId: string,
): HostedPhoneCallPrivateContentBinding {
  return {
    aad: {
      field: `${field}_encrypted`,
      purpose: HOSTED_PHONE_CALL_PRIVATE_CONTENT_PURPOSE,
      rowId: callId,
      table: HOSTED_PHONE_CALL_TABLE,
    },
    lane: "hosted-member-private-field",
    scope: `hosted-phone-call:${field}`,
  };
}

function parseHostedPhoneCallPrivateJson(value: string | null): unknown {
  if (value === null) {
    throw new Error("Hosted phone-call ciphertext did not contain private content.");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Hosted phone-call ciphertext contained invalid private content.");
  }
}

function requireEncryptedValue(value: string | null): string {
  if (!value) {
    throw new Error("Hosted phone-call private content encryption returned no ciphertext.");
  }
  return value;
}
