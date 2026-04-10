import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";
import { RunnerQueueStore } from "./runner-queue-store.js";

export class RunnerScheduler {
  constructor(
    private readonly queueStore: RunnerQueueStore,
    private readonly state: DurableObjectStateLike,
  ) {}

  async syncNextWake(preferredWakeAt: string | null = null): Promise<RunnerStateRecord> {
    const record = await this.queueStore.syncNextWake({ preferredWakeAt });
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
