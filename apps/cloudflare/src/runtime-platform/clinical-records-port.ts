import type {
  HostedRuntimeClinicalRecordsPort,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  parseHostedClinicalRecordsFetchPageResponse,
  parseHostedClinicalRecordsReadRunResponse,
  parseHostedClinicalRecordsRecordOutcomeResponse,
} from "@murphai/hosted-execution/clinical-records";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export const HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES =
  (2 * HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS) + (64 * 1024);
const HOSTED_CLINICAL_RECORDS_METADATA_RESPONSE_MAX_BYTES = 64 * 1024;

export function createHostedWebClinicalRecordsPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): HostedRuntimeClinicalRecordsPort {
  if (input.transport.mode === "direct" && !input.transport.workspaceCheckpointBridge) {
    throw new TypeError(
      "Hosted clinical records runtime callbacks require active write-fence authority.",
    );
  }

  return {
    async fetchPage(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records fetch page",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES,
        },
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedClinicalRecordsFetchPageResponse(payload);
    },
    async readRun(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records read run",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_METADATA_RESPONSE_MAX_BYTES,
        },
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedClinicalRecordsReadRunResponse(payload);
    },
    async recordOutcome(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records record outcome",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_METADATA_RESPONSE_MAX_BYTES,
        },
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      parseHostedClinicalRecordsRecordOutcomeResponse(payload);
    },
  };
}
