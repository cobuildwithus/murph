import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  jsonError,
  jsonOk,
  readOptionalJsonObject,
  redirectTo,
  resolveRouteParams,
} from "@/src/lib/device-sync/http";

interface HostedDeviceSyncProviderRouteParams extends Record<string, string> {
  provider: string;
}

export interface HostedDeviceSyncProviderRouteContext {
  params: Promise<HostedDeviceSyncProviderRouteParams>;
}

export async function hostedDeviceSyncConnectStartGet(
  request: Request,
  context: HostedDeviceSyncProviderRouteContext,
) {
  try {
    const { provider } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const user = controlPlane.requireAuthenticatedUser();
    const url = new URL(request.url);
    const result = await controlPlane.startConnection(
      user.id,
      decodeURIComponent(provider),
      url.searchParams.get("returnTo"),
    );
    return redirectTo(result.authorizationUrl);
  } catch (error) {
    return jsonError(error);
  }
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
