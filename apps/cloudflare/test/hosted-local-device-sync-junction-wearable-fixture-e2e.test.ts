import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";
import {
  buildJunctionWearableHostedReplayPlan,
  JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS,
  JUNCTION_WEARABLE_BROWSER_VAULT_METRIC_EXPECTATIONS,
  JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES,
  JUNCTION_WEARABLE_FIXTURE_TIMESERIES_RESOURCES,
  summarizeJunctionWearableBrowserVaultReplica,
  type JunctionWearableBrowserVaultReplicaSummary,
  type JunctionWearableHostedReplayPlan,
} from "@murphai/vault-usecases/testing";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  expectJunctionWearableBiomarkerExpectationsToMatchProduction,
} from "./helpers/junction-wearable-biomarker-contract.js";

const runId = Date.now();
const userId = `member_local_junction_wearable_${runId}`;
const productionLikeAssistantModel = "gpt-5.5";
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const textDecoder = new TextDecoder();

let plan: JunctionWearableHostedReplayPlan | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let browserVaultSummary: JunctionWearableBrowserVaultReplicaSummary | null = null;

describe("hosted local Junction wearable fixture device-sync e2e", () => {
  beforeAll(async () => {
    plan = await buildJunctionWearableHostedReplayPlan();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: deviceSyncPublicBaseUrl,
        DEVICE_SYNC_SECRET: "synthetic-device-sync-runtime-secret",
        HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        JUNCTION_API_KEY: "synthetic-junction-api-key",
        JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-junction-client-user-id-secret",
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "oura,whoop_v2,garmin",
        JUNCTION_REGION: "us",
        JUNCTION_SUMMARY_RESOURCES: JUNCTION_WEARABLE_FIXTURE_SUMMARY_RESOURCES.join(","),
        JUNCTION_TIMESERIES_RESOURCES: JUNCTION_WEARABLE_FIXTURE_TIMESERIES_RESOURCES.join(","),
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-junction-wearable-",
      requiredRunnerEnvProfile: "device-sync",
      scenarioLabel: "Local hosted Junction wearable fixture e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it("uses sanitized replay data for Oura, WHOOP, and Garmin", () => {
    const replayPlan = requirePlan();

    expect(replayPlan.privacyScan.riskyContextValueCount).toBe(0);
    expect(replayPlan.privacyScan.riskyKeyValueCount).toBe(0);
    expect(replayPlan.privacyScan.riskyValuePatternCounts).toEqual({
      accessTokenKeyword: 0,
      bearerLike: 0,
      email: 0,
      homePath: 0,
      jwtLike: 0,
      uuidLike: 0,
      whsecLike: 0,
    });
    expect(replayPlan.privacyScan.scannedFiles ?? 0).toBeGreaterThan(0);
    expect(
      (replayPlan.privacyScan.includedJsonFiles ?? 0)
        + (replayPlan.privacyScan.includedJsonlRecords ?? 0),
    ).toBeGreaterThan(0);
    expect(replayPlan.privacyScan.pseudonymizedValues ?? 0).toBeGreaterThan(0);
    expect(replayPlan.privacyScan.shiftedDates ?? 0).toBeGreaterThan(0);
    expect(replayPlan.dirtyResources.length).toBeGreaterThan(0);
    expect(replayPlan.sources.map((source) => source.sourceProviderSlug).sort()).toEqual([
      "garmin",
      "oura",
      "whoop_v2",
    ]);
    expectGarminCoverageIsPopulated();
    expect(requireReplayResource("garmin", "summary", "activity").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("garmin", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("oura", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("oura", "timeseries", "heartrate").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("whoop_v2", "summary", "activity").recordCount).toBeGreaterThanOrEqual(5);
    expect(requireReplayResource("whoop_v2", "summary", "sleep").recordCount).toBeGreaterThanOrEqual(5);
  });

  it("imports the replay through hosted device-sync and publishes /biomarkers data", async () => {
    await expectJunctionWearableBiomarkerExpectationsToMatchProduction(
      JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS,
    );

    const replayPlan = requirePlan();
    const activeScenario = requireScenario();
    const seededAt = new Date().toISOString();

    await activeScenario.seedActiveHostedMember({ memberId: userId });
    await activeScenario.runWake(buildActivationWake(seededAt), userId);
    const activationStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 240_000,
    });
    if (activationStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted runner recorded an error during the Junction wearable fixture member activation.",
        `last error code: ${activationStatus.lastErrorCode}`,
      ]));
    }

    const seed = await activeScenario.seedJunctionDeviceSyncReplay({
      connectedAt: seededAt,
      dirtyAt: seededAt,
      dirtyResources: replayPlan.dirtyResources,
      displayName: replayPlan.connection.displayName,
      externalAccountId: replayPlan.connection.externalAccountId,
      memberId: userId,
      sources: replayPlan.sources,
    });

    expect(seed.dirtyResourceCount).toBe(replayPlan.dirtyResources.length);
    expect(seed.sourceCount).toBe(3);

    await activeScenario.runWake(buildJunctionFixtureWake(seed.connectionId, seededAt), userId);
    const deviceSyncStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    if (deviceSyncStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted runner recorded an error during the Junction wearable fixture import.",
        `last error code: ${deviceSyncStatus.lastErrorCode}`,
      ]));
    }

    await activeScenario.runWake(buildBrowserVaultRefreshWake(), userId);
    const finalStatus = await activeScenario.waitForHostedCompletion(userId, {
      timeoutMs: 240_000,
    });
    if (finalStatus.lastErrorCode ?? null) {
      throw new Error(await activeScenario.buildFailureMessage(userId, [
        "Hosted runner recorded an error during the Junction wearable fixture browser-vault refresh.",
        `last error code: ${finalStatus.lastErrorCode}`,
      ]));
    }

    const replicaRef = finalStatus.workspace?.browserVaultReplicaRef ?? null;
    expect(replicaRef).not.toBeNull();
    const replica = await readBrowserVaultReplica({
      replicaRef: requireReplicaRef(replicaRef),
      scenario: activeScenario,
      userId,
    });
    browserVaultSummary = summarizeJunctionWearableBrowserVaultReplica({
      generatedAt: replayPlan.generatedAt,
      replica,
    });

    for (const expectation of JUNCTION_WEARABLE_BROWSER_VAULT_METRIC_EXPECTATIONS) {
      await expectMetricRows({
        metricKey: expectation.metricKey,
        minimumRows: expectation.minimumRows,
        scenario: activeScenario,
        summary: browserVaultSummary,
        userId,
      });
    }
    expect(browserVaultSummary.metrics.selectedMetricKeys).toEqual(expect.arrayContaining(
      JUNCTION_WEARABLE_BROWSER_VAULT_METRIC_EXPECTATIONS.map(
        (expectation) => expectation.metricKey,
      ),
    ));
    for (const expectation of JUNCTION_WEARABLE_BROWSER_VAULT_BIOMARKER_EXPECTATIONS) {
      await expectBiomarkerPanel({
        biomarkerKey: expectation.biomarkerKey,
        metricKey: expectation.metricKey,
        minimumRows: expectation.minimumRows,
        scenario: activeScenario,
        summary: browserVaultSummary,
        userId,
      });
    }
    const ouraSourceHealth = requireSourceHealth("oura");
    const whoopSourceHealth = requireSourceHealth("whoop_v2");
    const garminSourceHealth = requireSourceHealth("garmin");

    expect(ouraSourceHealth.sleepNights).toBeGreaterThan(0);
    expect(
      whoopSourceHealth.activityDays
        + whoopSourceHealth.sleepNights
        + whoopSourceHealth.recoveryDays,
    ).toBeGreaterThan(0);
    expect(garminSourceHealth.activityDays).toBeGreaterThan(0);
    expect(garminSourceHealth.selectedMetrics).toBeGreaterThan(0);
    expect(garminSourceHealth.sleepNights).toBeGreaterThan(0);

    const failureStatus = extractHostedStatusFromFailureMessage(
      await activeScenario.buildFailureMessage(userId, [
        "Hosted status redaction direct proof.",
      ]),
    );
    expect(readBooleanAtPath(failureStatus, ["workspace", "browserVaultReplicaRefPresent"])).toBe(
      true,
    );
    expect(collectUnsafeHostedStatusFailureKeys(failureStatus)).toEqual([]);
  }, 540_000);
});

