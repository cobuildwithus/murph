import { describe, expect, it } from "vitest";

import {
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_TIMESERIES_RESOURCES,
} from "@murphai/contracts";
import {
  cloneConfiguredDeviceSyncRuntimeConfig,
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  configuredDeviceSyncProviderKeys,
  createConfiguredDeviceSyncProvidersFromConfigs,
  deviceSyncProviderManifests,
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
  getConfiguredDeviceSyncProviderManifest,
  getConfiguredDeviceSyncProviderJobDefinition,
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  listDeviceSyncProviderCatalog,
  normalizeConfiguredDeviceSyncJobInput,
  normalizeConfiguredDeviceSyncJobRecord,
  parseSerializableConfiguredDeviceSyncProviderConfigs,
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import { shapeHostedDeviceSyncJobHintPayload } from "@murphai/device-syncd/hosted-hints";
import {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
} from "@murphai/device-syncd/junction-resources";
import { listConfiguredDeviceSyncPublicProviderDescriptors } from "@murphai/device-syncd/public-provider-descriptors";
import {
  configuredDeviceSyncProviderKeys as rootConfiguredDeviceSyncProviderKeys,
  deviceSyncProviderManifests as rootDeviceSyncProviderManifests,
  getConfiguredDeviceSyncProviderManifest as rootGetConfiguredDeviceSyncProviderManifest,
  getConfiguredDeviceSyncProviderJobDefinition as rootGetConfiguredDeviceSyncProviderJobDefinition,
  resolveJunctionBaseUrl,
  resolveConfiguredDeviceSyncProviderManifest as rootResolveConfiguredDeviceSyncProviderManifest,
} from "@murphai/device-syncd";
import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";
import { normalizeJunctionDeviceSyncRuntimeConfig } from "../src/config/provider-manifests.ts";

describe("deviceSyncProviderManifests", () => {
  it("keeps provider ids, descriptors, and capabilities aligned", () => {
    expect(deviceSyncProviderManifests.map((manifest) => manifest.provider)).toEqual(
      configuredDeviceSyncProviderKeys,
    );

    for (const manifest of deviceSyncProviderManifests) {
      expect(manifest.descriptor.provider).toBe(manifest.provider);
      expect(manifest.capabilities.scheduledPoll).toBe(
        manifest.descriptor.transportModes.includes("scheduled_poll"),
      );
      expect(manifest.capabilities.webhookPush).toBe(
        manifest.descriptor.transportModes.includes("webhook_push"),
      );
      expect(manifest.capabilities.webhookAdmin).toBe(
        Boolean(manifest.descriptor.webhook?.supportsAdmin),
      );
      expect(manifest.capabilities.tokenRefresh).toBe(
        Boolean(manifest.descriptor.sync?.supportsTokenRefresh),
      );
      expect(manifest.capabilities.remoteDisconnect).toBe(
        Boolean(manifest.descriptor.sync?.supportsRemoteDisconnect),
      );
      expect(Object.keys(manifest.jobs).length).toBeGreaterThan(0);
    }
  });

  it("pins Junction to provider_config credentials and validates its API key inputs", () => {
    const junctionManifest = getConfiguredDeviceSyncProviderManifest("junction");

    expect(junctionManifest.credentialPolicy).toEqual({
      kind: "provider_config",
      providerConfigKey: "junction",
    });

    expect(() =>
      junctionManifest.readConfig({
        JUNCTION_WEBHOOK_SECRET: "<REDACTED_WEBHOOK_SECRET>",
      }),
    ).toThrow(/Junction configuration is incomplete/u);

    expect(() =>
      junctionManifest.readConfig({
        JUNCTION_API_KEY: "pk_us_test_manifest",
        JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
        JUNCTION_ENV: "sandbox",
        JUNCTION_REGION: "us",
      }),
    ).toThrow(/JUNCTION_API_KEY must start with sk_us_/u);

    const config = junctionManifest.readConfig({
      JUNCTION_API_KEY: "sk_us_test_manifest",
      JUNCTION_CLIENT_USER_ID_NAMESPACE: "e2e",
      JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    });

    expect(config).toMatchObject({
      clientUserIdNamespace: "e2e",
      environment: "sandbox",
      region: "us",
    });
    const invalidNamespaceConfig = junctionManifest.readConfig({
      JUNCTION_API_KEY: "sk_us_test_manifest",
      JUNCTION_CLIENT_USER_ID_NAMESPACE: "Native-iOS",
      JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    });
    if (!invalidNamespaceConfig) {
      throw new Error("Expected invalid Junction namespace config to be present.");
    }
    expect(() => createConfiguredDeviceSyncProvidersFromConfigs({
      junction: invalidNamespaceConfig,
    })).toThrow(/JUNCTION_CLIENT_USER_ID_NAMESPACE/u);
    expect(config).not.toHaveProperty("allowCustomBaseUrl");
    expect(config).not.toHaveProperty("baseUrl");
  });

  it("activates the exact code-owned production timeseries list", () => {
    expect([...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES])
      .toEqual([...JUNCTION_TIMESERIES_RESOURCES]);
    const configs = readConfiguredDeviceSyncProviderConfigs({
      JUNCTION_API_KEY: "sk_us_test_manifest",
      JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    });

    const junctionConfig = configs.junction;
    if (!junctionConfig) {
      throw new Error("Expected Junction config to be present.");
    }
    expect(junctionConfig.timeseriesResources)
      .toEqual([...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES]);
    expect([...JUNCTION_DEFAULT_TIMESERIES_RESOURCES].slice(-7)).toEqual([
      "forced_vital_capacity",
      "heart_rate_alert",
      "inhaler_usage",
      "insulin_injection",
      "peak_expiratory_flow_rate",
      "sleep_apnea_alert",
      "fall",
    ]);
    expect(normalizeJunctionDeviceSyncRuntimeConfig(junctionConfig).timeseriesResources)
      .toEqual([...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES]);
    expect(() => createConfiguredDeviceSyncProvidersFromConfigs(configs)).not.toThrow();
  });

  it("keeps exact Junction timeseries overrides truthful", () => {
    const configs = readConfiguredDeviceSyncProviderConfigs({
      JUNCTION_API_KEY: "sk_us_test_manifest",
      JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    });
    const junctionConfig = configs.junction;
    if (!junctionConfig) {
      throw new Error("Expected Junction config to be present.");
    }

    expect([...JUNCTION_OPT_IN_TIMESERIES_RESOURCES]).toEqual([
      "body_mass_index",
      "fat",
      "lean_body_mass",
      "waist_circumference",
      "calories_basal",
      "daylight_exposure",
      "floors_climbed",
      "handwashing",
      "stand_duration",
      "stand_hour",
      "uv_exposure",
      "wheelchair_push",
      "workout_distance",
      "workout_duration",
      "workout_swimming_stroke",
      "electrocardiogram_voltage",
      "workout_stream",
    ]);
    for (const resource of JUNCTION_OPT_IN_TIMESERIES_RESOURCES) {
      expect(normalizeJunctionDeviceSyncRuntimeConfig({
        ...junctionConfig,
        timeseriesResources: [resource],
      }).timeseriesResources).toEqual([resource]);
    }
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: ["steps", "heart_rate", "body_weight"],
    }).timeseriesResources).toEqual(["steps", "heartrate", "weight"]);
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: ["distance", "calories_active"],
    }).timeseriesResources).toEqual(["distance", "calories_active"]);
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: [],
    }).timeseriesResources).toEqual([]);
    expect(() => normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: ["workout_heartrate"],
    })).toThrow(/unsupported resource/u);
  });

  it.each([
    [undefined, 21_600_000],
    [0, 60_000],
    [1, 60_000],
    [59_999, 60_000],
    [60_000, 60_000],
    [123_000, 123_000],
  ])("normalizes Junction reconcile interval %s to %i ms", (
    reconcileIntervalMs,
    expected,
  ) => {
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      apiKey: "sk_us_test_manifest",
      clientUserIdSecret: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      environment: "sandbox",
      reconcileIntervalMs,
      region: "us",
     }).reconcileIntervalMs).toBe(expected);
  });

  it("resolves Junction canonical base URLs from environment and region", () => {
    const profiles = [
      {
        environment: "production",
        region: "us",
        expected: "https://api.us.junction.com/",
      },
      {
        environment: "production",
        region: "eu",
        expected: "https://api.eu.junction.com/",
      },
      {
        environment: "sandbox",
        region: "us",
        expected: "https://api.sandbox.us.junction.com/",
      },
      {
        environment: "sandbox",
        region: "eu",
        expected: "https://api.sandbox.eu.junction.com/",
      },
    ] as const;

    for (const profile of profiles) {
      expect(resolveJunctionBaseUrl({
        environment: profile.environment,
        region: profile.region,
      })).toBe(profile.expected);
    }
  });

  it("derives runtime env lists from manifest env specs", () => {
    expect([...deviceSyncProviderRuntimeSecretEnvKeys]).toEqual(
      [...new Set(deviceSyncProviderManifests.flatMap((manifest) => manifest.env.secretKeys))],
    );
    expect([...deviceSyncProviderRuntimeVariableEnvKeys]).toEqual(
      [...new Set(deviceSyncProviderManifests.flatMap((manifest) => manifest.env.variableKeys))],
    );
  });

  it("rejects public provider descriptors when runtime provider config is invalid", () => {
    const configs = readConfiguredDeviceSyncProviderConfigs({
      JUNCTION_API_KEY: "sk_us_test_manifest",
      JUNCTION_CLIENT_USER_ID_SECRET: "short",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    });

    expect(() => createConfiguredDeviceSyncProvidersFromConfigs(configs))
      .toThrow(/JUNCTION_CLIENT_USER_ID_SECRET must be at least 16 characters/u);
    expect(() => listConfiguredDeviceSyncPublicProviderDescriptors(configs))
      .toThrow(/JUNCTION_CLIENT_USER_ID_SECRET must be at least 16 characters/u);
  });

  it("rejects Junction timeseries resources from serialized runtime config", () => {
    expect(() =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          junction: {
            timeseriesResources: ["blood_oxygen"],
          },
        },
        "runtime.providerConfigs",
      ),
    ).toThrow(/timeseriesResources is code-owned/u);
  });

  it("rejects Junction provider-owned secrets when cloning serializable runtime config", () => {
    const createRuntimeConfig = () => ({
      providerConfigs: {
        junction: {
          environment: "sandbox",
          providerFilter: ["fitbit"],
          region: "us",
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "secret_123",
    } satisfies Parameters<typeof cloneConfiguredDeviceSyncRuntimeConfig>[0]);

    const apiKeyConfig = createRuntimeConfig();
    Object.assign(apiKeyConfig.providerConfigs.junction, {
      apiKey: "sk_us_test_runtime",
    });
    expect(() => cloneConfiguredDeviceSyncRuntimeConfig(apiKeyConfig)).toThrow(
      /provider-owned API secret/,
    );

    const clientUserIdSecretConfig = createRuntimeConfig();
    Object.assign(clientUserIdSecretConfig.providerConfigs.junction, {
      clientUserIdSecret: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
    });
    expect(() => cloneConfiguredDeviceSyncRuntimeConfig(clientUserIdSecretConfig)).toThrow(
      /provider-owned HMAC secret/,
    );

    const webhookSecretConfig = createRuntimeConfig();
    Object.assign(webhookSecretConfig.providerConfigs.junction, {
      webhookSecret: "<REDACTED_WEBHOOK_SECRET>",
    });
    expect(() => cloneConfiguredDeviceSyncRuntimeConfig(webhookSecretConfig)).toThrow(
      /provider-owned webhook secret/,
    );
  });

});

