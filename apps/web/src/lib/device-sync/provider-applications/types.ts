import type {
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";

export const DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA =
  "murph.device-provider-application.strava.v1" as const;

export const MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS = [
  "strava",
] as const;

export type MemberOwnedDeviceProviderApplicationProvider =
  (typeof MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS)[number];

export interface StravaDeviceProviderApplicationSecret {
  schema: typeof DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA;
  clientId: string;
  clientSecret: string;
}

export type DeviceProviderApplicationSecret =
  StravaDeviceProviderApplicationSecret;

export interface DeviceProviderApplicationBinding {
  applicationId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  revision: number;
}

export interface DeviceProviderApplicationView
  extends DeviceProviderApplicationBinding {
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedDeviceProviderApplication
  extends DeviceProviderApplicationBinding {
  providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
}

export function isMemberOwnedDeviceProviderApplicationProvider(
  value: string,
): value is MemberOwnedDeviceProviderApplicationProvider {
  return (MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS as readonly string[])
    .includes(value);
}

export function requireMemberOwnedDeviceProviderApplicationProvider(
  value: string,
): MemberOwnedDeviceProviderApplicationProvider {
  if (isMemberOwnedDeviceProviderApplicationProvider(value)) {
    return value;
  }
  throw new TypeError(`Device provider application ${value} is not supported.`);
}

export function requireDeviceProviderApplicationRevision(
  value: unknown,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError("Device provider application revision must be a positive integer.");
  }
  return value as number;
}

export function parseDeviceProviderApplicationSecret(input: {
  expectedProvider: MemberOwnedDeviceProviderApplicationProvider;
  value: unknown;
}): DeviceProviderApplicationSecret {
  const record = requireRecord(
    input.value,
    "Device provider application secret",
  );

  switch (input.expectedProvider) {
    case "strava":
      assertExactKeys(record, ["schema", "clientId", "clientSecret"]);
      if (record.schema !== DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA) {
        throw new TypeError("Device provider application secret schema is invalid.");
      }
      return {
        schema: DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA,
        clientId: requireBoundedString(record.clientId, "clientId", 512),
        clientSecret: requireBoundedString(record.clientSecret, "clientSecret", 4096),
      };
  }
}

export function buildDeviceProviderApplicationSecret(input: {
  clientId: string;
  clientSecret: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
}): DeviceProviderApplicationSecret {
  switch (input.provider) {
    case "strava":
      return parseDeviceProviderApplicationSecret({
        expectedProvider: "strava",
        value: {
          schema: DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
        },
      });
  }
}

export function buildDeviceProviderApplicationRuntimeConfigs(input: {
  provider: MemberOwnedDeviceProviderApplicationProvider;
  secret: DeviceProviderApplicationSecret;
}): SerializableConfiguredDeviceSyncProviderConfigs {
  switch (input.provider) {
    case "strava":
      if (input.secret.schema !== DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA) {
        throw new TypeError(
          "Strava device provider application secret schema is invalid.",
        );
      }
      return {
        strava: {
          clientId: input.secret.clientId,
          clientSecret: input.secret.clientSecret,
        },
      };
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Device provider application secret field ${key} is not supported.`,
      );
    }
  }
  for (const key of allowedKeys) {
    if (!(key in record)) {
      throw new TypeError(
        `Device provider application secret field ${key} is required.`,
      );
    }
  }
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`Device provider application ${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new TypeError(
      `Device provider application ${field} must contain 1-${maxLength} characters.`,
    );
  }
  return normalized;
}
