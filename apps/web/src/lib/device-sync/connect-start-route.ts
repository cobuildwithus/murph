import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  jsonError,
  jsonOk,
  readOptionalJsonObject,
  resolveRouteParams,
} from "@/src/lib/device-sync/http";

interface HostedDeviceSyncProviderRouteParams extends Record<string, string> {
  provider: string;
}

export interface HostedDeviceSyncProviderRouteContext {
  params: Promise<HostedDeviceSyncProviderRouteParams>;
}

export async function hostedDeviceSyncConnectStartGet(
  _request: Request,
  _context: HostedDeviceSyncProviderRouteContext,
) {
  return Response.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Hosted device-sync connect/start routes only allow POST because starting a connection mutates server state.",
      },
    },
    {
      status: 405,
      headers: {
        allow: "POST",
      },
    },
  );
}

export async function hostedDeviceSyncConnectStartPost(
  request: Request,
  context: HostedDeviceSyncProviderRouteContext,
) {
  try {
    const { provider } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    controlPlane.assertBrowserMutationOrigin();
    const user = controlPlane.requireAuthenticatedUser();
    const body = await readOptionalJsonObject(request);
    const returnTo = typeof body.returnTo === "string" ? body.returnTo : null;
    return jsonOk(
      await controlPlane.startConnection(
        user.id,
        decodeURIComponent(provider),
        returnTo,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
