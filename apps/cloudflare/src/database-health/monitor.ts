import type { DurableObjectSqlStorageLike } from "../user-runner/types.js";
import {
  calculateDirectConnectionErrorDelta,
  DatabaseMetricsParseError,
  evaluateDatabaseMetricSnapshot,
  parsePlanetScaleDatabaseMetrics,
  type DatabaseHealthCondition,
  type DatabaseMetricSnapshot,
} from "./metrics.js";
import {
  DatabaseHealthStore,
  type DatabaseHealthAlertState,
  type DatabaseHealthStoredSample,
} from "./store.js";

const PLANETSCALE_API_ORIGIN = "https://api.planetscale.com";
const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const DATABASE_HEALTH_ALERT_INTERVAL_MS = 30 * 60 * 1_000;
const DATABASE_HEALTH_RUN_LEASE_MS = 2 * 60 * 1_000;
const DATABASE_HEALTH_SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DATABASE_HEALTH_FETCH_TIMEOUT_MS = 10_000;
const PLANETSCALE_DISCOVERY_BODY_LIMIT_BYTES = 256 * 1_024;
const PLANETSCALE_METRICS_BODY_LIMIT_BYTES = 2 * 1_024 * 1_024;
const LINQ_HEALTH_BODY_LIMIT_BYTES = 256 * 1_024;
const PLANETSCALE_DISCOVERY_TARGET_LIMIT = 64;
const PLANETSCALE_DISCOVERY_TARGET_LENGTH_LIMIT = 512;
const PLANETSCALE_METRICS_PATH_LENGTH_LIMIT = 2_048;
const PLANETSCALE_SIGNED_PARAMETER_LIMIT = 16;
const PLANETSCALE_SIGNED_PARAMETER_NAME_LIMIT = 64;
const PLANETSCALE_SIGNED_PARAMETER_VALUE_LIMIT = 2_048;
const PLANETSCALE_SCRAPE_URL_LENGTH_LIMIT = 8_192;
const MONITORING_FAILURE_ALERT_COUNT = 2;

const DATABASE_ALERT_OPENINGS = [
  "Murph database needs a look.",
  "Database health is outside the safe range.",
  "The production database is under pressure.",
  "Murph's database monitor found a live issue.",
  "Database connection health is degraded.",
  "The database is still reporting an unsafe condition.",
] as const;

export interface DatabaseHealthMonitorEnvironment {
  HOSTED_DATABASE_ALERT_LINQ_CHAT_ID?: string;
  HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID?: string;
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
}

export interface DatabaseHealthMonitorResult {
  conditions: DatabaseHealthCondition[];
  outcome:
    | "alert_deferred"
    | "alert_failed"
    | "alert_sent"
    | "healthy"
    | "run_in_progress";
  sampleStatus: "failed" | "ok" | null;
}

interface DatabaseHealthMonitorConfig {
  branchId: string;
  branchName: string;
  databaseName: string;
  linqApiBaseUrl: string;
  linqApiToken: string;
  linqChatIds: readonly string[];
  organization: string;
  planetScaleServiceToken: string;
  planetScaleServiceTokenId: string;
}

interface PlanetScaleDiscoveryGroup {
  labels: Readonly<Record<string, string>>;
  targets: readonly string[];
}

interface DatabaseHealthTransactionalStorage {
  sql?: DurableObjectSqlStorageLike;
  transactionSync?<T>(callback: () => T): T;
}

type DatabaseHealthCollectedSample =
  | {
    conditions: DatabaseHealthCondition[];
    directConnectionErrorDelta: number;
    snapshot: DatabaseMetricSnapshot;
    status: "ok";
  }
  | {
    conditions: DatabaseHealthCondition[];
    failureCode: DatabaseHealthFailureCode;
    failures: number;
    status: "failed";
  };

type DatabaseHealthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type DatabaseHealthFailureCode =
  | "metrics_parse_failed"
  | "metrics_scrape_failed"
  | "required_metrics_missing"
  | "service_discovery_failed"
  | "target_discovery_failed";

