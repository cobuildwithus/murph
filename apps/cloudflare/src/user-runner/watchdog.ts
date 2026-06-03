import type { RunnerWriteFenceToken } from "./runner-state-store.js";
import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";

export class RunnerWatchdog {
  constructor(private readonly state: DurableObjectStateLike) {}

  async sync(record: RunnerStateRecord): Promise<void> {
    await this.syncAlarmAt(record.writeFence?.expiresAt ?? null);
  }

  async syncAlarmAt(nextAlarmAt: string | null): Promise<void> {
    if (!nextAlarmAt) {
      await this.state.storage.deleteAlarm?.();
      return;
    }

    await this.state.storage.setAlarm(new Date(nextAlarmAt));
  }
}

export function readWriteFenceWatchdogAlarmAt(record: RunnerStateRecord): string | null {
  return record.writeFence?.expiresAt ?? null;
}

export function isRunnerWriteFenceExpired(fence: { expiresAt: string }): boolean {
  const expiresAtMs = Date.parse(fence.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

export function runnerWriteFenceTokensMatch(
  current: RunnerWriteFenceToken | null,
  expected: RunnerWriteFenceToken,
): boolean {
  return current !== null
    && current.attemptId === expected.attemptId
    && current.generation === expected.generation
    && current.userId === expected.userId
    && current.workspaceVersion === expected.workspaceVersion;
}
