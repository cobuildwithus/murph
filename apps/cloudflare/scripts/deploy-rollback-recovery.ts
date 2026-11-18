import { isDeepStrictEqual } from "node:util";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import { assertRecoveryWorkerInventory, assertRecoveryWorkerVersion } from "./deploy-retired-inference-secrets.ts";
import { readWorkerRunnerDeployment } from "./stage-runner-release.ts";

interface RecoveryWorker {
  id: string;
  tag: string;
  version: unknown;
}

/** Permit a previously serving source only for an exact rollback of compatibility
 * stages for one rejected in-place candidate. The caller rebinds retained secrets
 * from the live version before activation. */
export async function verifyRecoverySources(input: {
  currentVersion: unknown; currentVersionId: string; currentDeploymentCreatedOn: string;
  sources: RecoveryWorker[]; assertRollbackHistory: () => Promise<void>;
}): Promise<boolean> {
  if (!input.sources.length) return false;
  const isRollback = input.sources.every(({ version }) => {
    const metadata = isObjectRecord(version) ? version.metadata : undefined;
    return isObjectRecord(metadata) && typeof metadata.created_on === "string"
      && Date.parse(metadata.created_on) < Date.parse(input.currentDeploymentCreatedOn);
  });
  for (const source of input.sources) {
    const check = { ...input, recoveryVersion: source.version, recoveryVersionId: source.id, recoveryVersionTag: source.tag };
    if (isRollback) assertRecoveryWorkerInventory(check);
    else assertRecoveryWorkerVersion(check);
  }
  if (!isRollback) return false;

  const stable = readWorkerRunnerDeployment(input.currentVersion);
  const stages = input.sources.map(({ version }) => readWorkerRunnerDeployment(version));
  const rejected = stages[0]?.candidate;
  if (!stable || stable.candidate || !stable.active.image || !stable.active.executionIdentity || !rejected?.releaseSha
    || !rejected.image || !rejected.executionIdentity || stable.active.id !== rejected.id || stable.active.bank !== rejected.bank
    || rejected.releaseSha === stable.active.releaseSha || !stages.every(stage => stage &&
      isDeepStrictEqual(stage.active, stable.active) && isDeepStrictEqual(stage.previous, stable.previous)
      && isDeepStrictEqual(stage.candidate, rejected))) {
    throw new Error("Recovery Worker never-activated provenance is unproven and the versions are not matching rejected stages.");
  }
  await input.assertRollbackHistory();
  return true;
}
