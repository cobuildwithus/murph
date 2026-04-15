import {
  buildHostedExecutionUserDeviceSyncRuntimePath,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncRuntimeApplyRequest,
} from "@murphai/device-syncd/hosted-runtime";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "../hosted-execution/auth-adapter";
import { readHostedExecutionControlBaseUrl } from "../hosted-execution/environment";
import { createHostedExecutionWebJsonRequester } from "../hosted-execution/request-client";

export interface HostedDeviceSyncRuntimeClient {
  applyDeviceSyncRuntimeUpdates(
    userId: string,
    input: Omit<HostedExecutionDeviceSyncRuntimeApplyRequest, "userId">,
  ): Promise<void>;
}

export function readHostedDeviceSyncRuntimeClientIfConfigured(): HostedDeviceSyncRuntimeClient | null {
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const requester = createHostedExecutionWebJsonRequester({
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
  });

  return {
    async applyDeviceSyncRuntimeUpdates(userId, input) {
      const requestPayload = {
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        updates: input.updates,
        userId,
      } satisfies HostedExecutionDeviceSyncRuntimeApplyRequest;

      const response = await requester.requestJson({
        body: JSON.stringify(requestPayload),
        boundUserId: userId,
        label: "device-sync runtime projection apply",
        method: "POST",
        parse: parseHostedExecutionDeviceSyncRuntimeApplyResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimePath(userId),
      });

      if (!response) {
        throw new TypeError("Hosted execution device-sync runtime projection apply returned no payload.");
      }
    },
  };
}
