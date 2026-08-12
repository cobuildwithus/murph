import { describe, expect, it } from "vitest";

import {
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
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
      JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    });

    expect(config).toMatchObject({
      environment: "sandbox",
      region: "us",
    });
    expect(config).not.toHaveProperty("allowCustomBaseUrl");
    expect(config).not.toHaveProperty("baseUrl");
  });

  it("defaults Junction timeseries resources from the compact code-owned allowlist", () => {
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
    expect(junctionConfig).not.toHaveProperty("timeseriesResources");
    expect(normalizeJunctionDeviceSyncRuntimeConfig(junctionConfig).timeseriesResources)
      .toEqual([...JUNCTION_DEFAULT_TIMESERIES_RESOURCES]);
    expect(() => createConfiguredDeviceSyncProvidersFromConfigs(configs)).not.toThrow();
  });

  it("admits exact Junction timeseries opt-ins without substituting defaults", () => {
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
      "steps",
      "distance",
      "calories_active",
      "heartrate",
      "weight",
      "body_mass_index",
      "carbohydrates",
      "fat",
      "forced_expiratory_volume_1",
      "forced_vital_capacity",
      "heart_rate_alert",
      "inhaler_usage",
      "insulin_injection",
      "lean_body_mass",
      "peak_expiratory_flow_rate",
      "sleep_apnea_alert",
      "waist_circumference",
    ]);
    for (const resource of JUNCTION_OPT_IN_TIMESERIES_RESOURCES) {
      expect(normalizeJunctionDeviceSyncRuntimeConfig({
        ...junctionConfig,
        timeseriesResources: [resource],
      }).timeseriesResources).toEqual([resource]);
    }
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: [...JUNCTION_OPT_IN_TIMESERIES_RESOURCES],
    }).timeseriesResources).toEqual([...JUNCTION_OPT_IN_TIMESERIES_RESOURCES]);
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: ["heart_rate", "body_weight"],
    }).timeseriesResources).toEqual(["heartrate", "weight"]);
    expect(normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: [],
    }).timeseriesResources).toEqual([]);
    expect(() => normalizeJunctionDeviceSyncRuntimeConfig({
      ...junctionConfig,
      timeseriesResources: ["workout_heartrate"],
    })).toThrow(/unsupported resource/u);
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

  it("declares provider-owned job definitions for every built-in provider job kind", () => {
    expect(getConfiguredDeviceSyncProviderJobDefinition("junction", "backfill")).toEqual({
      payload: {
        emptyBackfillAttempts: { kind: "number", includeInHostedHint: true },
        sourceProviderSlug: { kind: "string", includeInHostedHint: true },
        timeseriesCursor: { kind: "string", includeInHostedHint: true },
        timeseriesPhase: { kind: "string", includeInHostedHint: true },
        windowEnd: { kind: "string", includeInHostedHint: true },
        windowStart: { kind: "string", includeInHostedHint: true },
      },
    });
    expect(getConfiguredDeviceSyncProviderJobDefinition("oura", "resource")).toMatchObject({
      payload: {
        dataType: { kind: "string", includeInHostedHint: true },
        objectId: { kind: "string", includeInHostedHint: true },
      },
    });
    expect(getConfiguredDeviceSyncProviderJobDefinition("whoop", "delete")).toMatchObject({
      payload: {
        resourceId: { kind: "string", includeInHostedHint: true, required: true },
        resourceType: { kind: "string", includeInHostedHint: true, required: true },
      },
    });
    expect(getConfiguredDeviceSyncProviderJobDefinition("strava", "deauthorize")).toMatchObject({
      payload: {
        resourceId: { kind: "string", includeInHostedHint: true, required: true },
        resourceType: { kind: "string", includeInHostedHint: true, required: true },
      },
    });
  });

  it("derives runtime env lists from manifest env specs", () => {
    expect([...deviceSyncProviderRuntimeSecretEnvKeys]).toEqual(
      [...new Set(deviceSyncProviderManifests.flatMap((manifest) => manifest.env.secretKeys))],
    );
    expect([...deviceSyncProviderRuntimeVariableEnvKeys]).toEqual(
      [...new Set(deviceSyncProviderManifests.flatMap((manifest) => manifest.env.variableKeys))],
    );
  });

  it("lists a redacted provider catalog without runtime config or URLs", () => {
    const catalog = listDeviceSyncProviderCatalog();

    expect(catalog.map((provider) => provider.provider)).toEqual(configuredDeviceSyncProviderKeys);
    for (const manifest of deviceSyncProviderManifests) {
      const connection = resolveDeviceProviderConnectionDescriptor(manifest.descriptor);
      expect(catalog.find((provider) => provider.provider === manifest.provider)).toMatchObject({
        callbackPath: connection.callbackPath ?? null,
        defaultScopes: [...(connection.defaultScopes ?? [])],
      });
    }
    expect(catalog.find((provider) => provider.provider === "whoop")).toMatchObject({
      displayName: "WHOOP",
      callbackPath: "/oauth/whoop/callback",
      webhookPath: "/webhooks/whoop",
      supportsWebhooks: true,
    });
    expect(JSON.stringify(catalog)).not.toMatch(/clientSecret|clientId|readConfig/u);
  });

  it("reads configured providers and creates runtime providers through the manifest registry", () => {
    const configs = readConfiguredDeviceSyncProviderConfigs({
      JUNCTION_API_KEY: "sk_us_test_manifest",
      JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "<REDACTED_STRAVA_CLIENT_SECRET>",
      STRAVA_SCOPES: "activity:read, profile:read_all",
    });

    expect(Object.keys(configs).sort()).toEqual(["junction", "strava"]);

    const providers = createConfiguredDeviceSyncProvidersFromConfigs(configs);

    expect(providers.map((provider) => provider.provider)).toEqual(["junction", "strava"]);
    expect(providers[1]?.descriptor.oauth?.defaultScopes).toEqual([
      "activity:read",
      "profile:read_all",
    ]);
  });

  it("keeps public provider descriptors aligned with runtime provider descriptors", () => {
    const configs = readConfiguredDeviceSyncProviderConfigs({
      OURA_CLIENT_ID: "oura-client-id",
      OURA_CLIENT_SECRET: "<REDACTED_OURA_CLIENT_SECRET>",
      OURA_SCOPES: "daily,spo2,extapi:heartrate",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "<REDACTED_STRAVA_CLIENT_SECRET>",
      STRAVA_SCOPES: "activity:read, profile:read_all",
      WHOOP_CLIENT_ID: "whoop-client-id",
      WHOOP_CLIENT_SECRET: "<REDACTED_WHOOP_CLIENT_SECRET>",
      WHOOP_SCOPES: "read:sleep, read:recovery",
    });

    const publicDescriptors = listConfiguredDeviceSyncPublicProviderDescriptors(configs);
    const runtimeProviders = createConfiguredDeviceSyncProvidersFromConfigs(configs);

    for (const runtimeProvider of runtimeProviders) {
      const connection = resolveDeviceProviderConnectionDescriptor(runtimeProvider.descriptor);
      expect(
        publicDescriptors.find((descriptor) => descriptor.provider === runtimeProvider.provider),
      ).toMatchObject({
        defaultScopes: [
          ...(runtimeProvider.descriptor.oauth?.defaultScopes ?? connection.defaultScopes ?? []),
        ],
        provider: runtimeProvider.provider,
      });
    }

    const ouraDescriptor = publicDescriptors.find((descriptor) => descriptor.provider === "oura");
    const whoopDescriptor = publicDescriptors.find((descriptor) => descriptor.provider === "whoop");

    expect(ouraDescriptor?.defaultScopes).not.toContain("extapi:heartrate");
    expect(whoopDescriptor?.defaultScopes).toEqual([
      "offline",
      "read:profile",
      "read:sleep",
      "read:recovery",
    ]);
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

  it("round-trips serializable provider configs through manifest field specs", () => {
    const cloned = cloneSerializableConfiguredDeviceSyncProviderConfigs({
      junction: {
        allowedLinkHosts: ["junction.com", "tryvital.io"],
        apiKey: "sk_us_test_runtime",
        clientUserIdSecret: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
        environment: "sandbox",
        region: "us",
        webhookSecret: "<REDACTED_WEBHOOK_SECRET>",
        webhookTimestampToleranceMs: 300_000,
        providerFilter: ["oura", "withings"],
        summaryResources: ["profile", "activity"],
        timeseriesResources: ["blood_oxygen", "stress_level"],
        summaryBackfillDays: 180,
        timeseriesBackfillDays: 14,
        reconcileDays: 7,
        reconcileIntervalMs: 3_600_000,
        requestTimeoutMs: 10_000,
      },
      oura: {
        apiBaseUrl: "https://api.oura.com",
        authBaseUrl: "https://cloud.oura.com",
        backfillDays: 30,
        clientId: "oura-id",
        clientSecret: "<REDACTED_OURA_CLIENT_SECRET>",
        reconcileDays: 14,
        reconcileIntervalMs: 7_200_000,
        requestTimeoutMs: 10_000,
        scopes: ["personal", "daily"],
        webhookTimestampToleranceMs: 300_000,
        webhookVerificationToken: "<REDACTED_WEBHOOK_SECRET>",
      },
      whoop: {
        backfillDays: 21,
        baseUrl: "https://api.prod.whoop.com",
        clientId: "whoop-id",
        clientSecret: "<REDACTED_WHOOP_CLIENT_SECRET>",
        reconcileDays: 14,
        reconcileIntervalMs: 7_200_000,
        requestTimeoutMs: 10_000,
        scopes: ["offline", "read:sleep"],
        webhookTimestampToleranceMs: 300_000,
      },
      strava: {
        apiBaseUrl: "https://www.strava.com/api/v3",
        authBaseUrl: "https://www.strava.com",
        backfillDays: 30,
        clientId: "strava-id",
        clientSecret: "<REDACTED_STRAVA_CLIENT_SECRET>",
        reconcileDays: 7,
        reconcileIntervalMs: 3_600_000,
        requestTimeoutMs: 10_000,
        scopes: ["activity:read"],
        webhookSigningSecret: "<REDACTED_WEBHOOK_SECRET>",
        webhookTimestampToleranceMs: 300_000,
        webhookVerifyToken: "<REDACTED_WEBHOOK_SECRET>",
      },
    });

    expect(cloned.oura).not.toHaveProperty("webhookVerificationToken");
    expect(cloned.strava).not.toHaveProperty("webhookSigningSecret");
    expect(cloned.strava).not.toHaveProperty("webhookVerifyToken");
    expect(cloned.junction).not.toHaveProperty("apiKey");
    expect(cloned.junction).not.toHaveProperty("allowCustomBaseUrl");
    expect(cloned.junction).not.toHaveProperty("baseUrl");
    expect(cloned.junction).not.toHaveProperty("clientUserIdSecret");
    expect(cloned.junction).not.toHaveProperty("timeseriesResources");
    expect(cloned.junction).not.toHaveProperty("webhookSecret");
    expect(cloned.junction).toMatchObject({
      allowedLinkHosts: ["junction.com", "tryvital.io"],
      environment: "sandbox",
      region: "us",
      providerFilter: ["oura", "withings"],
    });

    expect(
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        structuredClone(cloned),
        "runtime.providerConfigs",
      ),
    ).toEqual(cloned);
  });

  it("rejects provider-owned admin secrets from serialized runtime config", () => {
    expect(() =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          oura: {
            clientId: "oura-id",
            clientSecret: "<REDACTED_OURA_CLIENT_SECRET>",
            webhookVerificationToken: "<REDACTED_WEBHOOK_SECRET>",
          },
        },
        "runtime.providerConfigs",
      ),
    ).toThrow(/provider-owned admin secret/);
    expect(() =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          junction: {
            apiKey: "sk_us_test_runtime",
          },
        },
        "runtime.providerConfigs",
      ),
    ).toThrow(/provider-owned API secret/);
    expect(() =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          junction: {
            clientUserIdSecret: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
          },
        },
        "runtime.providerConfigs",
      ),
    ).toThrow(/provider-owned HMAC secret/);
    expect(() =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          junction: {
            webhookSecret: "<REDACTED_WEBHOOK_SECRET>",
          },
        },
        "runtime.providerConfigs",
      ),
    ).toThrow(/provider-owned webhook secret/);
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

  it("shapes hosted hint payloads from the provider manifest", () => {
    expect(
      shapeHostedDeviceSyncJobHintPayload("junction", {
        kind: "backfill",
        payload: {
          emptyBackfillAttempts: 2,
          resources: ["profile"],
          timeseriesCursor: "2026-04-01T00:00:00.000Z",
          timeseriesPhase: "wide",
          windowEnd: "2026-04-22T00:00:00.000Z",
          windowStart: "2026-01-22T00:00:00.000Z",
        },
      }),
    ).toEqual({
      emptyBackfillAttempts: 2,
      timeseriesCursor: "2026-04-01T00:00:00.000Z",
      timeseriesPhase: "wide",
      windowEnd: "2026-04-22T00:00:00.000Z",
      windowStart: "2026-01-22T00:00:00.000Z",
    });

    expect(
      shapeHostedDeviceSyncJobHintPayload("junction", {
        kind: "resource",
        payload: {
          eventType: "daily.data.activity.created",
          historicalBackfillVersion: 2,
          historicalProviderRecordsSeen: true,
          historicalUnresolvedProviderRecordIdentitiesJson:
            "{\"v\":1,\"i\":[\"blood-pressure-0123456789abcdef\",\"blood-pressure-fedcba9876543210\"]}",
          historicalUnresolvedProviderRecordCount: 2,
          ignored: "value",
          objectId: "activity-1",
          occurredAt: "2026-04-22T00:00:00.000Z",
          resource: "activity",
          resourceCategory: "summary",
          sourceProviderSlug: "oura",
          windowEnd: "2026-04-22T00:00:00.000Z",
          windowStart: "2026-04-21T00:00:00.000Z",
        },
      }),
    ).toEqual({
      eventType: "daily.data.activity.created",
      historicalBackfillVersion: 2,
      historicalProviderRecordsSeen: true,
      historicalUnresolvedProviderRecordIdentitiesJson:
        "{\"v\":1,\"i\":[\"blood-pressure-0123456789abcdef\",\"blood-pressure-fedcba9876543210\"]}",
      historicalUnresolvedProviderRecordCount: 2,
      objectId: "activity-1",
      occurredAt: "2026-04-22T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "oura",
      windowEnd: "2026-04-22T00:00:00.000Z",
      windowStart: "2026-04-21T00:00:00.000Z",
    });

    const companionBatchJson = JSON.stringify({
      schemaVersion: 1,
      records: [{
        recordId: "a".repeat(64),
        kind: "recovery_score",
        value: 72,
        startAt: "2026-04-21T04:00:00.000Z",
        endAt: "2026-04-21T12:00:00.000Z",
      }],
    });
    expect(
      shapeHostedDeviceSyncJobHintPayload("junction", {
        kind: "resource",
        payload: {
          eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
          occurredAt: "2026-04-22T00:00:00.000Z",
          resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
          resourceCategory: "summary",
          sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
          webhookDataJson: companionBatchJson,
        },
      }),
    ).toEqual({
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: "2026-04-22T00:00:00.000Z",
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: companionBatchJson,
    });

    expect(
      shapeHostedDeviceSyncJobHintPayload("oura", {
        kind: "resource",
        payload: {
          dataType: "daily_sleep",
          ignored: "value",
          includePersonalInfo: true,
          objectId: "object_123",
          occurredAt: "2026-04-22T00:00:00.000Z",
          windowEnd: "2026-04-22T00:00:00.000Z",
          windowStart: "2026-04-21T00:00:00.000Z",
        },
      }),
    ).toEqual({
      dataType: "daily_sleep",
      includePersonalInfo: true,
      objectId: "object_123",
      occurredAt: "2026-04-22T00:00:00.000Z",
      windowEnd: "2026-04-22T00:00:00.000Z",
      windowStart: "2026-04-21T00:00:00.000Z",
    });

    expect(
      shapeHostedDeviceSyncJobHintPayload("whoop", {
        kind: "resource",
        payload: {
          eventType: "workout.updated",
          extra: 123,
          occurredAt: "2026-04-22T00:00:00.000Z",
          resourceId: "456",
          resourceType: "workout",
        },
      }),
    ).toEqual({
      eventType: "workout.updated",
      occurredAt: "2026-04-22T00:00:00.000Z",
      resourceId: "456",
      resourceType: "workout",
    });

    expect(
      shapeHostedDeviceSyncJobHintPayload("strava", {
        kind: "deauthorize",
        payload: {
          eventType: "athlete.authorization.revoked",
          occurredAt: "2026-04-22T00:00:00.000Z",
          resourceId: "789",
          resourceType: "athlete",
          shouldIgnore: true,
        },
      }),
    ).toEqual({
      eventType: "athlete.authorization.revoked",
      occurredAt: "2026-04-22T00:00:00.000Z",
      resourceId: "789",
      resourceType: "athlete",
    });
  });

  it("resolves typed manifests by provider key", () => {
    expect(getConfiguredDeviceSyncProviderManifest("oura").provider).toBe("oura");
  });

  it("normalizes built-in job payloads through the manifest job definitions", () => {
    expect(
      normalizeConfiguredDeviceSyncJobInput("junction", {
        kind: "backfill",
        payload: {
          windowEnd: "2026-04-22T00:00:00.000Z",
          windowStart: "2026-04-01T00:00:00.000Z",
        },
      }, "test"),
    ).toEqual({
      kind: "backfill",
      payload: {
        windowEnd: "2026-04-22T00:00:00.000Z",
        windowStart: "2026-04-01T00:00:00.000Z",
      },
    });

    expect(
      normalizeConfiguredDeviceSyncJobRecord("strava", {
        id: "job-1",
        provider: "strava",
        accountId: "acct-1",
        kind: "resource",
        payload: {
          eventType: "activity.update",
          resourceId: "activity-123",
          resourceType: "activity",
        },
        priority: 90,
        availableAt: "2026-04-22T00:00:00.000Z",
        attempts: 0,
        maxAttempts: 5,
        dedupeKey: null,
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      }, "test"),
    ).toMatchObject({
      kind: "resource",
      payload: {
        eventType: "activity.update",
        resourceId: "activity-123",
        resourceType: "activity",
      },
    });
  });

  it("rejects built-in job payloads that drift from the provider manifest", () => {
    expect(() =>
      normalizeConfiguredDeviceSyncJobInput("oura", {
        kind: "resource",
        payload: {
          dataType: "daily_sleep",
          objectId: "sleep_123",
          unexpected: true,
        },
      }, "test"),
    ).toThrow(/not declared in the provider manifest/);

    expect(() =>
      normalizeConfiguredDeviceSyncJobRecord("strava", {
        id: "job-2",
        provider: "strava",
        accountId: "acct-1",
        kind: "resource",
        payload: {
          resourceId: 123,
          resourceType: "activity",
        },
        priority: 90,
        availableAt: "2026-04-22T00:00:00.000Z",
        attempts: 0,
        maxAttempts: 5,
        dedupeKey: null,
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      }, "test"),
    ).toThrow(/resourceId must be a string/);
  });

  it("re-exports the manifest registry through the package root barrel", () => {
    expect(rootConfiguredDeviceSyncProviderKeys).toEqual(configuredDeviceSyncProviderKeys);
    expect(rootDeviceSyncProviderManifests).toEqual(deviceSyncProviderManifests);
    expect(rootGetConfiguredDeviceSyncProviderManifest("junction")).toBe(
      getConfiguredDeviceSyncProviderManifest("junction"),
    );
    expect(rootGetConfiguredDeviceSyncProviderJobDefinition("strava", "resource")).toBe(
      getConfiguredDeviceSyncProviderJobDefinition("strava", "resource"),
    );
    expect(rootResolveConfiguredDeviceSyncProviderManifest("oura")).toBe(
      getConfiguredDeviceSyncProviderManifest("oura"),
    );
  });

  it("freezes exported manifest shapes so callers cannot mutate shared registry state", () => {
    const ouraManifest = getConfiguredDeviceSyncProviderManifest("oura");

    expect(Object.isFrozen(ouraManifest)).toBe(true);
    expect(Object.isFrozen(ouraManifest.capabilities)).toBe(true);
    expect(Object.isFrozen(ouraManifest.env)).toBe(true);
    expect(Object.isFrozen(ouraManifest.env.configKeys)).toBe(true);
    expect(Object.isFrozen(ouraManifest.jobs)).toBe(true);
    expect(Object.isFrozen(ouraManifest.jobs.resource ?? {})).toBe(true);
    expect(Object.isFrozen(ouraManifest.jobs.resource?.payload ?? {})).toBe(true);
    expect(Object.isFrozen(ouraManifest.jobs.resource?.payload.objectId ?? {})).toBe(true);
    expect(Object.isFrozen(ouraManifest.serializableFields)).toBe(true);
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

  it("keeps defaults unchanged when no code-owned override is supplied", () => {
    expect(normalizeJunctionDeviceSyncRuntimeConfig(baseConfig).timeseriesResources)
      .toEqual(JUNCTION_DEFAULT_TIMESERIES_RESOURCES);
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
