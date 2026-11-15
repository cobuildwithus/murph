import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import {
  parseHostedExecutionDeviceSyncNoDataOutreachRequest,
} from "@murphai/device-syncd/hosted-runtime";

import {
  configureHostedSourceNoDataOutreach,
} from "@/src/lib/device-sync/source-no-data-outreach-preference";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

const BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  try {
    return jsonOk(await configureHostedSourceNoDataOutreach({
      memberId: userId,
      request: parseInput(payload, parseHostedExecutionDeviceSyncNoDataOutreachRequest),
    }));
  } catch (error) {
    if (isHostedOnboardingError(error) && error.code === "INVALID_REQUEST" && error.httpStatus === 400) {
      throw new RequestInputError(error.message, { cause: error });
    }
    throw error;
  }
});
