import type { DurableObjectStateLike, RunnerStateRecord } from "./types.js";
import { RunnerStateStore } from "./runner-state-store.js";

export class RunnerRuntimeAlarmScheduler {
  constructor(
    private readonly stateStore: RunnerStateStore,
    private readonly state: DurableObjectStateLike,
    private readonly readExtraWakeAt: () => Promise<string | null> | string | null = () => null,
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
    const effectiveWakeAt = earliestIsoDate(
      nextWakeAt,
      await this.readExtraWakeAt(),
    );
    if (effectiveWakeAt) {
      await this.state.storage.setAlarm(new Date(effectiveWakeAt));
      return;
    }

    await this.state.storage.deleteAlarm?.();
  }
}

function readEarliestRunnerAlarmAt(record: RunnerStateRecord): string | null {
  return record.alarm?.dueAt ?? null;
}

function earliestIsoDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? left : right;
}
