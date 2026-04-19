import type { HostedWakeMaterializationHints } from "@murphai/hosted-execution";

import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";
import { RunnerStateStore } from "./runner-state-store.js";

export class RunnerWakeScheduler {
  constructor(
    private readonly stateStore: RunnerStateStore,
    private readonly state: DurableObjectStateLike,
  ) {}

  async syncNextWake(input: {
    preferredWakeAt?: string | null;
    wakeMaterializationHints?: HostedWakeMaterializationHints | null;
  } = {}): Promise<RunnerStateRecord> {
    const record = await this.stateStore.syncNextWake({
      preferredWakeAt: input.preferredWakeAt ?? null,
      ...(input.wakeMaterializationHints === undefined
        ? {}
        : { wakeMaterializationHints: input.wakeMaterializationHints }),
    });
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
