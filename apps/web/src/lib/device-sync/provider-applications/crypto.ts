import "server-only";

import type { HostedSecureBoxAadFields } from "@murphai/runtime-state";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../../hosted-crypto/secure-box";
import {
  buildDeviceProviderApplicationSecret,
  parseDeviceProviderApplicationSecret,
  type DeviceProviderApplicationSecret,
  type MemberOwnedDeviceProviderApplicationProvider,
} from "./types";

const DEVICE_PROVIDER_APPLICATION_SCOPE_PREFIX =
  "device-sync-provider-application";

export type DeviceProviderApplicationCryptoPrismaClient =
  HostedSecureBoxPrismaClient;

export async function encryptDeviceProviderApplication(input: {
  applicationId: string;
  clientId: string;
  clientSecret: string;
  memberId: string;
  prisma?: DeviceProviderApplicationCryptoPrismaClient;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  revision: number;
}): Promise<string> {
  const secret = buildDeviceProviderApplicationSecret(input);
  const encrypted = await sealHostedUserSecureBoxString({
    aad: deviceProviderApplicationAad(input.applicationId),
    lane: "device-sync-provider-application",
    prisma: input.prisma,
    scope: deviceProviderApplicationScope({
      applicationId: input.applicationId,
      provider: input.provider,
      revision: input.revision,
    }),
    userId: input.memberId,
    value: JSON.stringify(secret),
  });
  if (!encrypted) {
    throw new Error("Device provider application encryption returned no value.");
  }
  return encrypted;
}

export async function decryptDeviceProviderApplication(input: {
  applicationId: string;
  memberId: string;
  prisma?: DeviceProviderApplicationCryptoPrismaClient;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  revision: number;
  value: string;
}): Promise<DeviceProviderApplicationSecret> {
  const decrypted = await openHostedUserSecureBoxString({
    aad: deviceProviderApplicationAad(input.applicationId),
    lane: "device-sync-provider-application",
    prisma: input.prisma,
    scope: deviceProviderApplicationScope(input),
    userId: input.memberId,
    value: input.value,
  });
  if (!decrypted) {
    throw new Error("Device provider application decryption returned no value.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    throw new TypeError("Device provider application decrypted JSON is invalid.");
  }

  return parseDeviceProviderApplicationSecret({
    expectedProvider: input.provider,
    value: parsed,
  });
}

function deviceProviderApplicationAad(
  applicationId: string,
): Omit<
  HostedSecureBoxAadFields,
  "domain" | "lane" | "scope" | "tenant" | "userId"
> {
  return {
    field: "config_encrypted",
    purpose: "device-sync-provider-application",
    rowId: applicationId,
    table: "device_provider_application",
  };
}

function deviceProviderApplicationScope(input: {
  applicationId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  revision: number;
}): string {
  return `${DEVICE_PROVIDER_APPLICATION_SCOPE_PREFIX}:${input.provider}:${input.applicationId}:r${input.revision}:config`;
}
