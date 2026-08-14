export const DATABASE_HEALTH_REQUIRED_METRIC_NAMES = [
  "planetscale_edge_postgres_connection_errors_total",
  "planetscale_pgbouncer_current_connections",
  "planetscale_pgbouncer_pools_client",
  "planetscale_pgbouncer_pools_client_maxwait_seconds",
  "planetscale_pgbouncer_pools_server",
  "planetscale_postgres_connection_state",
  "planetscale_postgres_settings_max_connections",
] as const;

export type DatabaseHealthRequiredMetricName =
  typeof DATABASE_HEALTH_REQUIRED_METRIC_NAMES[number];

const SELECTED_METRIC_NAMES = new Set<string>(
  DATABASE_HEALTH_REQUIRED_METRIC_NAMES,
);

const BRANCH_LABEL = "planetscale_database_branch_id";
const POD_LABEL = "planetscale_pod";
const ROLE_LABEL = "planetscale_role";
const CONNECTION_STATE_LABEL = "planetscale_connection_state";
const PGBOUNCER_POOL_LABEL = "planetscale_pgbouncer_pool";
const PORT_LABEL = "planetscale_port";
const REGION_LABEL = "planetscale_region";

export const DATABASE_CONNECTION_ERROR_PORTS = ["5432", "6432"] as const;

export type DatabaseConnectionErrorPort =
  typeof DATABASE_CONNECTION_ERROR_PORTS[number];

export type DatabaseConnectionErrorDeltas = Readonly<
  Record<DatabaseConnectionErrorPort, number | null>
>;

export const DATABASE_CLIENT_WAIT_ALERT_SECONDS = 5;
export const DATABASE_CONNECTION_UTILIZATION_ALERT_RATIO = 0.9;
export const DATABASE_IDLE_IN_TRANSACTION_ALERT_COUNT = 5;
export const DATABASE_SERVER_POOL_ALERT_RATIO = 0.9;

export interface DatabaseMetricSnapshot {
  clientWaitSeconds: number;
  clientWaitingConnections: number;
  connectionErrorCounters: Record<string, number>;
  postgresConnections: number;
  postgresConnectionStates: Record<string, number>;
  postgresMaxConnections: number;
  serverConnections: number;
  serverPoolCapacity: number;
  serverPoolSaturationRatio: number;
  serverPoolStates: Record<string, number>;
}

export interface DatabaseMetricObservationSnapshot {
  clientWaitSeconds: number | null;
  clientWaitingConnections: number | null;
  connectionErrorCounters: Record<string, number> | null;
  postgresConnections: number | null;
  postgresConnectionStates: Record<string, number> | null;
  postgresMaxConnections: number | null;
  serverConnections: number | null;
  serverPoolCapacity: number | null;
  serverPoolSaturationRatio: number | null;
  serverPoolStates: Record<string, number> | null;
}

export interface DatabaseMetricObservation {
  missingMetrics: readonly DatabaseHealthRequiredMetricName[];
  snapshot: DatabaseMetricObservationSnapshot;
}

export type DatabaseHealthCondition =
  | {
      kind: "client_wait";
      seconds: number;
      waitingConnections: number | null;
    }
  | {
      connections: number;
      kind: "server_pool_saturation";
      limit: number;
      ratio: number;
    }
  | {
      connections: number;
      kind: "postgres_connection_saturation";
      limit: number;
      ratio: number;
    }
  | {
      count: number;
      kind: "postgres_aborted_connections";
    }
  | {
      count: number;
      kind: "postgres_disabled_connections";
    }
  | {
      count: number;
      kind: "postgres_idle_in_transaction";
    }
  | {
      count: number;
      kind: "direct_migration_admission_failures";
    }
  | {
      count: number;
      kind: "pooled_application_connection_errors";
    }
  | {
      failures: number;
      incompleteChecks?: number;
      kind: "monitoring_unavailable";
      missingMetrics: readonly DatabaseHealthRequiredMetricName[];
      unavailableChecks?: number;
    };

interface PrometheusMetricPoint {
  labels: Readonly<Record<string, string>>;
  name: string;
  value: number;
}

