import { requireDeviceSyncServiceInternals } from "./service-internals.ts";

import type { DeviceSyncService } from "./service.ts";

export interface DeviceSyncServiceTestingHooks {
  replaceDrainWorkerForTesting(drainWorker: (limit?: number) => Promise<number>): () => void;
  runWorkerBatchOnce(): Promise<void>;
  setSchedulerTickInFlight(value: boolean): void;
  setWorkerTickInFlight(value: boolean): void;
}

export function getDeviceSyncServiceTestingHooks(service: DeviceSyncService): DeviceSyncServiceTestingHooks {
  const controller = requireDeviceSyncServiceInternals(service);

  return {
    replaceDrainWorkerForTesting(drainWorker) {
      const previousDrainWorker = controller.drainWorker;
      controller.drainWorker = drainWorker;
      return () => {
        controller.drainWorker = previousDrainWorker;
      };
    },
    runWorkerBatchOnce: () => controller.runWorkerBatchOnceInternal(),
    setSchedulerTickInFlight(value) {
      controller.schedulerTickInFlight = value;
    },
    setWorkerTickInFlight(value) {
      controller.workerTickInFlight = value;
    },
  };
}
