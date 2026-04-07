import {
  buildHostedExecutionUserDeviceSyncRuntimePath,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "../hosted-execution/auth-adapter";
import { readHostedExecutionControlBaseUrl } from "../hosted-execution/environment";
import { createHostedExecutionWebJsonRequester } from "../hosted-execution/request-client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedDeviceSyncRuntimeClient {
  applyDeviceSyncRuntimeUpdates(
    userId: string,
    input: Omit<HostedExecutionDeviceSyncRuntimeApplyRequest, "userId">,
  ): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  getDeviceSyncRuntimeSnapshot(
    userId: string,
    input?: Omit<HostedExecutionDeviceSyncRuntimeSnapshotRequest, "userId">,
  ): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
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
        label: "device-sync runtime apply",
        method: "POST",
        parse: parseHostedExecutionDeviceSyncRuntimeApplyResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimePath(userId),
      });

      if (!response) {
        throw new TypeError("Hosted execution device-sync runtime apply returned no payload.");
      }

      return response;
    },
    async getDeviceSyncRuntimeSnapshot(userId, input = {}) {
      const search = new URLSearchParams();

      if (input.connectionId) {
        search.set("connectionId", input.connectionId);
      }

      if (input.provider) {
        search.set("provider", input.provider);
      }

      const response = await requester.requestJson({
        label: "device-sync runtime snapshot",
        method: "GET",
        parse: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimePath(userId),
        search: search.size > 0 ? search.toString() : null,
      });

      if (!response) {
        throw new TypeError("Hosted execution device-sync runtime snapshot returned no payload.");
      }

      return response;
    },
  };
}

export function requireHostedDeviceSyncRuntimeClient(): HostedDeviceSyncRuntimeClient {
  const client = readHostedDeviceSyncRuntimeClientIfConfigured();

  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  return client;
}