export class DatabaseMetricsParseError extends Error {
  readonly code: "metrics_parse_failed" | "required_metrics_missing";
  readonly missingMetrics: readonly DatabaseHealthRequiredMetricName[];

  constructor(
    code: "metrics_parse_failed" | "required_metrics_missing",
    missingMetrics: readonly DatabaseHealthRequiredMetricName[] = [],
  ) {
    super(code);
    this.name = "DatabaseMetricsParseError";
    this.code = code;
    this.missingMetrics = [...missingMetrics];
  }
}

export function parsePlanetScaleDatabaseMetrics(
  body: string,
  branchId: string,
): DatabaseMetricSnapshot {
  const observation = parsePlanetScaleDatabaseMetricObservation(
    body,
    branchId,
  );
  return requireCompleteDatabaseMetricSnapshot(observation);
}

export function requireCompleteDatabaseMetricSnapshot(
  observation: DatabaseMetricObservation,
): DatabaseMetricSnapshot {
  if (observation.missingMetrics.length > 0) {
    throw new DatabaseMetricsParseError(
      "required_metrics_missing",
      observation.missingMetrics,
    );
  }
  const snapshot = observation.snapshot;
  if (
    snapshot.clientWaitSeconds === null
    || snapshot.clientWaitingConnections === null
    || snapshot.connectionErrorCounters === null
    || snapshot.postgresConnections === null
    || snapshot.postgresConnectionStates === null
    || snapshot.postgresMaxConnections === null
    || snapshot.serverConnections === null
    || snapshot.serverPoolCapacity === null
    || snapshot.serverPoolSaturationRatio === null
    || snapshot.serverPoolStates === null
  ) {
    throw new DatabaseMetricsParseError("required_metrics_missing");
  }
  return {
    clientWaitSeconds: snapshot.clientWaitSeconds,
    clientWaitingConnections: snapshot.clientWaitingConnections,
    connectionErrorCounters: snapshot.connectionErrorCounters,
    postgresConnections: snapshot.postgresConnections,
    postgresConnectionStates: snapshot.postgresConnectionStates,
    postgresMaxConnections: snapshot.postgresMaxConnections,
    serverConnections: snapshot.serverConnections,
    serverPoolCapacity: snapshot.serverPoolCapacity,
    serverPoolSaturationRatio: snapshot.serverPoolSaturationRatio,
    serverPoolStates: snapshot.serverPoolStates,
  };
}

