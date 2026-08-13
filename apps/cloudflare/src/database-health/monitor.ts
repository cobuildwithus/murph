import type { DurableObjectSqlStorageLike } from "../user-runner/types.js";
import {
  advanceConnectionErrorCounterBaseline,
  calculateConnectionErrorDeltas,
  DATABASE_HEALTH_REQUIRED_METRIC_NAMES,
  DatabaseMetricsParseError,
  evaluateDatabaseMetricSnapshot,
  hasExpectedConnectionErrorPorts,
  parsePlanetScaleDatabaseMetricObservation,
  requireCompleteDatabaseMetricSnapshot,
  type DatabaseConnectionErrorDeltas,
  type DatabaseHealthCondition,
  type DatabaseHealthRequiredMetricName,
  type DatabaseMetricObservation,
  type DatabaseMetricObservationSnapshot,
  type DatabaseMetricSnapshot,
} from "./metrics.js";
import {
  DatabaseHealthStore,
  type DatabaseHealthAlertState,
  type DatabaseHealthMonitoringAlertObligation,
  type DatabaseHealthMonitoringEvidence,
  type DatabaseHealthStoredSample,
} from "./store.js";

const PLANETSCALE_API_ORIGIN = "https://api.planetscale.com";
const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const DATABASE_HEALTH_ALERT_INTERVAL_MS = 60 * 60 * 1_000;
const DATABASE_HEALTH_RUN_LEASE_MS = 2 * 60 * 1_000;
const DATABASE_HEALTH_SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DATABASE_HEALTH_FETCH_TIMEOUT_MS = 10_000;
const DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS = 1_000;
const CONNECTION_ERROR_METRIC_NAME =
  "planetscale_edge_postgres_connection_errors_total" satisfies
    DatabaseHealthRequiredMetricName;
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
  "The database monitor recorded an alerting observation.",
  "A database health check met the paging criteria.",
  "The monitor captured database evidence outside safe bounds.",
  "A recorded database check satisfied an alert rule.",
  "The database health sample below warranted operator review.",
  "The monitor logged an unsafe database observation.",
  "A database check produced evidence that required attention.",
  "The recorded database sample triggered the health monitor.",
  "The monitor observed a database condition outside its safe range.",
  "A database safety check produced an alert.",
  "The included database observation met incident criteria.",
  "The monitor recorded database evidence for operator review.",
  "A database health sample was flagged by a configured rule.",
  "The check below produced alert-level database evidence.",
  "The monitor captured a database exception at check time.",
  "A recorded database observation fell outside normal bounds.",
  "The database check below warranted investigation.",
  "The monitor logged a database health exception.",
  "An observed database condition met the alert rule.",
  "The recorded check produced a database-health page.",
  "The monitor captured evidence that crossed a database guardrail.",
  "A database observation triggered operator paging.",
  "The included health check found an out-of-range database condition.",
  "The monitor recorded a database signal that warranted review.",
  "A database check met the configured alerting rule.",
  "The observation below triggered a database-health incident.",
  "The monitor logged database evidence outside the operating range.",
  "A recorded database condition crossed its safety rule.",
  "The database health check below was flagged for follow-up.",
  "The monitor captured an alert-worthy database observation.",
  "A database sample warranted operator attention.",
  "The recorded check found a database-health exception.",
  "The monitor logged an observation that activated a database alert.",
  "A database condition observed at check time crossed a guardrail.",
  "The included database sample met paging policy.",
  "The monitor recorded an out-of-bounds database check.",
  "A database health observation generated an operator page.",
  "The check below matched a database alert condition.",
  "The monitor captured a database-health rule violation.",
  "A recorded database signal qualified for incident review.",
  "The database observation below was flagged by the monitor.",
  "The monitor logged alert-level evidence from a database check.",
  "A database health rule was crossed in the recorded sample.",
  "The included check produced an actionable database observation.",
  "The monitor recorded a database condition that met alert criteria.",
  "A database observation was outside the configured safety bounds.",
  "The recorded health sample activated database paging.",
  "The monitor captured a database check that warranted review.",
  "A database alert rule matched the observation below.",
  "The included database evidence crossed an operating guardrail.",
  "The monitor logged an alert-triggering database sample.",
  "A database-health condition was observed at the recorded check.",
  "The recorded database check satisfied the paging rule.",
  "The monitor captured evidence for a database incident.",
  "A database sample was flagged outside its normal range.",
  "The included observation met database paging criteria.",
  "The monitor recorded an exception in the database health check.",
  "A database condition at check time triggered the alert path.",
  "The recorded sample produced an evidence-backed database page.",
  "The monitor logged a database observation for operator triage.",
  "A database-health guardrail was crossed in the included check.",
  "The observation below matched an unsafe database rule.",
  "The monitor captured an alert event from the database check.",
  "A recorded database sample met the monitor's alert criteria.",
  "The included health evidence triggered database paging.",
  "The monitor logged a database condition beyond a configured bound.",
  "A database check was flagged by the health monitor.",
  "The recorded observation crossed a database alert boundary.",
  "The monitor captured an out-of-range database sample.",
  "A database-health exception was recorded at check time.",
  "The included check met the database incident rule.",
  "The monitor logged evidence for an operator database review.",
  "A recorded database condition activated the paging path.",
  "The database sample below crossed a configured guardrail.",
  "The monitor captured an observation that met alert policy.",
  "A database health check was recorded outside safe bounds.",
  "The included database condition triggered an incident page.",
  "The monitor logged a database sample that required review.",
  "A database observation matched the configured alert rule.",
  "The recorded check crossed a database safety boundary.",
  "The monitor captured alerting evidence from the database.",
  "A database health sample was flagged for operator attention.",
  "The included observation produced a database alert.",
  "The monitor logged a database exception against its guardrails.",
  "A recorded database condition warranted investigation.",
  "The database check below matched paging criteria.",
  "The monitor captured an unsafe observation at check time.",
  "A database-health rule flagged the recorded sample.",
  "The included evidence satisfied a database paging rule.",
  "The monitor logged a condition outside database safety bounds.",
  "A database observation at check time triggered paging.",
  "The recorded health check produced a database incident signal.",
  "The monitor captured a database sample beyond its alert boundary.",
  "A database condition in the included check warranted review.",
  "The recorded observation matched a database-health exception.",
  "The monitor logged an alert-triggering database check.",
  "A database health sample activated the paging rule.",
  "The included database evidence was flagged by the monitor.",
  "The monitor captured a database observation for operator review.",
  "A recorded database check met the incident criteria.",
] as const;

