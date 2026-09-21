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

type PendingSnapshot = {
  pending: boolean | null;
  runnable: boolean | null;
  firstObservedAt: number;
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
    // Saved deferral ends active cycling/backlog evidence. Keep all pending
    // retry obligations in the separate stall summary for overdue wakes.
    const runnable = summarizeConnection(connectionRows, now, false, restartTimes,
      row => row.runnable ?? row.pending);
    const conditions: DeviceImportCondition[] = [];
    if ((due || evidence.latestPassUncheckpointed)
      && !evidence.awaitingProgressCheckpoint
      && !evidence.awaitingDeferredCheckpoint
      && now - evidence.lastProgress >= DEVICE_IMPORT_STALL_MS) {
      conditions.push("stalled");
    }
    if (runnable && Math.max(runnable.restarts, runnable.cancellations) >= DEVICE_IMPORT_CYCLE_LIMIT
      && runnable.savedPasses < 2) {
      conditions.push("cycling");
    }
    if (runnable && runnable.backlogAge >= DEVICE_IMPORT_BACKLOG_MS && runnable.evidenceCurrent) conditions.push("backlog");
    for (const condition of conditions) {
      const { backlogAge, restarts, cancellations, savedPasses } = condition === "stalled" ? evidence : runnable!;
      const health = result[condition];
      health.anomalous = true;
      health.affectedRuntimeCount = 1;
      health.oldestBacklogMs = Math.max(health.oldestBacklogMs, backlogAge);
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
  const pendingProgress = new Map<string, number[]>();
  const pendingSnapshots = new Map<string | null, PendingSnapshot>();
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
      recordPendingSnapshot(pendingSnapshots, row, pending);
      if (row.progressed && row.attemptId) {
        const passes = pendingProgress.get(row.attemptId) ?? [];
        passes.push(at);
        pendingProgress.set(row.attemptId, passes);
      }
    }
    if (row.checkpointAccepted && row.attemptId) {
      const passes = pendingProgress.get(row.attemptId) ?? [];
      if (passes.length > 0) {
        lastProgress = at;
        savedAt.push(...passes);
        pendingProgress.delete(row.attemptId);
      }
      // Local queue drain is not durable recovery until Web accepts it.
      if (pendingSnapshots.get(row.attemptId)?.pending === false) {
        pendingSince = null;
        pendingProgress.clear();
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
    awaitingProgressCheckpoint: isAwaitingProgressCheckpoint(pendingProgress, lastProgress, now),
    awaitingDeferredCheckpoint: isAwaitingDeferredCheckpoint(pendingSnapshots, latestPassAttemptId, due, now),
    latestPassUncheckpointed: pendingSnapshots.has(latestPassAttemptId),
    backlogAge: now - pendingSince,
    lastProgress: Math.max(pendingSince, lastProgress),
    restarts: countAtOrAfter(restartTimes, recentAfter), cancellations: countRecent(cancellationsAt),
    savedPasses: countRecent(savedAt),
  };
}

function recordPendingSnapshot(
  snapshots: Map<string | null, PendingSnapshot>,
  row: DeviceImportObservation,
  pending: boolean | null,
) {
  snapshots.set(row.attemptId, {
    pending,
    runnable: row.runnable,
    firstObservedAt: snapshots.get(row.attemptId)?.firstObservedAt ?? row.at.getTime(),
  });
}

function isAwaitingDeferredCheckpoint(
  snapshots: ReadonlyMap<string | null, PendingSnapshot>,
  latestAttemptId: string | null, due: boolean, now: number,
): boolean {
  // Deferral is not progress and cannot excuse an already-overdue device wake.
  if (due || latestAttemptId === null || snapshots.get(latestAttemptId)?.runnable !== false) return false;
  // Bound the idle publication wait by the oldest unsaved pass across attempts.
  let firstUnsavedPassAt = Infinity;
  for (const snapshot of snapshots.values()) {
    firstUnsavedPassAt = Math.min(firstUnsavedPassAt, snapshot.firstObservedAt);
  }
  return now - firstUnsavedPassAt < DEVICE_IMPORT_STALL_MS;
}

function isAwaitingProgressCheckpoint(
  pendingProgress: ReadonlyMap<string, readonly number[]>, lastProgress: number, now: number,
): boolean {
  // A productive local pass needs time to publish its idle checkpoint. Anchor
  // that allowance to the first unsaved progress, not the newest pass/restart;
  // only accepted progress can start a new allowance for this connection.
  let firstUnsavedProgressAt = Infinity;
  for (const passes of pendingProgress.values()) {
    for (const at of passes) {
      if (at >= lastProgress) firstUnsavedProgressAt = Math.min(firstUnsavedProgressAt, at);
    }
  }
  return Number.isFinite(firstUnsavedProgressAt)
    && now - firstUnsavedProgressAt < DEVICE_IMPORT_STALL_MS;
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