export class DatabaseHealthMonitor {
  private readonly config: DatabaseHealthMonitorConfig;
  private readonly store: DatabaseHealthStore;
  private readonly transactionSync: (callback: () => void) => void;

  constructor(
    storage: DatabaseHealthTransactionalStorage,
    environment: DatabaseHealthMonitorEnvironment,
    private readonly fetchImplementation: DatabaseHealthFetch = fetch,
    private readonly nowImplementation: () => number = Date.now,
  ) {
    this.config = readDatabaseHealthMonitorConfig(environment);
    const sql = storage.sql;
    const transactionSync = storage.transactionSync;
    if (!sql || !transactionSync) {
      throw new Error(
        "Database health monitor requires transactional SQLite storage.",
      );
    }
    this.store = new DatabaseHealthStore(sql);
    this.transactionSync = (callback) => {
      transactionSync.call(storage, callback);
    };
  }

  async runScheduledCheck(
    scheduledAtMs: number = Date.now(),
  ): Promise<DatabaseHealthMonitorResult> {
    const observedAtMs = normalizeObservedAtMs(scheduledAtMs);
    const runStartedAtMs = normalizeObservedAtMs(this.nowImplementation());
    if (
      !this.store.claimRun(runStartedAtMs, DATABASE_HEALTH_RUN_LEASE_MS)
    ) {
      return {
        conditions: [],
        outcome: "run_in_progress",
        sampleStatus: null,
      };
    }

    try {
      const sample = await this.collectSample();
      const checkedAtMs = normalizeObservedAtMs(this.nowImplementation());
      this.transactionSync(() => {
        this.persistSampleAndAlertAdmission({
          checkedAtMs,
          observedAtMs,
          sample,
        });
        this.store.pruneSamples(
          observedAtMs - DATABASE_HEALTH_SAMPLE_RETENTION_MS,
        );
      });
      return await this.handleAlertState({
        checkedAtMs,
        conditions: sample.conditions,
        sampleStatus: sample.status,
      });
    } finally {
      this.store.releaseRun();
    }
  }

  readRecentSamples(limit?: number): DatabaseHealthStoredSample[] {
    return this.store.readRecentSamples(limit);
  }

  readAlertState(): DatabaseHealthAlertState {
    return this.store.readAlertState();
  }

  private async collectSample(): Promise<DatabaseHealthCollectedSample> {
    try {
      const metricsBody = await fetchPlanetScaleMetrics({
        config: this.config,
        fetchImplementation: this.fetchImplementation,
      });
      const snapshot = parsePlanetScaleDatabaseMetrics(
        metricsBody,
        this.config.branchId,
      );
      const directConnectionErrorDelta =
        calculateDirectConnectionErrorDelta(
          snapshot.directConnectionErrorCounters,
          this.store.readLatestDirectConnectionErrorCounters(),
        );
      const conditions = evaluateDatabaseMetricSnapshot(
        snapshot,
        directConnectionErrorDelta,
      );
      return {
        conditions,
        directConnectionErrorDelta,
        snapshot,
        status: "ok",
      };
    } catch (error) {
      const failureCode = classifyDatabaseHealthFailure(error);
      const priorFailures =
        this.store.readAlertState().consecutiveScrapeFailures;
      const failures = priorFailures + 1;
      const conditions: DatabaseHealthCondition[] =
        failures >= MONITORING_FAILURE_ALERT_COUNT
          ? [{ failures, kind: "monitoring_unavailable" }]
          : [];
      console.warn("Database health metrics collection failed.", {
        failureCode,
        failures,
      });
      return {
        conditions,
        failureCode,
        failures,
        status: "failed",
      };
    }
  }

