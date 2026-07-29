import { DurableObject } from "cloudflare:workers";

import {
  DatabaseHealthMonitor,
  type DatabaseHealthMonitorEnvironment,
  type DatabaseHealthMonitorResult,
} from "../database-health/monitor.js";
import type { DatabaseHealthStoredSample } from "../database-health/store.js";
import type { DurableObjectStateLike } from "../user-runner/types.js";

export class DatabaseHealthDurableObject extends DurableObject {
  private readonly monitor: DatabaseHealthMonitor;

  constructor(
    state: DurableObjectStateLike,
    environment: DatabaseHealthMonitorEnvironment,
  ) {
    super(state as never, environment as never);
    this.monitor = new DatabaseHealthMonitor(state.storage, environment);
  }

  async runScheduledCheck(input?: {
    scheduledAtMs?: number;
  }): Promise<DatabaseHealthMonitorResult> {
    return await this.monitor.runScheduledCheck(input?.scheduledAtMs);
  }

  readRecentSamples(input?: {
    limit?: number;
  }): DatabaseHealthStoredSample[] {
    return this.monitor.readRecentSamples(input?.limit);
  }
}
