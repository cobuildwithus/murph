import type {
  HostedRuntimeClinicalRecordsPort,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_RESPONSE_MAX_BYTES,
  HOSTED_CLINICAL_RECORDS_FETCH_DOCUMENT_RESPONSE_MAX_BYTES,
  HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES,
  ORACLE_LIFETIME_PAGE_CALLBACK_MS, ORACLE_LIFETIME_PAGE_HEADER,
} from "@murphai/hosted-execution/clinical-records-boundary";
import { HOSTED_EXECUTION_RUNNER_COMMIT_RESPONSE_MARGIN_MS } from "@murphai/hosted-execution/contracts";

import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
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
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.clinicalRecordsConnectLink,
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
    async fetchDocument(request, options) {
      const {
        parseHostedClinicalRecordsFetchDocumentRequest,
        parseHostedClinicalRecordsFetchDocumentResponse,
      } = await import("@murphai/hosted-execution/clinical-records");
      const payload = await fetchHostedWebControlPlaneJson({
        body: parseHostedClinicalRecordsFetchDocumentRequest(request),
        boundUserId: input.boundUserId,
        description: "Hosted clinical records fetch document",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.clinicalRecordsFetchDocument,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_FETCH_DOCUMENT_RESPONSE_MAX_BYTES,
        },
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });
      return parseHostedClinicalRecordsFetchDocumentResponse(payload);
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
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.clinicalRecordsFetchPage,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES,
        },
        signal: options?.signal ?? null,
        headers: options?.oracleLifetimeSearch ? new Headers({ [ORACLE_LIFETIME_PAGE_HEADER]: "1" }) : undefined,
        // The Worker waits up to the lifetime callback; the runner outlasts it by the commit margin.
        timeoutMs: options?.oracleLifetimeSearch
          ? Math.max(input.timeoutMs, ORACLE_LIFETIME_PAGE_CALLBACK_MS + HOSTED_EXECUTION_RUNNER_COMMIT_RESPONSE_MARGIN_MS)
          : input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedClinicalRecordsFetchPageResponse(payload);
    },
    async readNotification(request, options) {
      const { clinicalNotificationDecisionSchema, clinicalNotificationRequestSchema } =
        await import("@murphai/hosted-execution/clinical-records");
      const payload = await fetchHostedWebControlPlaneJson({
        body: clinicalNotificationRequestSchema.parse({ ...request, purpose: "notification" }),
        boundUserId: input.boundUserId, description: "Hosted clinical notification policy", fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.clinicalRecordsReadRun,
        sensitiveResponseBody: { maxBytes: HOSTED_CLINICAL_RECORDS_METADATA_RESPONSE_MAX_BYTES },
        signal: options?.signal ?? null, timeoutMs: input.timeoutMs, transport: input.transport,
      });
      return clinicalNotificationDecisionSchema.parse(payload);
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
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.clinicalRecordsReadRun,
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
        parseHostedClinicalCheckpointRequest,
      } = await import("@murphai/hosted-execution/clinical-records");
      const parsedRequest = parseHostedClinicalCheckpointRequest(request);
      const payload = await fetchHostedWebControlPlaneJson({
        body: parsedRequest,
        boundUserId: input.boundUserId,
        description: "Hosted clinical records record outcome",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.clinicalRecordsRecordOutcome,
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