  private persistSampleAndAlertAdmission(input: {
    checkedAtMs: number;
    observedAtMs: number;
    sample: DatabaseHealthCollectedSample;
  }): void {
    const { sample } = input;
    if (sample.status === "ok") {
      this.store.setConsecutiveScrapeFailures(0);
    } else {
      this.store.setConsecutiveScrapeFailures(sample.failures);
    }

    let alertState = this.store.readAlertState();
    const currentDirectError = sample.conditions.find(
      (condition) =>
        condition.kind === "direct_migration_admission_failures",
    );
    const hasExistingPendingAlert =
      alertState.pendingAlertIdempotencyKey !== null
      && alertState.pendingAlertMessage !== null;
    if (currentDirectError && hasExistingPendingAlert) {
      alertState = this.store.deferDirectConnectionErrors({
        checkedAtMs: input.checkedAtMs,
        count: currentDirectError.count,
      });
    }

    const directErrorCountAvailableForAdmission =
      hasExistingPendingAlert
        ? 0
        : (
          alertState.deferredDirectErrorCount
          + (currentDirectError?.count ?? 0)
        );
    const isPromotingDeferredDirectError =
      !hasExistingPendingAlert
      && alertState.deferredDirectErrorCount > 0;
    if (
      sample.conditions.length > 0
      || directErrorCountAvailableForAdmission > 0
    ) {
      const isNewIncident = !alertState.incidentOpen;
      if (isNewIncident) {
        alertState = this.store.openIncident();
      }
      const conditionsWithDeferredDirectErrors =
        directErrorCountAvailableForAdmission > 0
          ? [
            ...sample.conditions.filter(
              (condition) =>
                condition.kind !== "direct_migration_admission_failures",
            ),
            {
              count: directErrorCountAvailableForAdmission,
              kind: "direct_migration_admission_failures" as const,
            },
          ]
          : sample.conditions;
      const hasDirectConnectionError =
        directErrorCountAvailableForAdmission > 0;
      const attemptFenceOpen =
        alertState.lastAlertAttemptedAtMs === null
        || (
          input.checkedAtMs - alertState.lastAlertAttemptedAtMs
          >= DATABASE_HEALTH_ALERT_INTERVAL_MS
        );
      const admittedConditions =
        (
          isPromotingDeferredDirectError
          || (
            !isNewIncident
            && !attemptFenceOpen
            && hasDirectConnectionError
          )
        )
          ? conditionsWithDeferredDirectErrors.filter(
            (condition) =>
              condition.kind === "direct_migration_admission_failures",
          )
          : conditionsWithDeferredDirectErrors;
      const admittedCheckedAtMs =
        admittedConditions.length === 1
        && admittedConditions[0]?.kind
          === "direct_migration_admission_failures"
        && currentDirectError === undefined
        && alertState.deferredDirectErrorCheckedAtMs !== null
          ? alertState.deferredDirectErrorCheckedAtMs
          : input.checkedAtMs;
      if (
        (
          !alertState.pendingAlertIdempotencyKey
          || !alertState.pendingAlertMessage
        )
        && (isNewIncident || hasDirectConnectionError || attemptFenceOpen)
      ) {
        const nextAlertSequence = alertState.alertSequence + 1;
        const pendingState = this.store.createPendingAlert({
          idempotencyKey: buildDatabaseAlertIdempotencyKey({
            alertSequence: nextAlertSequence,
            incidentSequence: alertState.incidentSequence,
          }),
          message: buildDatabaseAlertMessage({
            alertSequence: nextAlertSequence,
            checkedAtMs: admittedCheckedAtMs,
            conditions: admittedConditions,
            incidentSequence: alertState.incidentSequence,
          }),
        });
        if (
          !pendingState.pendingAlertIdempotencyKey
          || !pendingState.pendingAlertMessage
        ) {
          throw new Error("Database health pending alert was not persisted.");
        }
      }
    }

    if (sample.status === "ok") {
      this.store.recordSuccessfulSample({
        conditions: sample.conditions,
        directConnectionErrorDelta: sample.directConnectionErrorDelta,
        observedAtMs: input.observedAtMs,
        snapshot: sample.snapshot,
      });
    } else {
      this.store.recordFailedSample({
        conditions: sample.conditions,
        failureCode: sample.failureCode,
        observedAtMs: input.observedAtMs,
      });
    }
  }