const DATABASE_METRIC_ALERT_LABELS: Readonly<
  Record<DatabaseHealthRequiredMetricName, string>
> = {
  planetscale_edge_postgres_connection_errors_total:
    "connection errors on ports 5432 and 6432",
  planetscale_pgbouncer_current_connections:
    "PgBouncer current connections",
  planetscale_pgbouncer_pools_client: "PgBouncer client pools",
  planetscale_pgbouncer_pools_client_maxwait_seconds:
    "PgBouncer client wait",
  planetscale_pgbouncer_pools_server: "PgBouncer server pools",
  planetscale_postgres_connection_state: "Postgres connection states",
  planetscale_postgres_settings_max_connections:
    "Postgres max connections",
};

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

interface ResolvedDatabaseHealthLinqDestination {
  recipient: string;
  sendable: boolean;
}

interface DatabaseHealthTransactionalStorage {
  sql?: DurableObjectSqlStorageLike;
  transactionSync?<T>(callback: () => T): T;
}

type DatabaseHealthCollectedSample =
  | {
    connectionErrorCounterBaseline: Record<string, number>;
    connectionErrorDelta: number;
    conditions: DatabaseHealthCondition[];
    snapshot: DatabaseMetricSnapshot;
    status: "ok";
  }
  | {
    connectionErrorCounterBaseline: Record<string, number>;
    connectionErrorDelta: number | null;
    conditions: DatabaseHealthCondition[];
    failureCode: DatabaseHealthFailureCode;
    failures: number;
    monitoringEvidence: DatabaseHealthMonitoringEvidence;
    snapshot: DatabaseMetricObservationSnapshot | null;
    status: "failed";
  };

type DatabaseConnectionErrorCondition = Extract<
  DatabaseHealthCondition,
  {
    kind:
      | "direct_migration_admission_failures"
      | "pooled_application_connection_errors";
  }
>;

type DatabaseHealthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type DatabaseHealthWait = (delayMs: number) => Promise<void>;

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
    private readonly waitImplementation: DatabaseHealthWait =
      waitForDatabaseHealthRetry,
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
    const previousConnectionErrorCounterBaseline =
      this.store.readLatestConnectionErrorCounterBaseline();
    try {
      const observation = await this.collectMetricObservation(
        previousConnectionErrorCounterBaseline,
      );
      const observedConnectionErrorCounters =
        observation.snapshot.connectionErrorCounters;
      const connectionErrorCounterBaseline = observedConnectionErrorCounters
        ? advanceConnectionErrorCounterBaseline(
          observedConnectionErrorCounters,
          previousConnectionErrorCounterBaseline,
        )
        : (previousConnectionErrorCounterBaseline ?? {});
      if (observation.missingMetrics.length > 0) {
        const connectionErrorDeltas =
          observedConnectionErrorCounters === null
            ? null
            : calculateConnectionErrorDeltas(
              observedConnectionErrorCounters,
              previousConnectionErrorCounterBaseline,
            );
        const conditions = evaluateDatabaseMetricSnapshot(
          observation.snapshot,
          connectionErrorDeltas,
        );
        const priorFailures =
          this.store.readAlertState().consecutiveScrapeFailures;
        const failures = priorFailures + 1;
        if (failures >= MONITORING_FAILURE_ALERT_COUNT) {
          conditions.push({
            failures,
            kind: "monitoring_unavailable",
            missingMetrics: observation.missingMetrics,
          });
        }
        console.warn("Database health metrics collection failed.", {
          failureCode: "required_metrics_missing",
          failures,
          missingMetrics: observation.missingMetrics,
        });
        return {
          connectionErrorCounterBaseline,
          connectionErrorDelta:
            sumKnownConnectionErrorDeltas(connectionErrorDeltas),
          conditions,
          failureCode: "required_metrics_missing",
          failures,
          monitoringEvidence: {
            availability: "incomplete",
            missingMetrics: observation.missingMetrics,
          },
          snapshot: observation.snapshot,
          status: "failed",
        };
      }
      const snapshot = requireCompleteDatabaseMetricSnapshot(observation);
      const connectionErrorDeltas = calculateConnectionErrorDeltas(
        snapshot.connectionErrorCounters,
        previousConnectionErrorCounterBaseline,
      );
      const conditions = evaluateDatabaseMetricSnapshot(
        snapshot,
        connectionErrorDeltas,
      );
      const connectionErrorDelta = sumKnownConnectionErrorDeltas(
        connectionErrorDeltas,
      );
      if (connectionErrorDelta === null) {
        throw new Error(
          "Complete database metrics are missing connection-error deltas.",
        );
      }
      return {
        connectionErrorCounterBaseline,
        connectionErrorDelta,
        conditions,
        snapshot,
        status: "ok",
      };
    } catch (error) {
      const failureCode = classifyDatabaseHealthFailure(error);
      const missingMetrics = error instanceof DatabaseMetricsParseError
        ? error.missingMetrics
        : [];
      const priorFailures =
        this.store.readAlertState().consecutiveScrapeFailures;
      const failures = priorFailures + 1;
      const conditions: DatabaseHealthCondition[] =
        failures >= MONITORING_FAILURE_ALERT_COUNT
          ? [{ failures, kind: "monitoring_unavailable", missingMetrics }]
          : [];
      console.warn("Database health metrics collection failed.", {
        attempts: 2,
        failureCode,
        failures,
        missingMetrics,
      });
      return {
        connectionErrorCounterBaseline:
          previousConnectionErrorCounterBaseline ?? {},
        connectionErrorDelta: null,
        conditions,
        failureCode,
        failures,
        monitoringEvidence: {
          availability: "unavailable",
          missingMetrics: [],
        },
        snapshot: null,
        status: "failed",
      };
    }
  }

  private async collectMetricObservation(
    previousConnectionErrorCounterBaseline:
      Readonly<Record<string, number>> | null,
  ): Promise<DatabaseMetricObservation> {
    let observation: DatabaseMetricObservation;
    try {
      observation = await this.collectMetricObservationOnce();
    } catch {
      await this.waitImplementation(DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS);
      return await this.collectMetricObservationOnce();
    }
    if (!hasUsableDatabaseHealthMetric(observation)) {
      await this.waitImplementation(DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS);
      return await this.collectMetricObservationOnce();
    }
    const observationConnectionErrorDeltas =
      observation.snapshot.connectionErrorCounters === null
        ? null
        : calculateConnectionErrorDeltas(
          observation.snapshot.connectionErrorCounters,
          previousConnectionErrorCounterBaseline,
        );
    if (
      !shouldConfirmMissingConnectionErrors(
        observation,
        observationConnectionErrorDeltas,
      )
    ) {
      return observation;
    }

    await this.waitImplementation(DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS);
    try {
      const confirmation = await this.collectMetricObservationOnce();
      const confirmedObservation = composeConnectionErrorConfirmation(
        observation,
        confirmation,
      );
      const confirmedCounters =
        confirmedObservation.snapshot.connectionErrorCounters;
      if (
        evaluateDatabaseMetricSnapshot(
          confirmedObservation.snapshot,
          null,
        ).length > 0
      ) {
        return confirmedObservation;
      }
      if (
        confirmedCounters !== null
        && hasExpectedConnectionErrorPorts(confirmedCounters)
      ) {
        if (confirmedObservation.missingMetrics.length === 0) {
          return confirmedObservation;
        }
        return {
          missingMetrics: observation.missingMetrics.filter(
            (name) => name !== CONNECTION_ERROR_METRIC_NAME,
          ),
          snapshot: {
            ...observation.snapshot,
            connectionErrorCounters: confirmedCounters,
          },
        };
      }
      const confirmedConnectionErrorDeltas = confirmedCounters === null
        ? null
        : calculateConnectionErrorDeltas(
          confirmedCounters,
          previousConnectionErrorCounterBaseline,
        );
      return evaluateDatabaseMetricSnapshot(
        confirmedObservation.snapshot,
        confirmedConnectionErrorDeltas,
      ).length > 0
        ? confirmedObservation
        : observation;
    } catch {
      return observation;
    }
  }

  private async collectMetricObservationOnce(): Promise<
    DatabaseMetricObservation
  > {
    const metricsBody = await fetchPlanetScaleMetrics({
      config: this.config,
      fetchImplementation: this.fetchImplementation,
    });
    return parsePlanetScaleDatabaseMetricObservation(
      metricsBody,
      this.config.branchId,
    );
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

    const currentMonitoringCondition = sample.conditions.find(
      (condition) => condition.kind === "monitoring_unavailable",
    );
    if (
      sample.status === "failed"
      && sample.failures === MONITORING_FAILURE_ALERT_COUNT
      && currentMonitoringCondition
    ) {
      const priorEvidence = this.store.readLatestMonitoringEvidence();
      if (priorEvidence === null) {
        throw new Error(
          "Database monitoring threshold is missing prior evidence.",
        );
      }
      const monitoringAlertObligation = buildMonitoringAlertObligation({
        checkedAtMs: input.checkedAtMs,
        failures: currentMonitoringCondition.failures,
        observations: [priorEvidence, sample.monitoringEvidence],
      });
      Object.assign(currentMonitoringCondition, {
        incompleteChecks: monitoringAlertObligation.incompleteChecks,
        missingMetrics: monitoringAlertObligation.missingMetrics,
        unavailableChecks: monitoringAlertObligation.unavailableChecks,
      });
      this.store.recordMonitoringAlertObligation(monitoringAlertObligation);
    }

    let alertState = this.store.readAlertState();
    const currentConnectionErrors = sample.conditions.filter(
      isConnectionErrorCondition,
    );
    const currentConnectionErrorCounts = summarizeConnectionErrorConditions(
      currentConnectionErrors,
    );
    const hasExistingPendingAlert =
      alertState.pendingAlertIdempotencyKey !== null
      && alertState.pendingAlertMessage !== null;
    if (currentConnectionErrors.length > 0 && hasExistingPendingAlert) {
      alertState = this.store.deferConnectionErrors({
        checkedAtMs: input.checkedAtMs,
        directCount: currentConnectionErrorCounts.direct,
        pooledCount: currentConnectionErrorCounts.pooled,
      });
    }

    const connectionErrorsAvailableForAdmission = hasExistingPendingAlert
      ? []
      : buildConnectionErrorConditions({
        directCount:
          alertState.deferredDirectErrorCount
          + currentConnectionErrorCounts.direct,
        pooledCount:
          alertState.deferredPooledErrorCount
          + currentConnectionErrorCounts.pooled,
      });
    const isPromotingDeferredConnectionErrors =
      !hasExistingPendingAlert
      && hasDeferredConnectionErrors(alertState);
    if (
      sample.conditions.length > 0
      || connectionErrorsAvailableForAdmission.length > 0
      || alertState.monitoringAlertObligation !== null
    ) {
      const isNewIncident = !alertState.incidentOpen;
      if (isNewIncident) {
        alertState = this.store.openIncident();
      }
      const monitoringAlertObligation =
        alertState.monitoringAlertObligation;
      const monitoringConditionForAdmission = monitoringAlertObligation
        ? {
          failures: monitoringAlertObligation.failures,
          incompleteChecks: monitoringAlertObligation.incompleteChecks,
          kind: "monitoring_unavailable" as const,
          missingMetrics: monitoringAlertObligation.missingMetrics,
          unavailableChecks: monitoringAlertObligation.unavailableChecks,
        }
        : null;
      const currentReplayableConditions = sample.conditions.filter(
        (condition) =>
          !isConnectionErrorCondition(condition)
          && condition.kind !== "monitoring_unavailable",
      );
      const conditionsWithDeferredConnectionErrors = [
        ...currentReplayableConditions,
        ...(monitoringConditionForAdmission
          ? [monitoringConditionForAdmission]
          : []),
        ...connectionErrorsAvailableForAdmission,
      ];
      const hasConnectionError =
        connectionErrorsAvailableForAdmission.length > 0;
      const attemptFenceOpen =
        alertState.lastAlertAttemptedAtMs === null
        || (
          input.checkedAtMs - alertState.lastAlertAttemptedAtMs
          >= DATABASE_HEALTH_ALERT_INTERVAL_MS
        );
      const admittedConditions =
        (
          isPromotingDeferredConnectionErrors
          || (
            alertState.alertSequence > 0
            && !attemptFenceOpen
            && hasConnectionError
          )
        )
          ? conditionsWithDeferredConnectionErrors.filter(
            (condition) =>
              isConnectionErrorCondition(condition)
              || condition.kind === "monitoring_unavailable",
          )
          : conditionsWithDeferredConnectionErrors;
      const shouldHoldMonitoringForFence =
        monitoringAlertObligation !== null
        && !attemptFenceOpen
        && !hasConnectionError
        && (
          alertState.alertSequence > 0
          || currentReplayableConditions.length === 0
        );
      const deferredCheckedAtMs = latestDeferredConnectionErrorCheckedAtMs(
        alertState,
        admittedConditions,
      );
      const admittedCheckedAtMs =
        isPromotingDeferredConnectionErrors
        && admittedConditions.some(isConnectionErrorCondition)
        && currentConnectionErrors.length === 0
        && deferredCheckedAtMs !== null
          ? deferredCheckedAtMs
          : admittedConditions.length === 1
            && admittedConditions[0]?.kind === "monitoring_unavailable"
            && monitoringAlertObligation
              ? monitoringAlertObligation.checkedAtMs
              : input.checkedAtMs;
      if (
        (
          !alertState.pendingAlertIdempotencyKey
          || !alertState.pendingAlertMessage
        )
        && admittedConditions.length > 0
        && !shouldHoldMonitoringForFence
        && (
          isNewIncident
          || hasConnectionError
          || attemptFenceOpen
          || monitoringAlertObligation !== null
        )
      ) {
        const nextAlertSequence = alertState.alertSequence + 1;
        const pendingState = this.store.createPendingAlert({
          idempotencyKey: buildDatabaseAlertIdempotencyKey({
            alertSequence: nextAlertSequence,
            incidentSequence: alertState.incidentSequence,
          }),
          includesMonitoring: admittedConditions.some(
            (condition) => condition.kind === "monitoring_unavailable",
          ),
          message: buildDatabaseAlertMessage({
            alertSequence: nextAlertSequence,
            checkedAtMs: admittedCheckedAtMs,
            conditions: admittedConditions,
            incidentSequence: alertState.incidentSequence,
            monitoringCheckedAtMs:
              monitoringAlertObligation?.checkedAtMs ?? null,
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
        connectionErrorCounterBaseline:
          sample.connectionErrorCounterBaseline,
        connectionErrorDelta: sample.connectionErrorDelta,
        conditions: sample.conditions,
        observedAtMs: input.observedAtMs,
        snapshot: sample.snapshot,
      });
    } else {
      this.store.recordFailedSample({
        connectionErrorCounterBaseline:
          sample.connectionErrorCounterBaseline,
        connectionErrorDelta: sample.connectionErrorDelta,
        conditions: sample.conditions,
        failureCode: sample.failureCode,
        monitoringEvidence: sample.monitoringEvidence,
        observedAtMs: input.observedAtMs,
        snapshot: sample.snapshot,
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
      && alertState.deferredPooledErrorCount === 0
      && alertState.monitoringAlertObligation === null
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
      const destinationResults = await Promise.allSettled(
        this.config.linqChatIds.map((chatId) =>
          resolveDatabaseHealthLinqDestination({
            apiBaseUrl: this.config.linqApiBaseUrl,
            apiToken: this.config.linqApiToken,
            chatId,
            fetchImplementation: this.fetchImplementation,
          })
        ),
      );
      const primaryResult = destinationResults[0];
      const secondaryResult = destinationResults[1];
      if (!primaryResult || !secondaryResult) {
        throw new Error(
          "Database health monitor requires two Linq destinations.",
        );
      }
      const failures: unknown[] = [];
      const destinations: Array<{
        idempotencyKey: string;
        recipient: string;
      }> = [];
      if (primaryResult.status === "rejected") {
        failures.push(primaryResult.reason);
      } else {
        if (primaryResult.value.sendable) {
          destinations.push({
            idempotencyKey,
            recipient: primaryResult.value.recipient,
          });
        } else {
          failures.push(
            new LinqDatabaseAlertError("linq_health_suppressed"),
          );
        }
      }
      if (secondaryResult.status === "rejected") {
        failures.push(secondaryResult.reason);
      } else if (primaryResult.status === "fulfilled") {
        if (
          secondaryResult.value.recipient
          === primaryResult.value.recipient
        ) {
          failures.push(
            new LinqDatabaseAlertError("linq_duplicate_recipient"),
          );
        } else if (!secondaryResult.value.sendable) {
          failures.push(
            new LinqDatabaseAlertError("linq_health_suppressed"),
          );
        } else {
          destinations.push({
            idempotencyKey: `${idempotencyKey}-recipient-2`,
            recipient: secondaryResult.value.recipient,
          });
        }
      }
      const sendResults = await Promise.allSettled(
        destinations.map((destination) =>
          sendDatabaseHealthLinqAlert({
            apiBaseUrl: this.config.linqApiBaseUrl,
            apiToken: this.config.linqApiToken,
            fetchImplementation: this.fetchImplementation,
            idempotencyKey: destination.idempotencyKey,
            message,
            recipient: destination.recipient,
          })
        ),
      );
      for (const result of sendResults) {
        if (result.status === "rejected") {
          failures.push(result.reason);
        }
      }
      const failure = failures[0];
      if (failure !== undefined) {
        throw failure;
      }
      this.store.recordAlertSuccess();
      const stateAfterSuccess = this.store.readAlertState();
      if (
        input.sampleStatus === "ok"
        && input.conditions.length === 0
        && stateAfterSuccess.deferredDirectErrorCount === 0
        && stateAfterSuccess.deferredPooledErrorCount === 0
        && stateAfterSuccess.monitoringAlertObligation === null
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

function isConnectionErrorCondition(
  condition: DatabaseHealthCondition,
): condition is DatabaseConnectionErrorCondition {
  return condition.kind === "direct_migration_admission_failures"
    || condition.kind === "pooled_application_connection_errors";
}

function summarizeConnectionErrorConditions(
  conditions: readonly DatabaseConnectionErrorCondition[],
): { direct: number; pooled: number } {
  return conditions.reduce(
    (counts, condition) => {
      if (condition.kind === "direct_migration_admission_failures") {
        counts.direct += condition.count;
      } else {
        counts.pooled += condition.count;
      }
      return counts;
    },
    { direct: 0, pooled: 0 },
  );
}

function buildConnectionErrorConditions(input: {
  directCount: number;
  pooledCount: number;
}): DatabaseConnectionErrorCondition[] {
  return [
    ...(input.directCount > 0
      ? [{
        count: input.directCount,
        kind: "direct_migration_admission_failures" as const,
      }]
      : []),
    ...(input.pooledCount > 0
      ? [{
        count: input.pooledCount,
        kind: "pooled_application_connection_errors" as const,
      }]
      : []),
  ];
}

function hasDeferredConnectionErrors(
  state: DatabaseHealthAlertState,
): boolean {
  return state.deferredDirectErrorCount > 0
    || state.deferredPooledErrorCount > 0;
}

function latestDeferredConnectionErrorCheckedAtMs(
  state: DatabaseHealthAlertState,
  conditions: readonly DatabaseHealthCondition[],
): number | null {
  const checkedAtValues = [
    conditions.some(
      (condition) =>
        condition.kind === "direct_migration_admission_failures",
    )
      && state.deferredDirectErrorCount > 0
      ? state.deferredDirectErrorCheckedAtMs
      : null,
    conditions.some(
      (condition) => condition.kind === "pooled_application_connection_errors",
    )
      && state.deferredPooledErrorCount > 0
      ? state.deferredPooledErrorCheckedAtMs
      : null,
  ].filter((value): value is number => value !== null);
  return checkedAtValues.length === 0
    ? null
    : Math.max(...checkedAtValues);
}

function sumKnownConnectionErrorDeltas(
  deltas: DatabaseConnectionErrorDeltas | null,
): number | null {
  if (deltas === null) {
    return null;
  }
  const knownDeltas = Object.values(deltas).filter(
    (value): value is number => value !== null,
  );
  return knownDeltas.length === 0
    ? null
    : Math.trunc(knownDeltas.reduce((total, value) => total + value, 0));
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

async function resolveDatabaseHealthLinqDestination(input: {
  apiBaseUrl: string;
  apiToken: string;
  chatId: string;
  fetchImplementation: DatabaseHealthFetch;
}): Promise<ResolvedDatabaseHealthLinqDestination> {
  const authorization = `Bearer ${input.apiToken}`;
  const chatUrl = new URL(
    `chats/${encodeURIComponent(input.chatId)}`,
    ensureTrailingSlash(input.apiBaseUrl),
  );
  const phoneNumbersUrl = new URL(
    "phone_numbers",
    ensureTrailingSlash(input.apiBaseUrl),
  );
  const [chatResponseResult, phoneNumbersResponseResult] =
    await Promise.allSettled([
      fetchWithTimeout(
        input.fetchImplementation,
        chatUrl,
        {
          headers: { authorization },
          method: "GET",
        },
      ),
      fetchWithTimeout(
        input.fetchImplementation,
        phoneNumbersUrl,
        {
          headers: { authorization },
          method: "GET",
        },
      ),
    ]);
  if (
    chatResponseResult.status === "rejected"
    || !chatResponseResult.value.ok
  ) {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  }
  const chatBody = await readBoundedResponseText(
    chatResponseResult.value,
    LINQ_HEALTH_BODY_LIMIT_BYTES,
  ).catch(() => {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  });
  const chatIdentity = resolveLinqDirectChatIdentity(chatBody);
  if (
    phoneNumbersResponseResult.status === "rejected"
    || !phoneNumbersResponseResult.value.ok
  ) {
    return {
      recipient: chatIdentity.recipient,
      sendable: false,
    };
  }
  const phoneNumbersBody = await readBoundedResponseText(
    phoneNumbersResponseResult.value,
    LINQ_HEALTH_BODY_LIMIT_BYTES,
  ).catch(() => null);
  return {
    recipient: chatIdentity.recipient,
    sendable:
      chatIdentity.chatHealthy
      && phoneNumbersBody !== null
      && hasHealthyLinqSenderLine({
        phoneNumbersBody,
        sender: chatIdentity.sender,
      }),
  };
}

async function sendDatabaseHealthLinqAlert(input: {
  apiBaseUrl: string;
  apiToken: string;
  fetchImplementation: DatabaseHealthFetch;
  idempotencyKey: string;
  message: string;
  recipient: string;
}): Promise<void> {
  const authorization = `Bearer ${input.apiToken}`;
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
        to: [input.recipient],
      }),
      headers: {
        authorization,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      method: "POST",
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
  monitoringCheckedAtMs: number | null;
}): string {
  const checkedAt = new Date(input.checkedAtMs).toISOString().slice(11, 16);
  if (
    input.conditions.length > 0
    && input.conditions.every(
      (condition) => condition.kind === "monitoring_unavailable",
    )
  ) {
    const evidence = input.conditions
      .map((condition) => formatDatabaseHealthCondition(
        condition,
        input.checkedAtMs,
        input.monitoringCheckedAtMs,
      ))
      .join("; ");
    return `${evidence}. Window ended ${checkedAt} UTC.`;
  }
  // Both steps are coprime to the 100-item bank, so one incident traverses
  // every reviewed opening before repeating while retries remain reproducible.
  const openingIndex = normalizeModulo(
    input.incidentSequence * 37 + input.alertSequence * 17,
    DATABASE_ALERT_OPENINGS.length,
  );
  const opening =
    DATABASE_ALERT_OPENINGS[openingIndex]
    ?? DATABASE_ALERT_OPENINGS[0];
  const evidence = input.conditions.map((condition) =>
    formatDatabaseHealthCondition(
      condition,
      input.checkedAtMs,
      input.monitoringCheckedAtMs,
    )
  ).join("; ");
  return `${opening} ${evidence}. Checked ${checkedAt} UTC.`;
}

function normalizeModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function resolveLinqDirectChatIdentity(
  chatBody: string,
): {
  chatHealthy: boolean;
  recipient: string;
  sender: string;
} {
  let chatValue: unknown;
  try {
    chatValue = JSON.parse(chatBody);
  } catch {
    throw new LinqDatabaseAlertError("linq_health_unavailable");
  }
  if (
    !isObjectRecord(chatValue)
    || chatValue.is_group !== false
    || !Array.isArray(chatValue.handles)
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
  const chatHealthStatus = isObjectRecord(chatValue.health_status)
    ? normalizeLinqHealthStatus(chatValue.health_status.status)
    : null;
  return {
    chatHealthy: chatHealthStatus === "HEALTHY",
    recipient,
    sender,
  };
}

function hasHealthyLinqSenderLine(input: {
  phoneNumbersBody: string;
  sender: string;
}): boolean {
  let phoneNumbersValue: unknown;
  try {
    phoneNumbersValue = JSON.parse(input.phoneNumbersBody);
  } catch {
    return false;
  }
  if (
    !isObjectRecord(phoneNumbersValue)
    || !Array.isArray(phoneNumbersValue.phone_numbers)
  ) {
    return false;
  }
  const currentLines = phoneNumbersValue.phone_numbers.filter(
    (candidate) =>
      isObjectRecord(candidate)
      && normalizeLinqPhoneNumber(candidate.phone_number) === input.sender,
  );
  const currentLine = currentLines[0];
  const reputation = isObjectRecord(currentLine?.reputation)
    ? currentLine.reputation
    : null;
  const reputationStatus =
    normalizeLinqHealthStatus(reputation?.status)
    ?? normalizeLinqHealthStatus(currentLine?.health_status);
  return !(
    currentLines.length !== 1
    || !isObjectRecord(currentLine)
    || reputationStatus !== "HEALTHY"
  );
}

function formatDatabaseHealthCondition(
  condition: DatabaseHealthCondition,
  checkedAtMs: number,
  monitoringCheckedAtMs: number | null,
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
    case "pooled_application_connection_errors":
      return `${formatCount(condition.count)} pooled application ${
        condition.count === 1 ? "connection error" : "connection errors"
      } (port 6432)`;
    case "monitoring_unavailable":
      return formatMonitoringUnavailableCondition(
        condition,
        monitoringCheckedAtMs !== null
          && monitoringCheckedAtMs !== checkedAtMs
          ? monitoringCheckedAtMs
          : null,
      );
  }
}

function formatMonitoringUnavailableCondition(
  condition: Extract<
    DatabaseHealthCondition,
    { kind: "monitoring_unavailable" }
  >,
  observedAtMs: number | null,
): string {
  const incompleteChecks = condition.incompleteChecks
    ?? (condition.missingMetrics.length > 0 ? condition.failures : 0);
  const unavailableChecks = condition.unavailableChecks
    ?? (condition.missingMetrics.length > 0 ? 0 : condition.failures);
  const missingMetricLabels = condition.missingMetrics.map(
    (name) => DATABASE_METRIC_ALERT_LABELS[name],
  );
  const details = [
    observedAtMs === null
      ? null
      : `window ended ${
        new Date(observedAtMs).toISOString().slice(11, 16)
      } UTC`,
    incompleteChecks > 0 && unavailableChecks > 0
      ? `${formatCount(incompleteChecks)} incomplete, ${formatCount(
        unavailableChecks,
      )} unavailable`
      : null,
    missingMetricLabels.length === 0
      ? null
      : `missing PlanetScale ${
        missingMetricLabels.length === 1 ? "metric" : "metrics"
      } observed: ${missingMetricLabels.join(", ")}`,
  ].filter((detail): detail is string => detail !== null);
  const detailEvidence = details.length === 0
    ? ""
    : ` (${details.join("; ")})`;
  const availability = incompleteChecks > 0 && unavailableChecks > 0
    ? "impaired"
    : incompleteChecks > 0
      ? "incomplete"
      : "unavailable";
  return `Database monitor telemetry was ${availability} for ${formatCount(
    condition.failures,
  )} checks${detailEvidence}`;
}

function buildMonitoringAlertObligation(input: {
  checkedAtMs: number;
  failures: number;
  observations: readonly DatabaseHealthMonitoringEvidence[];
}): DatabaseHealthMonitoringAlertObligation {
  if (input.observations.length !== input.failures) {
    throw new Error("Database monitoring window evidence is incomplete.");
  }
  const incompleteChecks = input.observations.filter(
    (observation) => observation.availability === "incomplete",
  ).length;
  const unavailableChecks = input.observations.length - incompleteChecks;
  const observedMissingMetrics = new Set(
    input.observations.flatMap((observation) => observation.missingMetrics),
  );
  return {
    checkedAtMs: input.checkedAtMs,
    failures: input.failures,
    incompleteChecks,
    missingMetrics: DATABASE_HEALTH_REQUIRED_METRIC_NAMES.filter(
      (name) => observedMissingMetrics.has(name),
    ),
    unavailableChecks,
  };
}

function buildDatabaseAlertIdempotencyKey(input: {
  alertSequence: number;
  incidentSequence: number;
}): string {
  return `murph-db-${input.incidentSequence}-${input.alertSequence}`;
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
    // Workers fetch rejects redirect: "error" outright (TypeError before any
    // network I/O); "manual" keeps the fail-closed intent because a 3xx
    // response is !ok for every caller.
    redirect: "manual",
    signal: AbortSignal.timeout(DATABASE_HEALTH_FETCH_TIMEOUT_MS),
  });
}

async function waitForDatabaseHealthRetry(delayMs: number): Promise<void> {
  await scheduler.wait(delayMs);
}

function hasUsableDatabaseHealthMetric(
  observation: DatabaseMetricObservation,
): boolean {
  return observation.missingMetrics.length
    < DATABASE_HEALTH_REQUIRED_METRIC_NAMES.length;
}

function shouldConfirmMissingConnectionErrors(
  observation: DatabaseMetricObservation,
  connectionErrorDeltas: DatabaseConnectionErrorDeltas | null,
): boolean {
  return observation.missingMetrics.length === 1
    && observation.missingMetrics[0] === CONNECTION_ERROR_METRIC_NAME
    && evaluateDatabaseMetricSnapshot(
      observation.snapshot,
      connectionErrorDeltas,
    ).length === 0;
}

function composeConnectionErrorConfirmation(
  observation: DatabaseMetricObservation,
  confirmation: DatabaseMetricObservation,
): DatabaseMetricObservation {
  const originalCounters = observation.snapshot.connectionErrorCounters;
  const confirmationCounters = confirmation.snapshot.connectionErrorCounters;
  const connectionErrorCounters = confirmationCounters === null
    ? originalCounters
    : advanceConnectionErrorCounterBaseline(
      confirmationCounters,
      originalCounters,
    );
  const hasCompleteConnectionErrors = connectionErrorCounters !== null
    && hasExpectedConnectionErrorPorts(connectionErrorCounters);
  const missingMetricSet = new Set(confirmation.missingMetrics);
  if (hasCompleteConnectionErrors) {
    missingMetricSet.delete(CONNECTION_ERROR_METRIC_NAME);
  } else {
    missingMetricSet.add(CONNECTION_ERROR_METRIC_NAME);
  }
  return {
    missingMetrics: DATABASE_HEALTH_REQUIRED_METRIC_NAMES.filter(
      (name) => missingMetricSet.has(name),
    ),
    snapshot: {
      ...confirmation.snapshot,
      connectionErrorCounters,
    },
  };
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
      | "linq_duplicate_recipient"
      | "linq_rejected_response"
      | "linq_retryable_response",
  ) {
    super(code);
    this.name = "LinqDatabaseAlertError";
  }
}
