import type {
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";

const STRAVA_DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA =
  "murph.device-provider-application.strava.v1" as const;

export const MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS = [
  "strava",
] as const;

export type MemberOwnedDeviceProviderApplicationProvider =
  (typeof MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS)[number];

export interface DeviceProviderApplicationSecret {
  schema: string;
  clientId: string;
  clientSecret: string;
}

interface MemberOwnedOAuthClientApplicationDefinition {
  buildRuntimeConfigs(
    credentials: Pick<DeviceProviderApplicationSecret, "clientId" | "clientSecret">,
  ): SerializableConfiguredDeviceSyncProviderConfigs;
  readClientId(configs: SerializableConfiguredDeviceSyncProviderConfigs): string;
  secretSchema: string;
}

const MEMBER_OWNED_OAUTH_CLIENT_APPLICATION_DEFINITIONS = {
  strava: {
    buildRuntimeConfigs: (credentials) => ({
      strava: {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        scopes: ["activity:read"],
      },
    }),
    readClientId: (configs) => {
      const clientId = configs.strava?.clientId;
      if (typeof clientId !== "string" || clientId.length === 0) {
        throw new TypeError("Resolved device provider application client ID is missing.");
      }
      return clientId;
    },
    secretSchema: STRAVA_DEVICE_PROVIDER_APPLICATION_SECRET_SCHEMA,
  },
} as const satisfies Record<
  MemberOwnedDeviceProviderApplicationProvider,
  MemberOwnedOAuthClientApplicationDefinition
>;

export interface DeviceProviderApplicationBinding<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  applicationId: string;
  provider: TProvider;
  revision: number;
}

export interface DeviceProviderApplicationView<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> extends DeviceProviderApplicationBinding<TProvider> {
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedDeviceProviderApplication<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> extends DeviceProviderApplicationBinding<TProvider> {
  providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
}

export function requireResolvedDeviceProviderApplicationClientId(
  application: ResolvedDeviceProviderApplication,
): string {
  return MEMBER_OWNED_OAUTH_CLIENT_APPLICATION_DEFINITIONS[
    application.provider
  ].readClientId(application.providerConfigs);
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

  const definition = MEMBER_OWNED_OAUTH_CLIENT_APPLICATION_DEFINITIONS[
    input.expectedProvider
  ];
  assertExactKeys(record, ["schema", "clientId", "clientSecret"]);
  if (record.schema !== definition.secretSchema) {
    throw new TypeError("Device provider application secret schema is invalid.");
  }
  return {
    schema: definition.secretSchema,
    clientId: requireBoundedString(record.clientId, "clientId", 512),
    clientSecret: requireBoundedString(record.clientSecret, "clientSecret", 4096),
  };
}

export function buildDeviceProviderApplicationSecret(input: {
  clientId: string;
  clientSecret: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
}): DeviceProviderApplicationSecret {
  const definition = MEMBER_OWNED_OAUTH_CLIENT_APPLICATION_DEFINITIONS[
    input.provider
  ];
  return parseDeviceProviderApplicationSecret({
    expectedProvider: input.provider,
    value: {
      schema: definition.secretSchema,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    },
  });
}

export function buildDeviceProviderApplicationRuntimeConfigs(input: {
  provider: MemberOwnedDeviceProviderApplicationProvider;
  secret: DeviceProviderApplicationSecret;
}): SerializableConfiguredDeviceSyncProviderConfigs {
  const definition = MEMBER_OWNED_OAUTH_CLIENT_APPLICATION_DEFINITIONS[
    input.provider
  ];
  if (input.secret.schema !== definition.secretSchema) {
    throw new TypeError(
      "Device provider application secret schema is invalid for its provider.",
    );
  }
  return definition.buildRuntimeConfigs(input.secret);
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
