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

export async function loadHostedDeviceSyncMaintenanceModule(): Promise<HostedDeviceSyncMaintenanceModule> {
  if (!hostedDeviceSyncMaintenanceModulePromise) {
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
