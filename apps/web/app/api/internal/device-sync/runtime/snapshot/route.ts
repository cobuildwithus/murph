import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murph/hosted-execution";

import {
  buildHostedDeviceSyncRuntimeSnapshot,
  parseHostedDeviceSyncRuntimeSnapshotRequest,
} from "@/src/lib/device-sync/internal-runtime";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { requireHostedExecutionInternalToken } from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";

export async function POST(request: Request) {
  try {
    requireHostedExecutionInternalToken(request);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const body = await readJsonObject(request);
    const snapshotRequest = parseHostedDeviceSyncRuntimeSnapshotRequest(
      body,
      request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER),
    );
    await controlPlane.ensureHostedWebhookAdminUpkeepForRuntimeSnapshot(snapshotRequest);
    const snapshot = await buildHostedDeviceSyncRuntimeSnapshot(controlPlane.store, snapshotRequest);
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(error);
  }
}