  private async handleAlertState(input: {
    checkedAtMs: number;
    conditions: DatabaseHealthCondition[];
    sampleStatus: "failed" | "ok";
  }): Promise<DatabaseHealthMonitorResult> {
    let alertState = this.store.readAlertState();
    const hasPendingAlert =
      alertState.pendingAlertIdempotencyKey !== null
      && alertState.pendingAlertMessage !== null;
    if (
      input.conditions.length === 0
      && !hasPendingAlert
      && alertState.deferredDirectErrorCount === 0
    ) {
      if (
        input.sampleStatus === "ok"
        && alertState.incidentOpen
      ) {
        this.store.closeIncident();
      }
      return {
        conditions: [],
        outcome: "healthy",
        sampleStatus: input.sampleStatus,
      };
    }

    if (!alertState.incidentOpen) {
      alertState = this.store.openIncident();
    }
    const attemptedAtMs = normalizeObservedAtMs(this.nowImplementation());
    if (
      alertState.lastAlertAttemptedAtMs !== null
      && (
        attemptedAtMs - alertState.lastAlertAttemptedAtMs
        < DATABASE_HEALTH_ALERT_INTERVAL_MS
      )
    ) {
      return {
        conditions: input.conditions,
        outcome: "alert_deferred",
        sampleStatus: input.sampleStatus,
      };
    }

    let idempotencyKey = alertState.pendingAlertIdempotencyKey;
    let message = alertState.pendingAlertMessage;
    if (!idempotencyKey || !message) {
      return {
        conditions: input.conditions,
        outcome: "alert_deferred",
        sampleStatus: input.sampleStatus,
      };
    }

    this.store.recordAlertAttempt(attemptedAtMs);
    try {
      const results = await Promise.allSettled(
        this.config.linqChatIds.map((chatId, index) =>
          sendDatabaseHealthLinqAlert({
            apiBaseUrl: this.config.linqApiBaseUrl,
            apiToken: this.config.linqApiToken,
            chatId,
            fetchImplementation: this.fetchImplementation,
            idempotencyKey: buildDatabaseAlertRecipientIdempotencyKey(
              idempotencyKey,
              index,
            ),
            message,
          })
        ),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
      this.store.recordAlertSuccess();
      const stateAfterSuccess = this.store.readAlertState();
      if (
        input.sampleStatus === "ok"
        && input.conditions.length === 0
        && stateAfterSuccess.deferredDirectErrorCount === 0
      ) {
        this.store.closeIncident();
      }
      return {
        conditions: input.conditions,
        outcome: "alert_sent",
        sampleStatus: input.sampleStatus,
      };
    } catch (error) {
      console.warn("Database health Linq alert failed.", {
        failureCode: classifyLinqAlertFailure(error),
      });
      return {
        conditions: input.conditions,
        outcome: "alert_failed",
        sampleStatus: input.sampleStatus,
      };
    }
  }
}

async function fetchPlanetScaleMetrics(input: {
  config: DatabaseHealthMonitorConfig;
  fetchImplementation: DatabaseHealthFetch;
}): Promise<string> {
  const authorization =
    `${input.config.planetScaleServiceTokenId}:`
    + input.config.planetScaleServiceToken;
  const discoveryUrl = new URL(
    `/v1/organizations/${encodeURIComponent(input.config.organization)}/metrics`,
    PLANETSCALE_API_ORIGIN,
  );
  const discoveryResponse = await fetchWithTimeout(
    input.fetchImplementation,
    discoveryUrl,
    {
      headers: {
        authorization,
        accept: "application/json",
      },
      method: "GET",
      redirect: "error",
    },
  ).catch(() => {
    throw new DatabaseHealthFetchError("service_discovery_failed");
  });
  if (!discoveryResponse.ok) {
    throw new DatabaseHealthFetchError("service_discovery_failed");
  }
  const discoveryBody = await readBoundedResponseText(
    discoveryResponse,
    PLANETSCALE_DISCOVERY_BODY_LIMIT_BYTES,
  ).catch(() => {
    throw new DatabaseHealthFetchError("service_discovery_failed");
  });
  const groups = parsePlanetScaleDiscoveryGroups(discoveryBody);
  const metricsUrl = resolvePlanetScaleBranchMetricsUrl(
    groups,
    {
      branchName: input.config.branchName,
      databaseName: input.config.databaseName,
      organization: input.config.organization,
    },
  );

  const metricsResponse = await fetchWithTimeout(
    input.fetchImplementation,
    metricsUrl,
    {
      headers: {
        accept: "text/plain",
      },
      method: "GET",
      redirect: "error",
    },
  ).catch(() => {
    throw new DatabaseHealthFetchError("metrics_scrape_failed");
  });
  if (!metricsResponse.ok) {
    throw new DatabaseHealthFetchError("metrics_scrape_failed");
  }
  return await readBoundedResponseText(
    metricsResponse,
    PLANETSCALE_METRICS_BODY_LIMIT_BYTES,
  ).catch(() => {
    throw new DatabaseHealthFetchError("metrics_scrape_failed");
  });
}

function parsePlanetScaleDiscoveryGroups(
  body: string,
): PlanetScaleDiscoveryGroup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DatabaseHealthFetchError("service_discovery_failed");
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > PLANETSCALE_DISCOVERY_TARGET_LIMIT
  ) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }

  return parsed.map((candidate) => {
    if (!isObjectRecord(candidate)) {
      throw new DatabaseHealthFetchError("target_discovery_failed");
    }
    const labels = parseStringRecord(candidate.labels);
    const targets = candidate.targets;
    if (
      !Array.isArray(targets)
      || targets.length === 0
      || targets.length > PLANETSCALE_DISCOVERY_TARGET_LIMIT
      || !targets.every(
        (target): target is string =>
          typeof target === "string"
          && target.length > 0
          && target.length <= PLANETSCALE_DISCOVERY_TARGET_LENGTH_LIMIT,
      )
    ) {
      throw new DatabaseHealthFetchError("target_discovery_failed");
    }
    return { labels, targets };
  });
}