export function parsePlanetScaleDatabaseMetricObservation(
  body: string,
  branchId: string,
): DatabaseMetricObservation {
  const points = parsePrometheusText(body)
    .filter((point) => point.labels[BRANCH_LABEL] === branchId);
  const primaryPoints = points.filter(isPrimaryMetricPoint);

  const clientWaitPoints = primaryPoints.filter(
    (point) =>
      point.name === "planetscale_pgbouncer_pools_client_maxwait_seconds",
  );
  const clientPoolPoints = primaryPoints.filter(
    (point) => point.name === "planetscale_pgbouncer_pools_client",
  );
  const currentConnectionPoints = primaryPoints.filter(
    (point) => point.name === "planetscale_pgbouncer_current_connections",
  );
  const serverPoolPoints = primaryPoints.filter(
    (point) => point.name === "planetscale_pgbouncer_pools_server",
  );
  const postgresStatePoints = primaryPoints.filter(
    (point) => point.name === "planetscale_postgres_connection_state",
  );
  const postgresMaxPoints = primaryPoints.filter(
    (point) =>
      point.name === "planetscale_postgres_settings_max_connections",
  );
  const connectionErrorPoints = points.filter(
    (point) =>
      point.name === "planetscale_edge_postgres_connection_errors_total"
      && isDatabaseConnectionErrorPort(point.labels[PORT_LABEL]),
  );
  const observedConnectionErrorPorts = new Set(
    connectionErrorPoints.map((point) => point.labels[PORT_LABEL]),
  );

  const missingMetricSet = new Set<DatabaseHealthRequiredMetricName>();
  if (
    DATABASE_CONNECTION_ERROR_PORTS.some(
      (port) => !observedConnectionErrorPorts.has(port),
    )
  ) {
    missingMetricSet.add(
      "planetscale_edge_postgres_connection_errors_total",
    );
  }
  if (currentConnectionPoints.length === 0) {
    missingMetricSet.add("planetscale_pgbouncer_current_connections");
  }
  if (clientPoolPoints.length === 0) {
    missingMetricSet.add("planetscale_pgbouncer_pools_client");
  }
  if (clientWaitPoints.length === 0) {
    missingMetricSet.add(
      "planetscale_pgbouncer_pools_client_maxwait_seconds",
    );
  }
  if (serverPoolPoints.length === 0) {
    missingMetricSet.add("planetscale_pgbouncer_pools_server");
  }
  if (postgresStatePoints.length === 0) {
    missingMetricSet.add("planetscale_postgres_connection_state");
  }
  if (postgresMaxPoints.length === 0) {
    missingMetricSet.add(
      "planetscale_postgres_settings_max_connections",
    );
  }

  const postgresConnectionStates = postgresStatePoints.length === 0
    ? null
    : sumByLabel(postgresStatePoints, CONNECTION_STATE_LABEL);
  if (postgresConnectionStates === null) {
    missingMetricSet.add("planetscale_postgres_connection_state");
  }
  const serverPoolStates = serverPoolPoints.length === 0
    ? null
    : sumByLabel(serverPoolPoints, PGBOUNCER_POOL_LABEL);
  if (serverPoolStates === null) {
    missingMetricSet.add("planetscale_pgbouncer_pools_server");
  }
  const clientWaitingConnections = clientPoolPoints.length === 0
    || !clientPoolPoints.every(
      (point) => Boolean(point.labels[PGBOUNCER_POOL_LABEL]),
    )
    ? null
    : sumMetricValues(
      clientPoolPoints.filter(
        (point) =>
          point.labels[PGBOUNCER_POOL_LABEL]?.toLowerCase() === "waiting",
      ),
    );
  if (clientWaitingConnections === null) {
    missingMetricSet.add("planetscale_pgbouncer_pools_client");
  }
  const connectionCapacityByPod = postgresMaxPoints.length === 0
    ? null
    : maximumByPod(postgresMaxPoints);
  if (connectionCapacityByPod === null) {
    missingMetricSet.add(
      "planetscale_postgres_settings_max_connections",
    );
  }
  const serverConnectionsByPod = currentConnectionPoints.length === 0
    ? null
    : sumByPod(currentConnectionPoints);
  if (serverConnectionsByPod === null) {
    missingMetricSet.add("planetscale_pgbouncer_current_connections");
  }
  const mostSaturatedServerPool =
    connectionCapacityByPod && serverConnectionsByPod
      ? resolveMostSaturatedServerPool({
        connectionCapacityByPod,
        serverConnectionsByPod,
      })
      : null;
  if (
    connectionCapacityByPod
    && serverConnectionsByPod
    && !mostSaturatedServerPool
  ) {
    missingMetricSet.add("planetscale_pgbouncer_current_connections");
    missingMetricSet.add(
      "planetscale_postgres_settings_max_connections",
    );
  }
  const postgresMaxConnections = connectionCapacityByPod
    ? sumMapValues(connectionCapacityByPod)
    : null;
  if (postgresMaxConnections !== null && postgresMaxConnections <= 0) {
    missingMetricSet.add(
      "planetscale_postgres_settings_max_connections",
    );
  }
  const missingMetrics = DATABASE_HEALTH_REQUIRED_METRIC_NAMES.filter(
    (name) => missingMetricSet.has(name),
  );
  return {
    missingMetrics,
    snapshot: {
      clientWaitSeconds: clientWaitPoints.length === 0
        ? null
        : maximumMetricValue(clientWaitPoints),
      clientWaitingConnections,
      connectionErrorCounters: connectionErrorPoints.length === 0
        ? null
        : sumConnectionErrorsByPortAndRegion(connectionErrorPoints),
      postgresConnections: postgresConnectionStates
        ? sumMapValues(new Map(Object.entries(postgresConnectionStates)))
        : null,
      postgresConnectionStates,
      postgresMaxConnections:
        postgresMaxConnections !== null && postgresMaxConnections > 0
          ? postgresMaxConnections
          : null,
      serverConnections: mostSaturatedServerPool?.connections ?? null,
      serverPoolCapacity: mostSaturatedServerPool?.limit ?? null,
      serverPoolSaturationRatio: mostSaturatedServerPool?.ratio ?? null,
      serverPoolStates,
    },
  };
}

