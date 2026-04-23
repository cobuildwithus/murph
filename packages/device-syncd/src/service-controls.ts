import { requireDeviceSyncServiceInternals } from "./service-internals.ts";

import type { DeviceSyncService } from "./service.ts";
import type {
  DisconnectAccountResult,
  QueueManualReconcileResult,
} from "./types.ts";

export function queueDeviceSyncManualReconcile(
  service: DeviceSyncService,
  accountId: string,
): QueueManualReconcileResult {
  try {
    return requireDeviceSyncServiceInternals(service).queueManualReconcileInternal(accountId);
  } catch (error) {
    const stubService = service as Partial<{
      queueManualReconcile(accountId: string): QueueManualReconcileResult;
    }>;

    if (typeof stubService.queueManualReconcile === "function") {
      return stubService.queueManualReconcile(accountId);
    }

    throw error;
  }
}

export async function disconnectDeviceSyncAccount(
  service: DeviceSyncService,
  accountId: string,
): Promise<DisconnectAccountResult> {
  try {
    return await requireDeviceSyncServiceInternals(service).disconnectAccountInternal(accountId);
  } catch (error) {
    const stubService = service as Partial<{
      disconnectAccount(accountId: string): Promise<DisconnectAccountResult>;
    }>;

    if (typeof stubService.disconnectAccount === "function") {
      return await stubService.disconnectAccount(accountId);
    }

    throw error;
  }
}
