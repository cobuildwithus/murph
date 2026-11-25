import { readJsonObject } from "@/src/lib/http";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { isDeviceSyncAppConnectReturn } from "@murphai/device-syncd/types";
import { startNativeAuthorization } from "@/src/lib/clinical-records/control-plane";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withClinicalJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const body = await readJsonObject(request, { limitBytes: 4096 });
  if (typeof body.providerId !== "string" || !isDeviceSyncAppConnectReturn(body.appReturn)) {
    throw new RequestInputError("Invalid clinical connection request.");
  }
  return clinicalJsonOk(await startNativeAuthorization({
    auth, appReturn: body.appReturn, providerDirectoryEntryId: body.providerId, origin: new URL(request.url).origin,
  }));
});
