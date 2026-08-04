import type { HostedSecureBoxAadFields } from "@murphai/runtime-state";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";
import {
  buildHostedInferenceConnectionSecret,
  parseHostedInferenceConnectionSecret,
} from "./connection-policy";
import type {
  HostedInferenceConnectionCandidate,
  HostedInferenceConnectionSecret,
} from "./types";

const HOSTED_INFERENCE_CONNECTION_SCOPE =
  "hosted-inference-connection:config";

export type HostedInferenceConnectionCryptoPrismaClient =
  HostedSecureBoxPrismaClient;

export async function encryptHostedInferenceConnection(input: {
  candidate: HostedInferenceConnectionCandidate;
  memberId: string;
  prisma?: HostedInferenceConnectionCryptoPrismaClient;
}): Promise<string> {
  const encrypted = await sealHostedUserSecureBoxString({
    aad: hostedInferenceConnectionAad(input.memberId),
    lane: "hosted-inference-connection",
    prisma: input.prisma,
    scope: HOSTED_INFERENCE_CONNECTION_SCOPE,
    userId: input.memberId,
    value: JSON.stringify(buildHostedInferenceConnectionSecret(input.candidate)),
  });
  if (!encrypted) {
    throw new Error("Hosted inference connection encryption returned no value.");
  }
  return encrypted;
}

export async function decryptHostedInferenceConnection(input: {
  memberId: string;
  prisma?: HostedInferenceConnectionCryptoPrismaClient;
  protocol: HostedInferenceConnectionSecret["protocol"];
  value: string;
}): Promise<HostedInferenceConnectionSecret> {
  const decrypted = await openHostedUserSecureBoxString({
    aad: hostedInferenceConnectionAad(input.memberId),
    lane: "hosted-inference-connection",
    prisma: input.prisma,
    scope: HOSTED_INFERENCE_CONNECTION_SCOPE,
    userId: input.memberId,
    value: input.value,
  });
  if (!decrypted) {
    throw new Error("Hosted inference connection decryption returned no value.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    throw new TypeError("Hosted inference connection decrypted JSON is invalid.");
  }
  return parseHostedInferenceConnectionSecret({
    expectedProtocol: input.protocol,
    value: parsed,
  });
}

function hostedInferenceConnectionAad(
  memberId: string,
): Omit<
  HostedSecureBoxAadFields,
  "domain" | "lane" | "scope" | "tenant" | "userId"
> {
  return {
    field: "config_encrypted",
    purpose: "hosted-inference-connection",
    rowId: memberId,
    table: "hosted_inference_connection",
  };
}
