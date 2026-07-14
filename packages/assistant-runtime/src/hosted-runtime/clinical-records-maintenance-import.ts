const CLINICAL_RECORDS_MAINTENANCE_MODULE_LOAD_FAILED_CODE =
  "clinical-records-maintenance-module-load-failed";

export type HostedClinicalRecordsMaintenanceModule =
  typeof import("./clinical-records-maintenance.ts");

export class HostedClinicalRecordsMaintenanceModuleLoadError extends Error {
  readonly code = CLINICAL_RECORDS_MAINTENANCE_MODULE_LOAD_FAILED_CODE;

  constructor(cause: unknown) {
    super("Failed to load hosted clinical records maintenance module.", { cause });
    this.name = "HostedClinicalRecordsMaintenanceModuleLoadError";
  }
}

let hostedClinicalRecordsMaintenanceModulePromise:
  | Promise<HostedClinicalRecordsMaintenanceModule>
  | null = null;

export async function loadHostedClinicalRecordsMaintenanceModule(): Promise<
  HostedClinicalRecordsMaintenanceModule
> {
  if (!hostedClinicalRecordsMaintenanceModulePromise) {
    const nextModulePromise = import("./clinical-records-maintenance.ts").catch(
      (error: unknown) => {
        if (hostedClinicalRecordsMaintenanceModulePromise === nextModulePromise) {
          hostedClinicalRecordsMaintenanceModulePromise = null;
        }
        throw new HostedClinicalRecordsMaintenanceModuleLoadError(error);
      },
    );
    hostedClinicalRecordsMaintenanceModulePromise = nextModulePromise;
  }

  return await hostedClinicalRecordsMaintenanceModulePromise;
}
