import type { RunnerWriteFenceToken } from "./runner-state-store.js";
import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";

export class RunnerAlarmCoordinator {
  constructor(private readonly state: DurableObjectStateLike) {}

  async sync(_record: RunnerStateRecord): Promise<void> {
    await this.clearAlarm();
  }

  async clearAlarm(): Promise<void> {
    await this.state.storage.deleteAlarm?.();
  }
}

export function readRunnerNextAlarmAt(_record: RunnerStateRecord): string | null {
  return null;
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
