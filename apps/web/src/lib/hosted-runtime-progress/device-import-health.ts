const MINUTE = 60_000;
export const DEVICE_IMPORT_STALL_MS = 15 * MINUTE;
export const DEVICE_IMPORT_BACKLOG_MS = 60 * MINUTE;
export const DEVICE_IMPORT_LOOKBACK_MS = 2 * DEVICE_IMPORT_BACKLOG_MS;
export const DEVICE_IMPORT_CYCLE_WINDOW_MS = 20 * MINUTE;
export const DEVICE_IMPORT_CYCLE_LIMIT = 4;

export type DeviceImportCondition = "stalled" | "cycling" | "backlog";
export type DeviceImportHealth = {
  anomalous: boolean;
  affectedRuntimeCount: number;
  oldestBacklogMs: number;
  restartCount: number;
  cancellationCount: number;
  savedProgressPassCount: number;
};

// Values are selected by the diagnostic reader; identifiers remain in memory.
export type DeviceImportObservation = {
  subjectKey: string;
  connectionKey: string | null;
  attemptId: string | null;
  at: Date;
  eventCode: string;
  pending: boolean | null;
  runnable: boolean | null;
  progressed: boolean;
  checkpointAccepted: boolean;
  restarted: boolean;
  cancelled: boolean;
};

export function summarizeDeviceImportHealth(input: {
  now: Date;
  observations: readonly DeviceImportObservation[];
  dueSubjects: ReadonlySet<string>;
}): Record<DeviceImportCondition, DeviceImportHealth> {
  const result = { stalled: emptyHealth(), cycling: emptyHealth(), backlog: emptyHealth() };
  const bySubject = new Map<string, DeviceImportObservation[]>();
  const now = input.now.getTime();
  for (const row of input.observations) {
    const at = row.at.getTime();
    if (!Number.isFinite(at) || at > now || at < now - DEVICE_IMPORT_LOOKBACK_MS) {
      throw new Error("Device import observation chronology is invalid.");
    }
    const rows = bySubject.get(row.subjectKey) ?? [];
    rows.push(row);
    bySubject.set(row.subjectKey, rows);
  }
  for (const [subject, rows] of bySubject) {
    const health = summarizeRuntime(rows, now, input.dueSubjects.has(subject));
    for (const condition of ["stalled", "cycling", "backlog"] as const) {
      const runtime = health[condition];
      const total = result[condition];
      total.anomalous ||= runtime.anomalous;
      total.affectedRuntimeCount += runtime.affectedRuntimeCount;
      total.oldestBacklogMs = Math.max(total.oldestBacklogMs, runtime.oldestBacklogMs);
      total.restartCount += runtime.restartCount;
      total.cancellationCount += runtime.cancellationCount;
      total.savedProgressPassCount += runtime.savedProgressPassCount;
    }
  }
  return result;
}

function summarizeRuntime(rows: DeviceImportObservation[], now: number, due: boolean) {
  rows.sort((a, b) => a.at.getTime() - b.at.getTime());
  const result = { stalled: emptyHealth(), cycling: emptyHealth(), backlog: emptyHealth() };
  const restartTimes = rows.filter(row => row.restarted).map(row => row.at.getTime());
  for (const connectionRows of groupConnectionObservations(rows).values()) {
    const evidence = summarizeConnection(connectionRows, now, due, restartTimes, row => row.pending);
    if (!evidence) continue;
    // Reuse the same checkpoint and continuity rules without discarding the
    // scheduled retry obligations used by stall and cycling detection.
    const backlog = summarizeConnection(connectionRows, now, false, restartTimes,
      row => row.runnable ?? row.pending);
    const { backlogAge, lastProgress, restarts, cancellations, savedPasses } = evidence;
    const conditions: DeviceImportCondition[] = [];
    if ((due || evidence.latestPassUncheckpointed)
      && !evidence.awaitingCheckpoint
      && now - lastProgress >= DEVICE_IMPORT_STALL_MS) {
      conditions.push("stalled");
    }
    if (Math.max(restarts, cancellations) >= DEVICE_IMPORT_CYCLE_LIMIT && savedPasses < 2) {
      conditions.push("cycling");
    }
    if (backlog && backlog.backlogAge >= DEVICE_IMPORT_BACKLOG_MS && backlog.evidenceCurrent) conditions.push("backlog");
    for (const condition of conditions) {
      const health = result[condition];
      health.anomalous = true;
      health.affectedRuntimeCount = 1;
      health.oldestBacklogMs = Math.max(health.oldestBacklogMs,
        condition === "backlog" ? backlog!.backlogAge : backlogAge);
      health.restartCount = Math.max(health.restartCount, restarts);
      health.cancellationCount += cancellations;
      health.savedProgressPassCount += savedPasses;
    }
  }
  return result;
}

