import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  jsonOk,
  readOptionalJsonObject,
  resolveDecodedRouteParam,
  withJsonError,
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

export const hostedDeviceSyncConnectStartPost = withJsonError(async (
  request: Request,
  context: HostedDeviceSyncProviderRouteContext,
) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  controlPlane.assertBrowserMutationOrigin();
  const user = await controlPlane.requireAuthenticatedUser();
  const body = await readOptionalJsonObject(request);
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : null;
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  return jsonOk(
    await controlPlane.startConnection(
      user.id,
      provider,
      returnTo,
    ),
  );
});