describe("Junction opt-in timeseries configuration", () => {
  const baseConfig = {
    apiKey: "sk_us_test_opt_in",
    clientUserIdSecret: "junction-opt-in-secret",
    environment: "sandbox" as const,
    providerFilter: ["oura"],
    region: "us" as const,
  };

  it("requests only curated defaults when configuration is omitted", () => {
    expect(normalizeJunctionDeviceSyncRuntimeConfig(baseConfig).timeseriesResources)
      .toEqual(JUNCTION_DEFAULT_TIMESERIES_RESOURCES);
    expect(normalizeJunctionDeviceSyncRuntimeConfig(baseConfig).timeseriesResources)
      .not.toContain(JUNCTION_OPT_IN_TIMESERIES_RESOURCES[0]);
  });

  it("preserves an explicit only-opt-in list exactly", () => {
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...baseConfig,
      timeseriesResources: ["fat", "insulin_injection", "heart_rate_alert", "fat"],
    }).timeseriesResources).toEqual(["fat", "insulin_injection", "heart_rate_alert"]);
  });

  it("preserves the existing dense and weight opt-ins exactly", () => {
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...baseConfig,
      timeseriesResources: ["steps", "weight"],
    }).timeseriesResources).toEqual(["steps", "weight"]);
  });

  it("rejects unknown resource names", () => {
    expect(() => normalizeJunctionDeviceSyncRuntimeConfig({
      ...baseConfig,
      timeseriesResources: ["not_a_junction_resource"],
    })).toThrow(/unsupported resource/u);
  });
});
