import type { DurableObjectSqlStorageLike } from "../user-runner/types.js";
import {
  classifyOperatorLinqAlertFailure,
  sendOperatorLinqAlert,
} from "../operator-alert/linq.js";
import {
  advanceConnectionErrorCounterBaseline,
  calculateConnectionErrorDeltas,
  DATABASE_CONNECTION_ERROR_METRIC_NAME,
  DATABASE_CONNECTION_ERROR_PORTS,
  DATABASE_HEALTH_REQUIRED_METRIC_NAMES,
  DatabaseMetricsParseError,
  evaluateDatabaseMetricSnapshot,
  parsePlanetScaleDatabaseMetricObservation,
  readMissingConnectionErrorPorts,
  requireCompleteDatabaseMetricSnapshot,
  type DatabaseConnectionErrorCollectionEvidence,
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
const PLANETSCALE_DISCOVERY_BODY_LIMIT_BYTES = 256 * 1_024;
const PLANETSCALE_METRICS_BODY_LIMIT_BYTES = 2 * 1_024 * 1_024;
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
  linqChatIds: readonly [primary: string, secondary: string];
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

interface DatabaseMetricCollection {
  attempts: number;
  connectionErrorEvidence: DatabaseConnectionErrorCollectionEvidence;
  observation: DatabaseMetricObservation;
}

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
      const {
        attempts,
        connectionErrorEvidence,
        observation,
      } = await this.collectMetricObservation(
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
        const monitoringMissingMetrics = [...observation.missingMetrics];
        const durableConnectionErrorEvidence =
          buildDurableConnectionErrorEvidence({
            connectionErrorEvidence,
            missingMetrics: monitoringMissingMetrics,
          });
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
            connectionErrorEvidence: durableConnectionErrorEvidence,
            failures,
            kind: "monitoring_unavailable",
            missingMetrics: monitoringMissingMetrics,
          });
        }
        console.warn("Database health metrics collection failed.", {
          attempts,
          connectionErrorEvidence,
          failureCode: "required_metrics_missing",
          failures,
          missingMetrics: monitoringMissingMetrics,
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
            connectionErrorEvidence: durableConnectionErrorEvidence,
            missingMetrics: monitoringMissingMetrics,
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
          ? [{
            connectionErrorEvidence: emptyConnectionErrorCollectionEvidence(),
            failures,
            kind: "monitoring_unavailable",
            missingMetrics,
          }]
          : [];
      console.warn("Database health metrics collection failed.", {
        attempts: 2,
        connectionErrorEvidence: emptyConnectionErrorCollectionEvidence(),
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
          connectionErrorEvidence: emptyConnectionErrorCollectionEvidence(),
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
  ): Promise<DatabaseMetricCollection> {
    let attempts = 1;
    const parsedObservations: DatabaseMetricObservation[] = [];
    let observation: DatabaseMetricObservation;
    try {
      observation = await this.collectMetricObservationOnce();
      parsedObservations.push(observation);
    } catch {
      await this.waitImplementation(DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS);
      attempts += 1;
      const retryObservation = await this.collectMetricObservationOnce();
      return buildDatabaseMetricCollection({
        attempts,
        observation: retryObservation,
        parsedObservations: [retryObservation],
      });
    }
    if (!hasUsableDatabaseHealthMetric(observation)) {
      await this.waitImplementation(DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS);
      attempts += 1;
      try {
        const retryObservation = await this.collectMetricObservationOnce();
        parsedObservations.push(retryObservation);
        return buildDatabaseMetricCollection({
          attempts,
          observation: retryObservation,
          parsedObservations,
        });
      } catch {
        return buildDatabaseMetricCollection({
          attempts,
          observation,
          parsedObservations,
        });
      }
    }
    if (!shouldConfirmMissingConnectionErrors(observation)) {
      return buildDatabaseMetricCollection({
        attempts,
        observation,
        parsedObservations,
      });
    }

    await this.waitImplementation(DATABASE_HEALTH_COLLECTION_RETRY_DELAY_MS);
    attempts += 1;
    try {
      const confirmation = await this.collectMetricObservationOnce();
      parsedObservations.push(confirmation);
      const confirmationCounters =
        confirmation.snapshot.connectionErrorCounters;
      if (
        evaluateDatabaseMetricSnapshot(
          confirmation.snapshot,
          null,
        ).length > 0
      ) {
        return buildDatabaseMetricCollection({
          attempts,
          observation: confirmation,
          parsedObservations,
        });
      }
      if (confirmationCounters === null) {
        return buildDatabaseMetricCollection({
          attempts,
          observation,
          parsedObservations,
        });
      }
      if (confirmation.missingMetrics.length === 0) {
        return buildDatabaseMetricCollection({
          attempts,
          observation: confirmation,
          parsedObservations,
        });
      }
      return buildDatabaseMetricCollection({
        attempts,
        observation: {
          missingMetrics: [],
          snapshot: {
            ...observation.snapshot,
            connectionErrorCounters: confirmationCounters,
          },
        },
        parsedObservations,
      });
    } catch {
      return buildDatabaseMetricCollection({
        attempts,
        observation,
        parsedObservations,
      });
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
        connectionErrorEvidence:
          monitoringAlertObligation.connectionErrorEvidence,
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
          connectionErrorEvidence:
            monitoringAlertObligation.connectionErrorEvidence,
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
      await sendOperatorLinqAlert({
        apiBaseUrl: this.config.linqApiBaseUrl,
        apiToken: this.config.linqApiToken,
        chatIds: this.config.linqChatIds,
        fetchImplementation: this.fetchImplementation,
        idempotencyKey,
        message,
      });
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
        failureCode: classifyOperatorLinqAlertFailure(error),
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
    (name) => formatMissingMetricLabel(
      name,
      condition.connectionErrorEvidence,
    ),
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

function formatMissingMetricLabel(
  name: DatabaseHealthRequiredMetricName,
  connectionErrorEvidence:
    DatabaseConnectionErrorCollectionEvidence | null | undefined,
): string {
  const label = DATABASE_METRIC_ALERT_LABELS[name];
  if (name !== DATABASE_CONNECTION_ERROR_METRIC_NAME) {
    return label;
  }
  if (
    !connectionErrorEvidence
    || connectionErrorEvidence.parsedAttempts === 0
  ) {
    return `${label} (missing port detail unavailable)`;
  }
  const missingPortCounts = DATABASE_CONNECTION_ERROR_PORTS.flatMap((port) => {
    const attempts = connectionErrorEvidence.missingPortAttempts[port];
    return attempts > 0
      ? [`${port} in ${attempts}/${connectionErrorEvidence.parsedAttempts}`]
      : [];
  });
  if (missingPortCounts.length === 0) {
    return `${label} (missing port detail unavailable)`;
  }
  return `connection errors (missing-port counts across parsed observations: ${
    missingPortCounts.join("; ")
  })`;
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
  const connectionErrorEvidence = input.observations.some(
    (observation) => observation.connectionErrorEvidence === null,
  )
    ? null
    : input.observations.reduce(
      (combined, observation) => {
        const evidence = observation.connectionErrorEvidence;
        if (evidence === null) {
          return combined;
        }
        return {
          missingPortAttempts: {
            "5432": combined.missingPortAttempts["5432"]
              + evidence.missingPortAttempts["5432"],
            "6432": combined.missingPortAttempts["6432"]
              + evidence.missingPortAttempts["6432"],
          },
          parsedAttempts: combined.parsedAttempts + evidence.parsedAttempts,
        };
      },
      emptyConnectionErrorCollectionEvidence(),
    );
  return {
    checkedAtMs: input.checkedAtMs,
    connectionErrorEvidence,
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

function buildDatabaseMetricCollection(input: {
  attempts: number;
  observation: DatabaseMetricObservation;
  parsedObservations: readonly DatabaseMetricObservation[];
}): DatabaseMetricCollection {
  const missingPortAttempts: Record<
    (typeof DATABASE_CONNECTION_ERROR_PORTS)[number],
    number
  > = { "5432": 0, "6432": 0 };
  for (const observation of input.parsedObservations) {
    for (
      const port of readMissingConnectionErrorPorts(
        observation.snapshot.connectionErrorCounters,
      )
    ) {
      missingPortAttempts[port] += 1;
    }
  }
  return {
    attempts: input.attempts,
    connectionErrorEvidence: {
      missingPortAttempts,
      parsedAttempts: input.parsedObservations.length,
    },
    observation: input.observation,
  };
}

function emptyConnectionErrorCollectionEvidence():
  DatabaseConnectionErrorCollectionEvidence {
  return {
    missingPortAttempts: { "5432": 0, "6432": 0 },
    parsedAttempts: 0,
  };
}

function buildDurableConnectionErrorEvidence(input: {
  connectionErrorEvidence: DatabaseConnectionErrorCollectionEvidence;
  missingMetrics: readonly DatabaseHealthRequiredMetricName[];
}): DatabaseConnectionErrorCollectionEvidence {
  return input.missingMetrics.includes(DATABASE_CONNECTION_ERROR_METRIC_NAME)
    ? input.connectionErrorEvidence
    : {
      missingPortAttempts: { "5432": 0, "6432": 0 },
      parsedAttempts: input.connectionErrorEvidence.parsedAttempts,
    };
}

function hasUsableDatabaseHealthMetric(
  observation: DatabaseMetricObservation,
): boolean {
  return observation.missingMetrics.length
    < DATABASE_HEALTH_REQUIRED_METRIC_NAMES.length;
}

function shouldConfirmMissingConnectionErrors(
  observation: DatabaseMetricObservation,
): boolean {
  return observation.missingMetrics.length === 1
    && observation.missingMetrics[0]
      === DATABASE_CONNECTION_ERROR_METRIC_NAME
    && evaluateDatabaseMetricSnapshot(
      observation.snapshot,
      null,
    ).length === 0;
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

function normalizeObservedAtMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now();
  }
  return Math.trunc(value);
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

class DatabaseHealthFetchError extends Error {
  constructor(readonly code: DatabaseHealthFailureCode) {
    super(code);
    this.name = "DatabaseHealthFetchError";
  }
}
