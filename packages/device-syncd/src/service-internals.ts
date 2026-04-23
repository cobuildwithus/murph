import type {
  DisconnectAccountResult,
  QueueManualReconcileResult,
} from "./types.ts";
import type { DeviceSyncService } from "./service.ts";

export interface DeviceSyncServiceInternals {
  disconnectAccountInternal(accountId: string): Promise<DisconnectAccountResult>;
  drainWorker(limit?: number): Promise<number>;
  queueManualReconcileInternal(accountId: string): QueueManualReconcileResult;
  runWorkerBatchOnceInternal(): Promise<void>;
  schedulerTickInFlight: boolean;
  workerTickInFlight: boolean;
}

const serviceInternalsByService = new WeakMap<DeviceSyncService, DeviceSyncServiceInternals>();

export function registerDeviceSyncServiceInternals(
  service: DeviceSyncService,
  internals: DeviceSyncServiceInternals,
): void {
  serviceInternalsByService.set(service, internals);
}

export function requireDeviceSyncServiceInternals(service: DeviceSyncService): DeviceSyncServiceInternals {
  const internals = serviceInternalsByService.get(service);

  if (!internals) {
    throw new TypeError("Unknown device sync service instance.");
  }

  return internals;
}
