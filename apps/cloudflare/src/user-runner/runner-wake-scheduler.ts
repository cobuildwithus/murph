import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";
import { RunnerStateStore } from "./runner-state-store.js";

export class RunnerWakeScheduler {
  constructor(
    private readonly stateStore: RunnerStateStore,
    private readonly state: DurableObjectStateLike,
  ) {}

  async syncNextWake(preferredWakeAt: string | null = null): Promise<RunnerStateRecord> {
    const record = await this.stateStore.syncNextWake({ preferredWakeAt });
    await this.applyAlarm(record.nextWakeAt);
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