export function calculateConnectionErrorDeltas(
  current: Readonly<Record<string, number>>,
  previous: Readonly<Record<string, number>> | null,
): DatabaseConnectionErrorDeltas {
  const deltas: Record<DatabaseConnectionErrorPort, number | null> = {
    "5432": null,
    "6432": null,
  };
  for (const port of DATABASE_CONNECTION_ERROR_PORTS) {
    const currentSeries = Object.entries(current).filter(([series]) =>
      readConnectionErrorSeriesPort(series) === port
    );
    if (currentSeries.length === 0) {
      continue;
    }
    if (!previous) {
      deltas[port] = 0;
      continue;
    }
    deltas[port] = Math.trunc(
      currentSeries.reduce((total, [series, currentValue]) => {
        const previousValue = previous[series];
        if (
          typeof previousValue !== "number"
          || !Number.isFinite(previousValue)
          || currentValue < previousValue
        ) {
          return total;
        }
        return total + currentValue - previousValue;
      }, 0),
    );
  }
  return deltas;
}

export function advanceConnectionErrorCounterBaseline(
  current: Readonly<Record<string, number>>,
  previous: Readonly<Record<string, number>> | null,
): Record<string, number> {
  const nextBaseline: Record<string, number> = {};
  for (const port of DATABASE_CONNECTION_ERROR_PORTS) {
    const currentEntries = readConnectionErrorEntriesForPort(current, port);
    const entries = currentEntries.length > 0
      ? currentEntries
      : readConnectionErrorEntriesForPort(previous ?? {}, port);
    for (const [series, value] of entries) {
      nextBaseline[series] = value;
    }
  }
  return nextBaseline;
}

export function hasExpectedConnectionErrorPorts(
  counters: Readonly<Record<string, number>>,
): boolean {
  const observedPorts = new Set(
    Object.keys(counters).map(readConnectionErrorSeriesPort),
  );
  return DATABASE_CONNECTION_ERROR_PORTS.every(
    (port) => observedPorts.has(port),
  );
}

export function evaluateDatabaseMetricSnapshot(
  snapshot: DatabaseMetricObservationSnapshot,
  connectionErrorDeltas: DatabaseConnectionErrorDeltas | null,
): DatabaseHealthCondition[] {
  const conditions: DatabaseHealthCondition[] = [];
  if (
    snapshot.clientWaitSeconds !== null
    && snapshot.clientWaitSeconds >= DATABASE_CLIENT_WAIT_ALERT_SECONDS
  ) {
    conditions.push({
      kind: "client_wait",
      seconds: snapshot.clientWaitSeconds,
      waitingConnections: snapshot.clientWaitingConnections,
    });
  }
  if (
    snapshot.serverPoolSaturationRatio !== null
    && snapshot.serverPoolSaturationRatio
    >= DATABASE_SERVER_POOL_ALERT_RATIO
    && snapshot.serverConnections !== null
    && snapshot.serverPoolCapacity !== null
  ) {
    conditions.push({
      connections: snapshot.serverConnections,
      kind: "server_pool_saturation",
      limit: snapshot.serverPoolCapacity,
      ratio: snapshot.serverPoolSaturationRatio,
    });
  }

  const postgresConnectionRatio =
    snapshot.postgresConnections !== null
    && snapshot.postgresMaxConnections !== null
      ? snapshot.postgresConnections / snapshot.postgresMaxConnections
      : null;
  if (
    postgresConnectionRatio !== null
    && postgresConnectionRatio
    >= DATABASE_CONNECTION_UTILIZATION_ALERT_RATIO
    && snapshot.postgresConnections !== null
    && snapshot.postgresMaxConnections !== null
  ) {
    conditions.push({
      connections: snapshot.postgresConnections,
      kind: "postgres_connection_saturation",
      limit: snapshot.postgresMaxConnections,
      ratio: postgresConnectionRatio,
    });
  }

  const normalizedStates = snapshot.postgresConnectionStates
    ? normalizeStateCounts(snapshot.postgresConnectionStates)
    : {};
  const abortedConnections =
    normalizedStates["idle in transaction (aborted)"] ?? 0;
  if (abortedConnections > 0) {
    conditions.push({
      count: abortedConnections,
      kind: "postgres_aborted_connections",
    });
  }
  const disabledConnections = normalizedStates.disabled ?? 0;
  if (disabledConnections > 0) {
    conditions.push({
      count: disabledConnections,
      kind: "postgres_disabled_connections",
    });
  }
  const idleInTransaction = normalizedStates["idle in transaction"] ?? 0;
  if (
    idleInTransaction
    >= DATABASE_IDLE_IN_TRANSACTION_ALERT_COUNT
  ) {
    conditions.push({
      count: idleInTransaction,
      kind: "postgres_idle_in_transaction",
    });
  }
  const directConnectionErrorDelta = connectionErrorDeltas?.["5432"];
  if (
    directConnectionErrorDelta !== null
    && directConnectionErrorDelta !== undefined
    && directConnectionErrorDelta > 0
  ) {
    conditions.push({
      count: directConnectionErrorDelta,
      kind: "direct_migration_admission_failures",
    });
  }
  const pooledConnectionErrorDelta = connectionErrorDeltas?.["6432"];
  if (
    pooledConnectionErrorDelta !== null
    && pooledConnectionErrorDelta !== undefined
    && pooledConnectionErrorDelta > 0
  ) {
    conditions.push({
      count: pooledConnectionErrorDelta,
      kind: "pooled_application_connection_errors",
    });
  }
  return conditions;
}

