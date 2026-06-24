import type { RunnerWriteFenceToken } from "./runner-state-store.js";
import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";
import {
  readWorkspaceSnapshotOrphanCandidateNextAlarmAt,
} from "./workspace-snapshot-sessions.js";

export class RunnerAlarmCoordinator {
  constructor(private readonly state: DurableObjectStateLike) {}

  async sync(record: RunnerStateRecord): Promise<void> {
    const nextOrphanCleanupAt = await readWorkspaceSnapshotOrphanCandidateNextAlarmAt({
      state: this.state,
      userId: record.userId,
    });
    if (nextOrphanCleanupAt !== null) {
      await this.state.storage.setAlarm(nextOrphanCleanupAt);
      return;
    }
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
  return runnerWriteFenceIdentityMatches(current, expected)
    && current?.workspaceVersion === expected.workspaceVersion;
}

export function runnerWriteFenceIdentityMatches(
  current: RunnerWriteFenceToken | null,
  expected: RunnerWriteFenceToken,
): boolean {
  return current !== null
    && current.attemptId === expected.attemptId
    && current.generation === expected.generation
    && current.kind === expected.kind
    && current.userId === expected.userId;
}