function resolvePlanetScaleBranchMetricsUrl(
  groups: readonly PlanetScaleDiscoveryGroup[],
  selector: {
    branchName: string;
    databaseName: string;
    organization: string;
  },
): URL {
  const matchingTargets = groups.flatMap((group) => {
    return (
      group.labels.planetscale_organization_name === selector.organization
      && group.labels.planetscale_database_name === selector.databaseName
      && group.labels.planetscale_branch_name === selector.branchName
    )
      ? group.targets.map((target) => ({ labels: group.labels, target }))
      : [];
  });
  if (matchingTargets.length !== 1) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }

  const match = matchingTargets[0];
  if (!match) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }
  const scheme = match.labels.__scheme__ ?? "https";
  const metricsPath = match.labels.__metrics_path__ ?? "/metrics";
  if (
    scheme !== "https"
    || !metricsPath.startsWith("/")
    || metricsPath.startsWith("//")
    || metricsPath.length > PLANETSCALE_METRICS_PATH_LENGTH_LIMIT
    || match.target.includes("/")
  ) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(`${scheme}://${match.target}${metricsPath}`);
  } catch {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }
  if (
    targetUrl.protocol !== "https:"
    || (targetUrl.port !== "" && targetUrl.port !== "443")
    || targetUrl.username !== ""
    || targetUrl.password !== ""
    || targetUrl.hostname === ""
    || targetUrl.search !== ""
    || targetUrl.hash !== ""
  ) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }

  const signedParameters = Object.entries(match.labels)
    .filter(([name]) => name.startsWith("__param_"));
  if (signedParameters.length > PLANETSCALE_SIGNED_PARAMETER_LIMIT) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }
  for (const [labelName, value] of signedParameters) {
    const parameterName = labelName.slice("__param_".length);
    if (
      parameterName.length === 0
      || parameterName.length > PLANETSCALE_SIGNED_PARAMETER_NAME_LIMIT
      || value.length > PLANETSCALE_SIGNED_PARAMETER_VALUE_LIMIT
    ) {
      throw new DatabaseHealthFetchError("target_discovery_failed");
    }
    targetUrl.searchParams.set(parameterName, value);
  }
  if (targetUrl.toString().length > PLANETSCALE_SCRAPE_URL_LENGTH_LIMIT) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }
  return targetUrl;
}

