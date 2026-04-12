import {
  buildCloudflareHostedControlSharePackPath,
} from "@murphai/cloudflare-hosted-control/routes";
import type { SharePack } from "@murphai/contracts";
import { parseHostedExecutionSharePack } from "@murphai/hosted-execution/parsers";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "../hosted-execution/auth-adapter";
import { readHostedExecutionControlBaseUrl } from "../hosted-execution/environment";
import { createHostedExecutionWebJsonRequester } from "../hosted-execution/request-client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedSharePackClient {
  deleteSharePack(userId: string, shareId: string): Promise<void>;
  putSharePack(userId: string, shareId: string, pack: SharePack): Promise<SharePack>;
}

export function requireHostedSharePackClient(): HostedSharePackClient {
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  const requester = createHostedExecutionWebJsonRequester({
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
  });

  return {
    async deleteSharePack(userId, shareId) {
      await requester.requestJson({
        allowNotFound: true,
        body: undefined,
        label: "delete share pack",
        method: "DELETE",
        parse: () => undefined,
        path: buildCloudflareHostedControlSharePackPath(userId, shareId),
      });
    },
    async putSharePack(userId, shareId, pack) {
      const response = await requester.requestJson({
        body: JSON.stringify(parseHostedExecutionSharePack(pack)),
        label: "share pack write",
        method: "PUT",
        parse: parseHostedExecutionSharePack,
        path: buildCloudflareHostedControlSharePackPath(userId, shareId),
      });

      if (!response) {
        throw new TypeError("Hosted share pack write returned no payload.");
      }

      return response;
    },
  };
}