function buildActivationWake(occurredAt: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:junction-fixture:${userId}:${runId}`,
    memberChannels: {
      email: false,
      linq: false,
      telegram: false,
    },
    memberId: userId,
    occurredAt,
  });
}

function buildJunctionFixtureWake(connectionId: string, occurredAt: string) {
  return buildHostedExecutionDeviceSyncWake({
    connectionId,
    eventId: `device-sync:junction-fixture:${userId}:${connectionId}:${runId}`,
    hint: {
      eventType: "junction.fixture.replay",
      jobs: [],
      occurredAt,
      reason: "fixture-replay",
    },
    occurredAt,
    provider: "junction",
    reason: "webhook_hint",
    userId,
  });
}

function buildBrowserVaultRefreshWake() {
  const occurredAt = new Date().toISOString();
  return buildHostedExecutionRuntimeControlWake({
    eventId: `browser-vault-refresh:junction-fixture:${userId}:${runId}`,
    kind: "runtime.browser-vault-refresh-requested",
    occurredAt,
    userId,
  });
}

async function readBrowserVaultReplica(input: {
  replicaRef: HostedBrowserVaultReplicaRef;
  scenario: HostedLocalFullStackScenario;
  userId: string;
}): Promise<unknown> {
  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  const session = await input.scenario.harness.requestJson<{
    encryptedReplica: unknown;
    replicaKeyEnvelope: unknown;
    state: string;
  }>(
    `/internal/users/${encodeURIComponent(input.userId)}/browser-vault/session`,
    {
      body: JSON.stringify({
        browserPublicKeyJwk: publicKeyJwk,
        replicaRef: input.replicaRef,
      }),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );
  expect(session.state).toBe("ready");

  const replicaKey = await unwrapHostedBrowserSessionKey({
    envelope: parseHostedBrowserSessionKeyEnvelope(session.replicaKeyEnvelope),
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  const plaintext = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({
      dataKeyId: input.replicaRef.dataKeyEnvelope?.dataKeyId,
      dataKeyRootKeyId: input.replicaRef.dataKeyEnvelope?.rootKeyId,
      dataVersion: input.replicaRef.dataVersion,
      objectKey: input.replicaRef.objectKey,
      purpose: "browser-vault-replica",
      runtimeRootKeyId: input.replicaRef.runtimeRootKeyId,
      schema: "murph.browser-vault-replica",
      sourceBundleHash: input.replicaRef.sourceBundleHash,
      userId: input.userId,
    }),
    envelope: parseHostedCipherEnvelope(session.encryptedReplica),
    expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.replicaRef),
    key: replicaKey,
    scope: "browser-vault-replica",
  });

  return JSON.parse(textDecoder.decode(plaintext));
}

function requirePlan(): JunctionWearableHostedReplayPlan {
  if (!plan) {
    throw new Error("Junction wearable replay plan was not loaded.");
  }
  return plan;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local scenario was not started.");
  }
  return scenario;
}

function requireReplicaRef(
  ref: HostedBrowserVaultReplicaRef | null,
): HostedBrowserVaultReplicaRef {
  if (!ref) {
    throw new Error("Expected hosted browser-vault replica ref.");
  }
  return ref;
}

function requireProviderCoverage(provider: string) {
  const coverage = requirePlan().providerCoverage.find((entry) => entry.provider === provider);
  if (!coverage) {
    throw new Error(`Expected provider fixture coverage for ${provider}.`);
  }
  return coverage;
}

function expectGarminCoverageIsPopulated(): void {
  const coverage = requireProviderCoverage("garmin");

  expect(coverage.targetPresent).toBe(true);
  expect(coverage.dayCount).toBeGreaterThanOrEqual(7);
  expect(coverage.rawArtifactCount).toBeGreaterThan(0);
  expect(coverage.resources).toEqual(expect.arrayContaining([
    "junction-summary-activity",
    "junction-summary-sleep",
    "junction-summary-workouts",
  ]));
}

function requireReplayResource(
  provider: string,
  resourceCategory: "summary" | "timeseries",
  resource: string,
) {
  const summary = requirePlan().resources.find((entry) =>
    entry.provider === provider
    && entry.resourceCategory === resourceCategory
    && entry.resource === resource
  );
  if (!summary) {
    throw new Error(`Expected hosted replay resource ${provider}:${resourceCategory}:${resource}.`);
  }
  return summary;
}

async function expectMetricRows(input: {
  metricKey: string;
  minimumRows: number;
  scenario: HostedLocalFullStackScenario;
  summary: JunctionWearableBrowserVaultReplicaSummary;
  userId: string;
}): Promise<void> {
  const { metricKey, minimumRows, summary } = input;
  const rowCount = summary.metrics.metricRowsByKey[metricKey] ?? 0;
  if (rowCount >= minimumRows) {
    return;
  }

  throw new Error(await input.scenario.buildFailureMessage(input.userId, [
    `Expected at least ${minimumRows} browser-vault metric row(s) for ${metricKey}, found ${rowCount}.`,
    `browser-vault summary: ${JSON.stringify({
        metricRowsByKey: summary.metrics.metricRowsByKey,
        biomarkerPanels: summary.biomarkerPanels,
        selectedMetricKeys: summary.metrics.selectedMetricKeys,
        sourceHealth: summary.sourceHealth,
      })}`,
  ]));
}

async function expectBiomarkerPanel(input: {
  biomarkerKey: string;
  metricKey: string;
  minimumRows: number;
  scenario: HostedLocalFullStackScenario;
  summary: JunctionWearableBrowserVaultReplicaSummary;
  userId: string;
}): Promise<void> {
  const panel = input.summary.biomarkerPanels[input.biomarkerKey];
  const failures: string[] = [];

  if (!panel) {
    failures.push("panel missing");
  } else {
    if (panel.metricKey !== input.metricKey) {
      failures.push(`metricKey=${String(panel.metricKey)}`);
    }
    if (panel.status !== "ready") {
      failures.push(`status=${panel.status}`);
    }
    if (!panel.latestPresent) {
      failures.push("latest missing");
    }
    if (panel.sampleCount < input.minimumRows) {
      failures.push(`sampleCount=${panel.sampleCount}`);
    }
    if (panel.seriesCount < input.minimumRows) {
      failures.push(`seriesCount=${panel.seriesCount}`);
    }
  }

  if (failures.length === 0) {
    return;
  }

  throw new Error(await input.scenario.buildFailureMessage(input.userId, [
    [
      `Expected ready browser-vault biomarker panel for ${input.biomarkerKey}`,
      `bound to ${input.metricKey}`,
      `with at least ${input.minimumRows} rows;`,
      `failed: ${failures.join(", ")}.`,
    ].join(" "),
    `browser-vault summary: ${JSON.stringify({
        biomarkerPanels: input.summary.biomarkerPanels,
        metricRowsByKey: input.summary.metrics.metricRowsByKey,
        selectedMetricKeys: input.summary.metrics.selectedMetricKeys,
        sourceHealth: input.summary.sourceHealth,
      })}`,
  ]));
}

function requireSourceHealth(provider: string) {
  const sourceHealth = browserVaultSummary?.sourceHealth.find(
    (entry) => normalizeProviderSlug(entry.provider) === normalizeProviderSlug(provider),
  );
  if (!sourceHealth) {
    throw new Error(`Expected browser-vault source health for ${provider}.`);
  }
  return sourceHealth;
}

function normalizeProviderSlug(provider: string): string {
  return provider.replaceAll("_", "-");
}

function extractHostedStatusFromFailureMessage(message: string): unknown {
  const statusLine = message
    .split("\n")
    .find((line) => line.startsWith("hosted status: "));
  if (!statusLine) {
    throw new Error("Expected hosted failure message to include a hosted status line.");
  }

  return JSON.parse(statusLine.slice("hosted status: ".length));
}

function readBooleanAtPath(value: unknown, keys: readonly string[]): boolean | null {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "boolean" ? current : null;
}

function collectUnsafeHostedStatusFailureKeys(value: unknown): string[] {
  const unsafeKeys = new Set<string>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (!entry || typeof entry !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(entry)) {
      if (isUnsafeHostedStatusFailureKey(key)) {
        unsafeKeys.add(key);
      }
      visit(child);
    }
  };

  visit(value);
  return [...unsafeKeys].sort();
}

function isUnsafeHostedStatusFailureKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return normalized === "recentlogs"
    || normalized === "snapshotref"
    || normalized === "browservaultreplicaref"
    || normalized.endsWith("objectkey")
    || normalized.endsWith("keyenvelope")
    || normalized.endsWith("wrappedkey")
    || normalized.endsWith("keyjwk")
    || normalized.endsWith("keyid")
    || normalized.endsWith("rootkeyid")
    || normalized.endsWith("datakeyid")
    || normalized.includes("cipherenvelope");
}
