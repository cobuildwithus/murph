import { describe, expect, it } from "vitest";

import {
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
  configuredDeviceSyncProviderKeys as rootConfiguredDeviceSyncProviderKeys,
  deviceSyncProviderManifests as rootDeviceSyncProviderManifests,
  getConfiguredDeviceSyncProviderManifest as rootGetConfiguredDeviceSyncProviderManifest,
  getConfiguredDeviceSyncProviderJobDefinition as rootGetConfiguredDeviceSyncProviderJobDefinition,
  resolveConfiguredDeviceSyncProviderManifest as rootResolveConfiguredDeviceSyncProviderManifest,
} from "@murphai/device-syncd";

describe("deviceSyncProviderManifests", () => {
  it("keeps provider ids, descriptors, importers, and capabilities aligned", () => {
    expect(deviceSyncProviderManifests.map((manifest) => manifest.provider)).toEqual(
      configuredDeviceSyncProviderKeys,
    );

    for (const manifest of deviceSyncProviderManifests) {
      expect(manifest.descriptor.provider).toBe(manifest.provider);
      expect(manifest.importer.provider).toBe(manifest.provider);
      expect(manifest.capabilities.auth).toBe("oauth2");
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

  it("declares provider-owned job definitions for every built-in provider job kind", () => {
    expect(getConfiguredDeviceSyncProviderJobDefinition("garmin", "backfill")).toMatchObject({
      payload: {
        dataType: { kind: "string" },
        dataTypes: { kind: "string[]" },
        includeProfile: { kind: "boolean", includeInHostedHint: true },
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
    expect(catalog.find((provider) => provider.provider === "whoop")).toMatchObject({
      displayName: "WHOOP",
      callbackPath: "/oauth/whoop/callback",
      webhookPath: "/webhooks/whoop",
      supportsWebhooks: true,
    });
    expect(JSON.stringify(catalog)).not.toMatch(/clientSecret|clientId|readConfig|createProvider/u);
  });

  it("reads configured providers and creates runtime providers through the manifest registry", () => {
    const configs = readConfiguredDeviceSyncProviderConfigs({
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "strava-client-secret",
      STRAVA_SCOPES: "activity:read, profile:read_all",
    });

    expect(Object.keys(configs).sort()).toEqual(["garmin", "strava"]);

    const providers = createConfiguredDeviceSyncProvidersFromConfigs(configs);

    expect(providers.map((provider) => provider.provider)).toEqual(["garmin", "strava"]);
    expect(providers[1]?.descriptor.oauth?.defaultScopes).toEqual([
      "activity:read",
      "profile:read_all",
    ]);
  });

  it("round-trips serializable provider configs through manifest field specs", () => {
    const cloned = cloneSerializableConfiguredDeviceSyncProviderConfigs({
      garmin: {
        apiBaseUrl: "https://apis.garmin.com",
        authBaseUrl: "https://connect.garmin.com",
        backfillDays: 14,
        clientId: "garmin-id",
        clientSecret: "garmin-secret",
        reconcileDays: 7,
        reconcileIntervalMs: 3_600_000,
        requestTimeoutMs: 15_000,
        tokenBaseUrl: "https://connectapi.garmin.com",
      },
      oura: {
        apiBaseUrl: "https://api.oura.com",
        authBaseUrl: "https://cloud.oura.com",
        backfillDays: 30,
        clientId: "oura-id",
        clientSecret: "oura-secret",
        reconcileDays: 14,
        reconcileIntervalMs: 7_200_000,
        requestTimeoutMs: 10_000,
        scopes: ["personal", "daily"],
        webhookTimestampToleranceMs: 300_000,
        webhookVerificationToken: "provider-owned-secret",
      },
      whoop: {
        backfillDays: 21,
        baseUrl: "https://api.prod.whoop.com",
        clientId: "whoop-id",
        clientSecret: "whoop-secret",
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
        clientSecret: "strava-secret",
        reconcileDays: 7,
        reconcileIntervalMs: 3_600_000,
        requestTimeoutMs: 10_000,
        scopes: ["activity:read"],
        webhookVerifyToken: "provider-owned-secret",
      },
    });

    expect(cloned.oura).not.toHaveProperty("webhookVerificationToken");
    expect(cloned.strava).not.toHaveProperty("webhookVerifyToken");

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
            clientSecret: "oura-secret",
            webhookVerificationToken: "provider-owned-secret",
          },
        },
        "runtime.providerConfigs",
      ),
    ).toThrow(/provider-owned admin secret/);
  });

  it("shapes hosted hint payloads from the provider manifest", () => {
    expect(
      shapeHostedDeviceSyncJobHintPayload("garmin", {
        kind: "backfill",
        payload: {
          includeProfile: true,
          ignored: "value",
          windowEnd: "2026-04-22T00:00:00.000Z",
          windowStart: "2026-04-01T00:00:00.000Z",
        },
      }),
    ).toEqual({
      includeProfile: true,
      windowEnd: "2026-04-22T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
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
      normalizeConfiguredDeviceSyncJobInput("garmin", {
        kind: "backfill",
        payload: {
          dataTypes: ["sleeps", "activities"],
          includeProfile: true,
          windowStart: "2026-04-01T00:00:00.000Z",
        },
      }, "test"),
    ).toEqual({
      kind: "backfill",
      payload: {
        dataTypes: ["sleeps", "activities"],
        includeProfile: true,
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
    expect(rootGetConfiguredDeviceSyncProviderManifest("garmin")).toBe(
      getConfiguredDeviceSyncProviderManifest("garmin"),
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