function groupConnectionObservations(rows: readonly DeviceImportObservation[]) {
  const connections = new Map<string, DeviceImportObservation[]>();
  const attempts = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.eventCode === "device-sync.pass_finished" && row.connectionKey) {
      const connectionRows = connections.get(row.connectionKey) ?? [];
      connectionRows.push(row);
      connections.set(row.connectionKey, connectionRows);
      if (row.attemptId) {
        const keys = attempts.get(row.attemptId) ?? new Set<string>();
        keys.add(row.connectionKey);
        attempts.set(row.attemptId, keys);
      }
    }
    if (row.checkpointAccepted && row.attemptId) {
      // Each pass links to at most one following checkpoint. Do not broadcast
      // every runtime checkpoint to every connection in the lookback window.
      for (const key of attempts.get(row.attemptId) ?? []) connections.get(key)?.push(row);
      attempts.delete(row.attemptId);
    }
  }
  return connections;
}

function emptyHealth(): DeviceImportHealth {
  return { anomalous: false, affectedRuntimeCount: 0, oldestBacklogMs: 0,
    restartCount: 0, cancellationCount: 0, savedProgressPassCount: 0 };
}

function summarizeConnection(
  rows: DeviceImportObservation[], now: number, due: boolean, restartTimes: readonly number[],
  pendingOf: (row: DeviceImportObservation) => boolean | null,
) {
  let pendingSince: number | null = null;
  let lastPendingAt = 0;
  let lastProgress = 0;
  const pendingPublications = new Map<string, { at: number; progressed: boolean }[]>();
  const pendingSnapshots = new Map<string | null, boolean | null>();
  let latestPassAttemptId: string | null = null;
  const savedAt: number[] = [];
  const cancellationsAt: number[] = [];
  for (const row of rows) {
    const at = row.at.getTime();
    const pending = pendingOf(row);
    if (pending === true) {
      // A long quiet gap is not evidence of continuous expensive processing.
      if (pendingSince === null || at - lastPendingAt > DEVICE_IMPORT_STALL_MS) {
        pendingSince = at;
        lastProgress = at;
      }
      lastPendingAt = at;
    }
    if (row.eventCode === "device-sync.pass_finished") {
      latestPassAttemptId = row.attemptId;
      pendingSnapshots.set(row.attemptId, pending);
      if (row.attemptId && (row.progressed || (!due && row.runnable === false))) {
        const passes = pendingPublications.get(row.attemptId) ?? [];
        passes.push({ at, progressed: row.progressed });
        pendingPublications.set(row.attemptId, passes);
      }
    }
    if (row.checkpointAccepted && row.attemptId) {
      const passes = (pendingPublications.get(row.attemptId) ?? []).filter(pass => pass.progressed);
      if (passes.length > 0) {
        lastProgress = at;
        savedAt.push(...passes.map(pass => pass.at));
      }
      pendingPublications.delete(row.attemptId);
      // Local queue drain is not durable recovery until Web accepts it.
      if (pendingSnapshots.get(row.attemptId) === false) {
        pendingSince = null;
        pendingPublications.clear();
      }
      pendingSnapshots.delete(row.attemptId);
    }
    if (row.cancelled) cancellationsAt.push(at);
  }
  if (pendingSince === null) return null;
  // Eligibility shares the continuity threshold above. A quiet gap that has not
  // reset the evidence cannot clear an incident, so a continuing condition
  // reminds instead of re-alerting on the next pass. An overdue wake keeps a
  // silent queue eligible for stall detection only.
  const evidenceCurrent = now - lastPendingAt <= DEVICE_IMPORT_STALL_MS;
  if (!due && !evidenceCurrent) return null;
  const recentAfter = Math.max(pendingSince, now - DEVICE_IMPORT_CYCLE_WINDOW_MS);
  const countRecent = (times: number[]) => times.filter(at => at >= recentAfter).length;
  return {
    evidenceCurrent,
    awaitingCheckpoint: isAwaitingCheckpoint(pendingPublications, lastProgress, now),
    latestPassUncheckpointed: pendingSnapshots.has(latestPassAttemptId),
    backlogAge: now - pendingSince,
    lastProgress: Math.max(pendingSince, lastProgress),
    restarts: countAtOrAfter(restartTimes, recentAfter), cancellations: countRecent(cancellationsAt),
    savedPasses: countRecent(savedAt),
  };
}

function isAwaitingCheckpoint(
  pendingPublications: ReadonlyMap<string, readonly { at: number }[]>, lastProgress: number, now: number,
): boolean {
  // Productive passes and proven deferred work need time to publish their idle
  // checkpoint. Deferred no-ops qualify only before the canonical wake is overdue.
  // Further passes or restarts cannot refresh the oldest publication deadline.
  let firstUnsavedPassAt = Infinity;
  for (const passes of pendingPublications.values()) {
    for (const { at } of passes) {
      if (at >= lastProgress) firstUnsavedPassAt = Math.min(firstUnsavedPassAt, at);
    }
  }
  return Number.isFinite(firstUnsavedPassAt)
    && now - firstUnsavedPassAt < DEVICE_IMPORT_STALL_MS;
}

function countAtOrAfter(times: readonly number[], cutoff: number) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle]! < cutoff) low = middle + 1;
    else high = middle;
  }
  return times.length - low;
}
