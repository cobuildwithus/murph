import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";
import { RunnerStateStore } from "./runner-state-store.js";

export class RunnerRuntimeAlarmScheduler {
  constructor(
    private readonly stateStore: RunnerStateStore,
    private readonly state: DurableObjectStateLike,
  ) {}

  async syncNextWake(input: {
    preferredWakeAt?: string | null;
  } = {}): Promise<RunnerStateRecord> {
    const record = await this.stateStore.syncNextWake({
      preferredWakeAt: input.preferredWakeAt ?? null,
    });
    await this.applyAlarm(readEarliestRunnerAlarmAt(record));
    return record;
  }

  async syncStoredAlarm(): Promise<RunnerStateRecord> {
    const record = await this.stateStore.readState();
    await this.applyAlarm(readEarliestRunnerAlarmAt(record));
    return record;
  }

  private async applyAlarm(nextWakeAt: string | null): Promise<void> {
    if (nextWakeAt) {
      await this.state.storage.setAlarm(new Date(nextWakeAt));
      return;
    }

    await this.state.storage.deleteAlarm?.();
  }
}

function readEarliestRunnerAlarmAt(record: RunnerStateRecord): string | null {
  return record.alarm?.dueAt ?? null;
}