async function sendDatabaseHealthLinqAlert(input: {
  apiBaseUrl: string;
  apiToken: string;
  chatId: string;
  fetchImplementation: DatabaseHealthFetch;
  idempotencyKey: string;
  message: string;
}): Promise<void> {
  const authorization = `Bearer ${input.apiToken}`;
  const chatUrl = new URL(
    `chats/${encodeURIComponent(input.chatId)}`,
    ensureTrailingSlash(input.apiBaseUrl),
  );
  const phoneNumbersUrl = new URL(
    "phone_numbers",
    ensureTrailingSlash(input.apiBaseUrl),
  );
  const [chatResponse, phoneNumbersResponse] = await Promise.all([
    fetchWithTimeout(
      input.fetchImplementation,
      chatUrl,
      {
        headers: { authorization },
        method: "GET",
        redirect: "error",
      },
    ),
    fetchWithTimeout(
      input.fetchImplementation,
      phoneNumbersUrl,
      {
        headers: { authorization },
        method: "GET",
        redirect: "error",
      },
    ),
  ]).catch(() => {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  });
  if (!chatResponse.ok || !phoneNumbersResponse.ok) {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  }
  const [chatBody, phoneNumbersBody] = await Promise.all([
    readBoundedResponseText(chatResponse, LINQ_HEALTH_BODY_LIMIT_BYTES),
    readBoundedResponseText(
      phoneNumbersResponse,
      LINQ_HEALTH_BODY_LIMIT_BYTES,
    ),
  ]).catch(() => {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  });
  const destination = resolveHealthyLinqDestination({
    chatBody,
    phoneNumbersBody,
  });

  const url = new URL("messages", ensureTrailingSlash(input.apiBaseUrl));
  const response = await fetchWithTimeout(
    input.fetchImplementation,
    url,
    {
      body: JSON.stringify({
        message: {
          idempotency_key: input.idempotencyKey,
          parts: [
            {
              type: "text",
              value: input.message,
            },
          ],
        },
        to: [destination.recipient],
      }),
      headers: {
        authorization,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      method: "POST",
      redirect: "error",
    },
  );
  if (!response.ok) {
    throw new LinqDatabaseAlertError(
      response.status === 429 || response.status >= 500
        ? "linq_retryable_response"
        : "linq_rejected_response",
    );
  }
}

function buildDatabaseAlertMessage(input: {
  alertSequence: number;
  checkedAtMs: number;
  conditions: readonly DatabaseHealthCondition[];
  incidentSequence: number;
}): string {
  const openingIndex =
    (
      input.incidentSequence
      + input.alertSequence
      - 2
    ) % DATABASE_ALERT_OPENINGS.length;
  const opening =
    DATABASE_ALERT_OPENINGS[openingIndex]
    ?? DATABASE_ALERT_OPENINGS[0];
  const evidence = input.conditions.map(formatDatabaseHealthCondition).join("; ");
  const checkedAt = new Date(input.checkedAtMs).toISOString().slice(11, 16);
  return `${opening} ${evidence}. Checked ${checkedAt} UTC.`;
}

function resolveHealthyLinqDestination(input: {
  chatBody: string;
  phoneNumbersBody: string;
}): { recipient: string } {
  let chatValue: unknown;
  let phoneNumbersValue: unknown;
  try {
    chatValue = JSON.parse(input.chatBody);
    phoneNumbersValue = JSON.parse(input.phoneNumbersBody);
  } catch {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  }
  if (
    !isObjectRecord(chatValue)
    || chatValue.is_group !== false
    || !isObjectRecord(chatValue.health_status)
    || chatValue.health_status.status !== "HEALTHY"
    || !Array.isArray(chatValue.handles)
    || !isObjectRecord(phoneNumbersValue)
    || !Array.isArray(phoneNumbersValue.phone_numbers)
  ) {
    throw new LinqDatabaseAlertError("linq_health_suppressed");
  }

  const activeHandles = chatValue.handles.filter(
    (candidate): candidate is Record<string, unknown> =>
      isObjectRecord(candidate)
      && (candidate.status === undefined || candidate.status === "active"),
  );
  const senderHandles = activeHandles.filter(
    (candidate) => candidate.is_me === true,
  );
  const recipientHandles = activeHandles.filter(
    (candidate) => candidate.is_me === false,
  );
  if (senderHandles.length !== 1 || recipientHandles.length !== 1) {
    throw new LinqDatabaseAlertError("linq_health_suppressed");
  }
  const sender = senderHandles[0]?.handle;
  const recipient = recipientHandles[0]?.handle;
  if (!isE164PhoneNumber(sender) || !isE164PhoneNumber(recipient)) {
    throw new LinqDatabaseAlertError("linq_health_suppressed");
  }

  const currentLines = phoneNumbersValue.phone_numbers.filter(
    (candidate) =>
      isObjectRecord(candidate)
      && normalizeLinqPhoneNumber(candidate.phone_number) === sender,
  );
  const currentLine = currentLines[0];
  const reputation = isObjectRecord(currentLine?.reputation)
    ? currentLine.reputation
    : null;
  const reputationStatus =
    normalizeLinqHealthStatus(reputation?.status)
    ?? normalizeLinqHealthStatus(currentLine?.health_status);
  if (
    currentLines.length !== 1
    || !isObjectRecord(currentLine)
    || reputationStatus !== "HEALTHY"
  ) {
    throw new LinqDatabaseAlertError("linq_health_suppressed");
  }
  return { recipient };
}

function formatDatabaseHealthCondition(
  condition: DatabaseHealthCondition,
): string {
  switch (condition.kind) {
    case "client_wait":
      return `PgBouncer wait ${formatSeconds(condition.seconds)}`;
    case "server_pool_saturation":
      return `local server pool ${formatPercent(condition.ratio)} (${formatCount(
        condition.connections,
      )}/${formatCount(condition.limit)})`;
    case "postgres_connection_saturation":
      return `Postgres connections ${formatCount(
        condition.connections,
      )}/${formatCount(condition.limit)}`;
    case "postgres_aborted_connections":
      return `${formatCount(condition.count)} aborted Postgres ${
        condition.count === 1 ? "connection" : "connections"
      }`;
    case "postgres_disabled_connections":
      return `${formatCount(condition.count)} disabled Postgres ${
        condition.count === 1 ? "connection" : "connections"
      }`;
    case "postgres_idle_in_transaction":
      return `${formatCount(condition.count)} idle-in-transaction connections`;
    case "direct_migration_admission_failures":
      return `${formatCount(condition.count)} direct migration ${
        condition.count === 1 ? "connection error" : "connection errors"
      }`;
    case "monitoring_unavailable":
      return `PlanetScale metrics unavailable for ${formatCount(
        condition.failures,
      )} checks`;
  }
}

function buildDatabaseAlertIdempotencyKey(input: {
  alertSequence: number;
  incidentSequence: number;
}): string {
  return `murph-db-${input.incidentSequence}-${input.alertSequence}`;
}

function buildDatabaseAlertRecipientIdempotencyKey(
  alertIdempotencyKey: string,
  recipientIndex: number,
): string {
  return recipientIndex === 0
    ? alertIdempotencyKey
    : `${alertIdempotencyKey}-recipient-${recipientIndex + 1}`;
}

function readDatabaseHealthMonitorConfig(
  environment: DatabaseHealthMonitorEnvironment,
): DatabaseHealthMonitorConfig {
  const primaryLinqChatId = requireConfiguredString(
    environment.HOSTED_DATABASE_ALERT_LINQ_CHAT_ID,
    "HOSTED_DATABASE_ALERT_LINQ_CHAT_ID",
  );
  const secondaryLinqChatId = requireConfiguredString(
    environment.HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID,
    "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
  );
  if (secondaryLinqChatId === primaryLinqChatId) {
    throw new Error("Database health alert chat IDs must be distinct.");
  }
  return {
    branchId: requireConfiguredString(
      environment.HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID,
      "HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID",
    ),
    branchName: requireConfiguredString(
      environment.HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME,
      "HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME",
    ),
    databaseName: requireConfiguredString(
      environment.HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME,
      "HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME",
    ),
    linqApiBaseUrl: readLinqApiBaseUrl(environment.LINQ_API_BASE_URL),
    linqApiToken: requireConfiguredString(
      environment.LINQ_API_TOKEN,
      "LINQ_API_TOKEN",
    ),
    linqChatIds: [primaryLinqChatId, secondaryLinqChatId],
    organization: requireConfiguredString(
      environment.HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION,
      "HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION",
    ),
    planetScaleServiceToken: requireConfiguredString(
      environment.HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN,
      "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN",
    ),
    planetScaleServiceTokenId: requireConfiguredString(
      environment.HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID,
      "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID",
    ),
  };
}

function readLinqApiBaseUrl(value: string | undefined): string {
  const configured = value?.trim() || DEFAULT_LINQ_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("LINQ_API_BASE_URL is invalid.");
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error("LINQ_API_BASE_URL must be a credential-free HTTPS URL.");
  }
  return url.toString();
}

