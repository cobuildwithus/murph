import { clinicalRecordsError } from "./errors";
import {
  readHostedRuntimeWriteFence,
  type HostedRuntimeWriteFence,
} from "../hosted-execution/runtime-write-fence";

export type ClinicalRecordsRuntimeWriteFence = HostedRuntimeWriteFence;

/**
 * Mirrors the runner write fence that Cloudflare proves before proxying a
 * Clinical Records operation. The signed callback still binds the member and
 * body; these headers prove the request traversed the active runtime lane.
 */
export function requireClinicalRecordsRuntimeWriteFence(
  request: Request,
): ClinicalRecordsRuntimeWriteFence {
  const fence = readHostedRuntimeWriteFence(request);
  if (!fence) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_RUNTIME_WRITE_FENCE_REQUIRED",
      httpStatus: 401,
      message: "Clinical Records runtime access requires the active runtime write fence.",
    });
  }

  return fence;
}
