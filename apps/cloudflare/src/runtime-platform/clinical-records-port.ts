import type {
  HostedRuntimeClinicalRecordsPort,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_RESPONSE_MAX_BYTES,
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES,
} from "@murphai/hosted-execution/clinical-records-boundary";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

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
    async createConnectLink(options) {
      const {
        hostedClinicalRecordsConnectLinkRequestSchema,
        parseHostedClinicalRecordsConnectLinkResponse,
      } = await import("@murphai/hosted-execution/clinical-records");
      const payload = await fetchHostedWebControlPlaneJson({
        body: hostedClinicalRecordsConnectLinkRequestSchema.parse({
          ...(options?.requestKey ? { requestKey: options.requestKey } : {}),
        }),
        boundUserId: input.boundUserId,
        description: "Hosted clinical records connect link",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
        replayOnceOnRetryableFailure: options?.requestKey !== undefined,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_CONNECT_LINK_RESPONSE_MAX_BYTES,
        },
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      const result = parseHostedClinicalRecordsConnectLinkResponse(payload);
      if (
        input.transport.mode === "direct"
        && new URL(result.connectUrl).origin
          !== new URL(input.transport.webControlBaseUrl).origin
      ) {
        throw new TypeError(
          "Hosted clinical records connect link must use the configured Web origin.",
        );
      }
      return result;
    },
    async fetchPage(request, options) {
      const {
        parseHostedClinicalRecordsFetchPageRequest,
        parseHostedClinicalRecordsFetchPageResponse,
      } = await import("@murphai/hosted-execution/clinical-records");
      const parsedRequest = parseHostedClinicalRecordsFetchPageRequest(request);
      const payload = await fetchHostedWebControlPlaneJson({
        body: parsedRequest,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records fetch page",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES,
        },
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedClinicalRecordsFetchPageResponse(payload);
    },
    async readRun(request, options) {
      const {
        parseHostedClinicalRecordsReadRunRequest,
        parseHostedClinicalRecordsReadRunResponse,
      } = await import("@murphai/hosted-execution/clinical-records");
      const parsedRequest = parseHostedClinicalRecordsReadRunRequest(request);
      const payload = await fetchHostedWebControlPlaneJson({
        body: parsedRequest,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records read run",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_METADATA_RESPONSE_MAX_BYTES,
        },
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedClinicalRecordsReadRunResponse(payload);
    },
    async recordOutcome(request, options) {
      const {
        parseHostedClinicalRecordsRecordOutcomeResponse,
        parseHostedClinicalRecordsRecordOutcomeRequest,
      } = await import("@murphai/hosted-execution/clinical-records");
      const parsedRequest = parseHostedClinicalRecordsRecordOutcomeRequest(request);
      const payload = await fetchHostedWebControlPlaneJson({
        body: parsedRequest,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records record outcome",
        fetchImpl: input.fetchImpl,
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_METADATA_RESPONSE_MAX_BYTES,
        },
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      parseHostedClinicalRecordsRecordOutcomeResponse(payload);
    },
  };
}