function requireConfiguredString(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

async function fetchWithTimeout(
  fetchImplementation: DatabaseHealthFetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  return await fetchImplementation(input, {
    ...init,
    signal: AbortSignal.timeout(DATABASE_HEALTH_FETCH_TIMEOUT_MS),
  });
}

async function readBoundedResponseText(
  response: Response,
  limitBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new Error("Response exceeded the database health body limit.");
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    bytesRead += chunk.value.byteLength;
    if (bytesRead > limitBytes) {
      await reader.cancel();
      throw new Error("Response exceeded the database health body limit.");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isObjectRecord(value)) {
    throw new DatabaseHealthFetchError("target_discovery_failed");
  }
  const entries: Array<[string, string]> = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== "string") {
      throw new DatabaseHealthFetchError("target_discovery_failed");
    }
    entries.push([key, candidate]);
  }
  return Object.fromEntries(entries);
}

function classifyDatabaseHealthFailure(
  error: unknown,
): DatabaseHealthFailureCode {
  if (
    error instanceof DatabaseHealthFetchError
    || error instanceof DatabaseMetricsParseError
  ) {
    return error.code;
  }
  return "metrics_scrape_failed";
}

function classifyLinqAlertFailure(error: unknown): string {
  return error instanceof LinqDatabaseAlertError
    ? error.code
    : "linq_transport_failed";
}

function normalizeObservedAtMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now();
  }
  return Math.trunc(value);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}

function formatCount(count: number): string {
  return String(Math.round(count));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isE164PhoneNumber(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}

function normalizeLinqPhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const compact = normalized.replace(/[\s().-]+/gu, "");
  const prefixed = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (/^\+[1-9]\d{6,14}$/u.test(prefixed)) {
    return prefixed;
  }
  return /^[1-9]\d{6,14}$/u.test(prefixed) ? `+${prefixed}` : null;
}

function normalizeLinqHealthStatus(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

class DatabaseHealthFetchError extends Error {
  constructor(readonly code: DatabaseHealthFailureCode) {
    super(code);
    this.name = "DatabaseHealthFetchError";
  }
}

class LinqDatabaseAlertError extends Error {
  constructor(
    readonly code:
      | "linq_health_suppressed"
      | "linq_health_unavailable"
      | "linq_rejected_response"
      | "linq_retryable_response",
  ) {
    super(code);
    this.name = "LinqDatabaseAlertError";
  }
}
