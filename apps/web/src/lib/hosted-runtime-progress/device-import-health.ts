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
  attemptId: string | null;
  at: Date;
  eventCode: string;
  pending: boolean | null;
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
    const evidence = summarizeRuntime(rows, now, input.dueSubjects.has(subject));
    if (!evidence) continue;
    const { backlogAge, lastProgress, restarts, cancellations, savedPasses, recentPasses } = evidence;
    const conditions: DeviceImportCondition[] = [];
    if (now - lastProgress >= DEVICE_IMPORT_STALL_MS) conditions.push("stalled");
    if (Math.max(restarts, cancellations) >= DEVICE_IMPORT_CYCLE_LIMIT && savedPasses < 2) {
      conditions.push("cycling");
    }
    if (backlogAge >= DEVICE_IMPORT_BACKLOG_MS && recentPasses >= 2) conditions.push("backlog");
    for (const condition of conditions) {
      const health = result[condition];
      health.anomalous = true;
      health.affectedRuntimeCount++;
      health.oldestBacklogMs = Math.max(health.oldestBacklogMs, backlogAge);
      health.restartCount += restarts;
      health.cancellationCount += cancellations;
      health.savedProgressPassCount += savedPasses;
    }
  }
  return result;
}

function emptyHealth(): DeviceImportHealth {
  return { anomalous: false, affectedRuntimeCount: 0, oldestBacklogMs: 0,
    restartCount: 0, cancellationCount: 0, savedProgressPassCount: 0 };
}

function summarizeRuntime(rows: DeviceImportObservation[], now: number, due: boolean) {
  rows.sort((a, b) => a.at.getTime() - b.at.getTime());
  let pendingSince: number | null = null;
  let lastPendingAt = 0;
  let lastProgress = 0;
  const pendingProgress = new Map<string, number[]>();
  const pendingSnapshots = new Map<string | null, boolean | null>();
  const savedAt: number[] = [];
  const passesAt: number[] = [];
  const restartsAt: number[] = [];
  const cancellationsAt: number[] = [];
  for (const row of rows) {
    const at = row.at.getTime();
    if (row.pending === true) {
      // A long quiet gap is not evidence of continuous expensive processing.
      if (pendingSince === null || at - lastPendingAt > DEVICE_IMPORT_STALL_MS) {
        pendingSince = at;
        lastProgress = at;
      }
      lastPendingAt = at;
    }
    if (row.eventCode === "device-sync.pass_finished") {
      pendingSnapshots.set(row.attemptId, row.pending);
      passesAt.push(at);
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
      if (pendingSnapshots.get(row.attemptId) === false) {
        pendingSince = null;
        pendingProgress.clear();
      }
      pendingSnapshots.delete(row.attemptId);
    }
    if (row.restarted) restartsAt.push(at);
    if (row.cancelled) cancellationsAt.push(at);
  }
  if (pendingSince === null || (!due && now - lastPendingAt > 10 * MINUTE)) return null;
  const recentAfter = Math.max(pendingSince, now - DEVICE_IMPORT_CYCLE_WINDOW_MS);
  const countRecent = (times: number[]) => times.filter(at => at >= recentAfter).length;
  return {
    backlogAge: now - pendingSince,
    lastProgress: Math.max(pendingSince, lastProgress),
    restarts: countRecent(restartsAt), cancellations: countRecent(cancellationsAt),
    savedPasses: countRecent(savedAt), recentPasses: countRecent(passesAt),
  };
}
