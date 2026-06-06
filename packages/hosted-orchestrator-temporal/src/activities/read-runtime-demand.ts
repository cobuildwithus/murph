import type {
  HostedRuntimeDemand,
  HostedRuntimeDemandRequest,
} from "../index.js";
import {
  parseHostedRuntimeDemand,
  parseHostedRuntimeDemandRequest,
} from "@murphai/hosted-execution/parsers";

import {
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalWebEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

const HOSTED_RUNTIME_DEMAND_PATH_PREFIX =
  "/api/internal/hosted-orchestration/users/";
const HOSTED_RUNTIME_DEMAND_PATH_SUFFIX = "/demand";

export async function readRuntimeDemand(
  request: HostedRuntimeDemandRequest,
): Promise<HostedRuntimeDemand> {
  const parsedRequest = parseHostedRuntimeDemandRequest(request);
  const environment = readHostedOrchestratorTemporalWebEnvironment();

  return observeHostedTemporalActivity({
    activity: "readRuntimeDemand",
    userId: parsedRequest.userId,
  }, async () =>
    requestHostedOrchestratorJson(environment.hostedWebBaseUrl, {
      boundUserId: parsedRequest.userId,
      fetchImpl: fetch,
      label: "runtime demand",
      method: "GET",
      parse: parseHostedRuntimeDemand,
      path: buildHostedRuntimeDemandPath(parsedRequest.userId),
      search: buildHostedRuntimeDemandSearch(parsedRequest),
      signing: environment.hostedWebCallbackSigning,
      timeoutMs: environment.readRuntimeDemandTimeoutMs,
    })
  );
}

function buildHostedRuntimeDemandPath(userId: string): string {
  return `${HOSTED_RUNTIME_DEMAND_PATH_PREFIX}${encodeURIComponent(userId)}${
    HOSTED_RUNTIME_DEMAND_PATH_SUFFIX
  }`;
}

function buildHostedRuntimeDemandSearch(
  request: HostedRuntimeDemandRequest,
): string {
  const params = new URLSearchParams();

  if (request.manualRunRequested === true) {
    params.set("manualRunRequested", "1");
  }
  if (request.browserVaultRefreshRequested === true) {
    params.set("browserVaultRefreshRequested", "1");
  }
  if (request.lagRecoveryObserved === true) {
    params.set("lagRecoveryObserved", "1");
  }

  return params.toString();
}
