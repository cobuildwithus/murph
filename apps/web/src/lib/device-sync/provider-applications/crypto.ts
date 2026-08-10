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

export class DeviceProviderApplicationSecretInvalidError extends Error {
  constructor() {
    super("Private provider application credentials are invalid.");
    this.name = "DeviceProviderApplicationSecretInvalidError";
  }
}

export function isDeviceProviderApplicationSecretInvalidError(
  value: unknown,
): value is DeviceProviderApplicationSecretInvalidError {
  return value instanceof DeviceProviderApplicationSecretInvalidError;
}

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
  let decrypted: string | null;
  try {
    decrypted = await openHostedUserSecureBoxString({
      aad: deviceProviderApplicationAad(input.applicationId),
      lane: "device-sync-provider-application",
      prisma: input.prisma,
      scope: deviceProviderApplicationScope(input),
      userId: input.memberId,
      value: input.value,
    });
  } catch (error) {
    if (isPermanentHostedSecureBoxOpenFailure(error)) {
      throw new DeviceProviderApplicationSecretInvalidError();
    }
    throw error;
  }
  if (!decrypted) {
    throw new DeviceProviderApplicationSecretInvalidError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
    return parseDeviceProviderApplicationSecret({
      expectedProvider: input.provider,
      value: parsed,
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new DeviceProviderApplicationSecretInvalidError();
    }
    throw error;
  }
}

function isPermanentHostedSecureBoxOpenFailure(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }
  if (
    error instanceof Error
    && ["DataError", "InvalidCharacterError", "OperationError"].includes(
      error.name,
    )
  ) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "Hosted secure-box domain mismatch",
    "Hosted secure-box envelope",
    "Hosted secure-box IV",
    "Hosted secure-box lane mismatch",
    "Hosted secure-box rootKeyId mismatch",
    "Hosted secure-box scope mismatch",
  ].some((prefix) => error.message.startsWith(prefix));
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
