import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { captureHostedVaultShareProjectionBestEffort } from "./hosted-runtime/vault-share-projection.ts";

export type HostedVaultShareCaptureWorkerInput =
  Parameters<typeof captureHostedVaultShareProjectionBestEffort>[0];

if (!isMainThread && parentPort) {
  parentPort.postMessage(await captureHostedVaultShareProjectionBestEffort(
    workerData as HostedVaultShareCaptureWorkerInput,
  ));
}
