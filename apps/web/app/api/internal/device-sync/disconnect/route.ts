import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  hostedDeviceDisconnectRequestSchema,
  type HostedDeviceDisconnectResponse,
} from "@murphai/device-syncd/hosted-runtime";
import { RequestInputError } from "@murphai/hosted-execution/request-input";

import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  assertActiveHostedMemberAccessAllowed,
  isHostedThreadContainerMember,
} from "@/src/lib/hosted-onboarding/member-access";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 2_048 });
  const parsed = hostedDeviceDisconnectRequestSchema.safeParse(payload);
  if (!parsed.success) throw new RequestInputError("Disconnect requires one device connection ID.");
  if (await isHostedThreadContainerMember({ memberId: userId })) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_DISCONNECT_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
      message: "Wearable accounts can only be disconnected in private.",
      retryable: false,
    });
  }
  await assertActiveHostedMemberAccessAllowed({ memberId: userId });
  const result = await createHostedDeviceSyncPublicIngressService(request).disconnectOwnedConnection(userId, parsed.data.connectionId);
  return jsonOk({
    status: result.connection.status !== "disconnected" ? "not_finished"
      : result.alreadyDisconnected ? "already_disconnected" : "disconnected",
  } satisfies HostedDeviceDisconnectResponse);
});