function parsePrometheusText(body: string): PrometheusMetricPoint[] {
  const points: PrometheusMetricPoint[] = [];
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const nameMatch = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(.*)$/u.exec(line);
    const name = nameMatch?.[1];
    if (!name || !SELECTED_METRIC_NAMES.has(name)) {
      continue;
    }

    let remainder = nameMatch[2]?.trimStart() ?? "";
    let labels: Readonly<Record<string, string>> = {};
    if (remainder.startsWith("{")) {
      const closingBrace = findLabelSetClosingBrace(remainder);
      if (closingBrace === -1) {
        throw new DatabaseMetricsParseError("metrics_parse_failed");
      }
      labels = parsePrometheusLabels(remainder.slice(1, closingBrace));
      remainder = remainder.slice(closingBrace + 1).trimStart();
    }

    const valueToken = remainder.split(/\s+/u)[0];
    const value = valueToken ? Number(valueToken) : Number.NaN;
    if (!Number.isFinite(value) || value < 0) {
      throw new DatabaseMetricsParseError("metrics_parse_failed");
    }
    points.push({ labels, name, value });
  }
  return points;
}

function findLabelSetClosingBrace(value: string): number {
  let escaped = false;
  let quoted = false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === "}") {
      return index;
    }
  }
  return -1;
}

function parsePrometheusLabels(value: string): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  let offset = 0;
  while (offset < value.length) {
    const nameMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/u.exec(value.slice(offset));
    const name = nameMatch?.[0];
    if (!name) {
      throw new DatabaseMetricsParseError("metrics_parse_failed");
    }
    offset += name.length;
    if (value.slice(offset, offset + 2) !== "=\"") {
      throw new DatabaseMetricsParseError("metrics_parse_failed");
    }
    offset += 2;

    let parsedValue = "";
    let closed = false;
    while (offset < value.length) {
      const character = value[offset];
      offset += 1;
      if (character === "\"") {
        closed = true;
        break;
      }
      if (character !== "\\") {
        parsedValue += character;
        continue;
      }

      const escaped = value[offset];
      offset += 1;
      if (escaped === undefined) {
        throw new DatabaseMetricsParseError("metrics_parse_failed");
      }
      parsedValue += escaped === "n" ? "\n" : escaped;
    }
    if (!closed || Object.hasOwn(labels, name)) {
      throw new DatabaseMetricsParseError("metrics_parse_failed");
    }
    labels[name] = parsedValue;

    if (offset === value.length) {
      break;
    }
    if (value[offset] !== ",") {
      throw new DatabaseMetricsParseError("metrics_parse_failed");
    }
    offset += 1;
  }
  return labels;
}

