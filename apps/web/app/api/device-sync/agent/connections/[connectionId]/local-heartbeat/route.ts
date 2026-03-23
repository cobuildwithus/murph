import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk, readOptionalJsonObject, resolveRouteParams } from "../../../../../../../src/lib/device-sync/http";

function isAllowedStatus(value: unknown): value is "active" | "reauthorization_required" | "disconnected" {
  return value === "active" || value === "reauthorization_required" || value === "disconnected";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const session = await controlPlane.requireAgentSession();
    const body = await readOptionalJsonObject(request);
    return jsonOk(
      await controlPlane.recordLocalHeartbeat(session.userId, decodeURIComponent(connectionId), {
        status: isAllowedStatus(body.status) ? body.status : undefined,
        lastSyncStartedAt: typeof body.lastSyncStartedAt === "string" ? body.lastSyncStartedAt : undefined,
        lastSyncCompletedAt: typeof body.lastSyncCompletedAt === "string" ? body.lastSyncCompletedAt : undefined,
        lastSyncErrorAt: typeof body.lastSyncErrorAt === "string" ? body.lastSyncErrorAt : undefined,
        lastErrorCode: typeof body.lastErrorCode === "string" || body.lastErrorCode === null ? body.lastErrorCode : undefined,
        lastErrorMessage:
          typeof body.lastErrorMessage === "string" || body.lastErrorMessage === null ? body.lastErrorMessage : undefined,
        nextReconcileAt: typeof body.nextReconcileAt === "string" || body.nextReconcileAt === null ? body.nextReconcileAt : undefined,
        clearError: body.clearError === true,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
