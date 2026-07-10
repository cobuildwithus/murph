import type {
  HostedRuntimeReconciliationFacts,
  HostedRuntimeReconciliationFactsRequest,
} from "../index.js";
import {
  parseHostedRuntimeReconciliationFacts,
  parseHostedRuntimeReconciliationFactsRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_RECONCILIATION_FACTS_HTTP_TIMEOUT_MS,
} from "@murphai/hosted-execution/temporal-env";

import {
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalWebEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

const HOSTED_RUNTIME_RECONCILIATION_FACTS_PATH_PREFIX =
  "/api/internal/hosted-orchestration/users/";
const HOSTED_RUNTIME_RECONCILIATION_FACTS_PATH_SUFFIX =
  "/reconciliation-facts";

export async function readRuntimeReconciliationFacts(
  request: HostedRuntimeReconciliationFactsRequest,
): Promise<HostedRuntimeReconciliationFacts> {
  const parsedRequest = parseHostedRuntimeReconciliationFactsRequest(request);
  const environment = readHostedOrchestratorTemporalWebEnvironment();

  return observeHostedTemporalActivity({
    activity: "readRuntimeReconciliationFacts",
    userId: parsedRequest.userId,
  }, async () =>
    requestHostedOrchestratorJson(environment.hostedWebBaseUrl, {
      boundUserId: parsedRequest.userId,
      fetchImpl: fetch,
      label: "runtime reconciliation facts",
      method: "GET",
      parse: parseHostedRuntimeReconciliationFacts,
      path: buildHostedRuntimeReconciliationFactsPath(parsedRequest.userId),
      signing: environment.hostedWebCallbackSigning,
      timeoutMs: HOSTED_RUNTIME_RECONCILIATION_FACTS_HTTP_TIMEOUT_MS,
    })
  );
}

function buildHostedRuntimeReconciliationFactsPath(userId: string): string {
  return `${HOSTED_RUNTIME_RECONCILIATION_FACTS_PATH_PREFIX}${
    encodeURIComponent(userId)
  }${HOSTED_RUNTIME_RECONCILIATION_FACTS_PATH_SUFFIX}`;
}
