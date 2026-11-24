import { setTimeout as delay } from "node:timers/promises";

const DEVICE_SYNC_MAINTENANCE_MODULE_LOAD_FAILED_CODE =
  "device-sync-maintenance-module-load-failed";

export type HostedDeviceSyncMaintenanceModule = typeof import("./device-sync-maintenance.ts");

export class HostedDeviceSyncMaintenanceModuleLoadError extends Error {
  readonly code = DEVICE_SYNC_MAINTENANCE_MODULE_LOAD_FAILED_CODE;

  constructor(cause: unknown) {
    super("Failed to load hosted device-sync maintenance module.", { cause });
    this.name = "HostedDeviceSyncMaintenanceModuleLoadError";
  }
}

let hostedDeviceSyncMaintenanceModulePromise:
  | Promise<HostedDeviceSyncMaintenanceModule>
  | null = null;

export async function loadHostedDeviceSyncMaintenanceModule(input: {
  shouldDeferFirstLoad?: (() => boolean) | null;
  shouldStop: () => boolean;
}): Promise<HostedDeviceSyncMaintenanceModule | null> {
  // The first import evaluates the provider SDK on the foreground event loop.
  // Once started, every caller can join the same load without delaying sync I/O.
  while (!hostedDeviceSyncMaintenanceModulePromise) {
    if (input.shouldStop()) return null;
    if (input.shouldDeferFirstLoad?.()) {
      await delay(100);
      continue;
    }
    const nextModulePromise = import("./device-sync-maintenance.ts").catch((error: unknown) => {
      if (hostedDeviceSyncMaintenanceModulePromise === nextModulePromise) {
        hostedDeviceSyncMaintenanceModulePromise = null;
      }
      throw new HostedDeviceSyncMaintenanceModuleLoadError(error);
    });
    hostedDeviceSyncMaintenanceModulePromise = nextModulePromise;
  }

  return await hostedDeviceSyncMaintenanceModulePromise;
}

export function isHostedDeviceSyncMaintenanceModuleLoadError(
  error: unknown,
): error is HostedDeviceSyncMaintenanceModuleLoadError {
  return error instanceof Error
    && error.name === "HostedDeviceSyncMaintenanceModuleLoadError"
    && "code" in error
    && error.code === DEVICE_SYNC_MAINTENANCE_MODULE_LOAD_FAILED_CODE;
}