function isPrimaryMetricPoint(point: PrometheusMetricPoint): boolean {
  const role = point.labels[ROLE_LABEL];
  return role === undefined || role === "primary";
}

function sumByLabel(
  points: readonly PrometheusMetricPoint[],
  label: string,
): Record<string, number> | null {
  const totals: Record<string, number> = {};
  for (const point of points) {
    const key = point.labels[label];
    if (!key) {
      return null;
    }
    totals[key] = (totals[key] ?? 0) + point.value;
  }
  return totals;
}

function sumConnectionErrorsByPortAndRegion(
  points: readonly PrometheusMetricPoint[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const point of points) {
    const port = point.labels[PORT_LABEL];
    if (!isDatabaseConnectionErrorPort(port)) {
      continue;
    }
    const key = JSON.stringify([
      port,
      point.labels[REGION_LABEL] ?? "unknown",
    ]);
    totals[key] = (totals[key] ?? 0) + point.value;
  }
  return totals;
}

function isDatabaseConnectionErrorPort(
  value: string | undefined,
): value is DatabaseConnectionErrorPort {
  return DATABASE_CONNECTION_ERROR_PORTS.some((port) => port === value);
}

function readConnectionErrorSeriesPort(
  series: string,
): DatabaseConnectionErrorPort | null {
  let value: unknown;
  try {
    value = JSON.parse(series);
  } catch {
    return null;
  }
  if (
    !Array.isArray(value)
    || value.length !== 2
    || !isDatabaseConnectionErrorPort(value[0])
    || typeof value[1] !== "string"
  ) {
    return null;
  }
  return value[0];
}

function readConnectionErrorEntriesForPort(
  counters: Readonly<Record<string, number>>,
  port: DatabaseConnectionErrorPort,
): Array<[string, number]> {
  return Object.entries(counters).filter(
    ([series]) => readConnectionErrorSeriesPort(series) === port,
  );
}

function sumByPod(
  points: readonly PrometheusMetricPoint[],
): ReadonlyMap<string, number> | null {
  const totals = new Map<string, number>();
  for (const point of points) {
    const pod = point.labels[POD_LABEL];
    if (!pod) {
      return null;
    }
    totals.set(pod, (totals.get(pod) ?? 0) + point.value);
  }
  return totals;
}

function maximumByPod(
  points: readonly PrometheusMetricPoint[],
): ReadonlyMap<string, number> | null {
  const maximums = new Map<string, number>();
  for (const point of points) {
    const pod = point.labels[POD_LABEL];
    if (!pod) {
      return null;
    }
    maximums.set(pod, Math.max(maximums.get(pod) ?? 0, point.value));
  }
  return maximums;
}

function resolveMostSaturatedServerPool(input: {
  connectionCapacityByPod: ReadonlyMap<string, number>;
  serverConnectionsByPod: ReadonlyMap<string, number>;
}): {
  connections: number;
  limit: number;
  ratio: number;
} | null {
  let mostSaturated: {
    connections: number;
    limit: number;
    ratio: number;
  } | null = null;
  for (const [pod, connections] of input.serverConnectionsByPod) {
    const limit = input.connectionCapacityByPod.get(pod);
    if (limit === undefined || limit <= 0) {
      continue;
    }
    const ratio = connections / limit;
    if (!mostSaturated || ratio > mostSaturated.ratio) {
      mostSaturated = { connections, limit, ratio };
    }
  }
  return mostSaturated;
}

function maximumMetricValue(
  points: readonly PrometheusMetricPoint[],
): number {
  return points.reduce(
    (maximum, point) => Math.max(maximum, point.value),
    0,
  );
}

function sumMetricValues(points: readonly PrometheusMetricPoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

function sumMapValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of values.values()) {
    total += value;
  }
  return total;
}

function normalizeStateCounts(
  states: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(states).map(([state, count]) => [
      state.trim().toLowerCase(),
      count,
    ]),
  );
}
