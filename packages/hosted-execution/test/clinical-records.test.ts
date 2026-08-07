import { describe, expect, it } from "vitest";

import {
  CLINICAL_FHIR_RESOURCE_TYPES,
  clinicalFhirRetrievalScopeSchema,
} from "@murphai/clinical-records";
import {
  HOSTED_CLINICAL_RECORDS_MAX_RESOURCE_FAMILIES,
  HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
  buildHostedExecutionClinicalRecordsSyncRequestedWake,
  hostedClinicalRecordsConnectLinkRequestSchema,
  hostedClinicalRecordsFetchPageRequestSchema,
  hostedClinicalRecordsRetrievalScopeSchema,
  parseHostedClinicalRecordsFetchPageResponse,
  parseHostedClinicalRecordsConnectLinkResponse,
  parseHostedClinicalRecordsReadRunResponse,
  parseHostedClinicalRecordsRecordOutcomeRequest,
  parseHostedClinicalRecordsRunDescriptor,
  parseHostedClinicalRecordsSyncRequestedWake,
} from "../src/clinical-records.ts";
import {
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_WAKE_KINDS,
} from "../src/contracts.ts";
import {
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
} from "../src/parsers.ts";
import {
  HOSTED_MAILBOX_KINDS,
} from "../src/runtime-control.ts";

const HASH = "a".repeat(64);

describe("clinical records hosted execution contracts", () => {
  it("accepts only the bounded first-party connect-link shape", () => {
    const claim = `cr_${"a".repeat(32)}`;
    const response = {
      connectUrl: `https://app.example.test/records/connect#clinicalRecordsIntent=${claim}`,
      expiresAt: "2026-07-10T12:15:00.000Z",
      ok: true,
    };

    expect(hostedClinicalRecordsConnectLinkRequestSchema.parse({})).toEqual({});
    expect(hostedClinicalRecordsConnectLinkRequestSchema.parse({
      requestKey: `scheduled_${HASH}`,
    })).toEqual({ requestKey: `scheduled_${HASH}` });
    expect(() => hostedClinicalRecordsConnectLinkRequestSchema.parse({
      requestKey: `ain_${"b".repeat(32)}`,
    })).toThrow();

    expect(parseHostedClinicalRecordsConnectLinkResponse(response)).toEqual(response);
    expect(parseHostedClinicalRecordsConnectLinkResponse({
      connectUrl:
        "https://app.example.test/records/connect?launch=clinical-records",
      expiresAt: null,
      ok: true,
    })).toMatchObject({ expiresAt: null, ok: true });
    expect(parseHostedClinicalRecordsConnectLinkResponse({
      ...response,
      connectUrl: `http://127.0.0.1:3000/records/connect#clinicalRecordsIntent=${claim}`,
    })).toMatchObject({ ok: true });

    for (const connectUrl of [
      `ftp://app.example.test/records/connect#clinicalRecordsIntent=${claim}`,
      `http://app.example.test/records/connect#clinicalRecordsIntent=${claim}`,
      `https://app.example.test/settings#clinicalRecordsIntent=${claim}`,
      `https://app.example.test/records/connect?claim=${claim}#clinicalRecordsIntent=${claim}`,
      "https://app.example.test/records/connect?launch=other",
      "https://app.example.test/records/connect?launch=clinical-records&memberId=other",
      "https://app.example.test/records/connect#clinicalRecordsIntent=invalid",
      `https://app.example.test/records/connect#clinicalRecords%49ntent=${claim}`,
      `https://app.example.test/records/connect#clinicalRecordsIntent=${claim}&memberId=other`,
    ]) {
      expect(() => parseHostedClinicalRecordsConnectLinkResponse({
        ...response,
        connectUrl,
      })).toThrow("Hosted clinical records connect URL is invalid");
    }
    expect(() => parseHostedClinicalRecordsConnectLinkResponse({
      ...response,
      accessToken: "not-allowed",
    })).toThrow();
  });

  it("round-trips the pointer-only system wake through active runtime routing", () => {
    const wake = buildHostedExecutionClinicalRecordsSyncRequestedWake({
      eventId: "clinical-sync-1",
      generation: 2,
      occurredAt: "2026-07-10T12:00:00.000Z",
      runId: "clinical_run_1",
      userId: "member_1",
    });

    expect(parseHostedClinicalRecordsSyncRequestedWake(wake)).toEqual(wake);
    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(parseHostedExecutionEvent({
      generation: 2,
      kind: "clinical-records.sync-requested",
      runId: "clinical_run_1",
      userId: "member_1",
    })).toEqual({
      generation: 2,
      kind: "clinical-records.sync-requested",
      runId: "clinical_run_1",
      userId: "member_1",
    });
    expect(HOSTED_EXECUTION_EVENT_KINDS).toContain("clinical-records.sync-requested");
    expect(HOSTED_EXECUTION_WAKE_KINDS).toContain("clinical-records.sync-requested");
    expect(HOSTED_MAILBOX_KINDS).toContain("clinical-records.sync-requested");
  });

  it("rejects credential and raw-record fields from the wake envelope", () => {
    expect(() => parseHostedExecutionWake({
      accessToken: "not-allowed",
      eventId: "clinical-sync-1",
      generation: 1,
      kind: "clinical-records.sync-requested",
      occurredAt: "2026-07-10T12:00:00.000Z",
      runId: "clinical_run_1",
      userId: "member_1",
    })).toThrow();
    expect(() => parseHostedExecutionEvent({
      generation: 0,
      kind: "clinical-records.sync-requested",
      runId: "clinical_run_1",
      userId: "member_1",
    })).toThrow(/positive safe integer/u);
    expect(() => parseHostedExecutionEvent({
      generation: 1,
      kind: "clinical-records.sync-requested",
      runId: "https://ehr.example.test/fhir/Patient/1",
      userId: "member_1",
    })).toThrow();
  });

  it("parses a bounded retrieval descriptor without provider credentials or URLs", () => {
    const descriptor = {
      connectionId: "connection_1",
      fetchedAt: "2026-07-10T12:00:00.000Z",
      fhirBaseUrlHash: HASH,
      generation: 1,
      grantedScopes: ["patient/*.read"],
      patientIdHash: HASH,
      requestedScopes: ["patient/*.read"],
      retrievalJobId: "job_1",
      retrievalScopes: [{
        coverage: "bounded-window",
        from: "2025-07-10T12:00:00.000Z",
        queryFingerprint: HASH,
        resourceType: "Observation",
        to: "2026-07-10T12:00:00.000Z",
      }],
      runId: "clinical_run_1",
      sourceSystem: "epic-fhir",
    };

    expect(parseHostedClinicalRecordsRunDescriptor(descriptor)).toMatchObject({
      generation: 1,
      runId: "clinical_run_1",
      sourceSystem: "epic-fhir",
    });
    expect(() => parseHostedClinicalRecordsRunDescriptor({
      ...descriptor,
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: HASH,
        resourceType: "UnsupportedResource",
      }],
    })).toThrow();
    expect(() => parseHostedClinicalRecordsRunDescriptor({
      ...descriptor,
      sourceSystem: "unsupported-fhir",
    })).toThrow();
  });

  it("parses query-aware descriptors and requires page requests to name the slice", () => {
    const descriptor = {
      connectionId: "connection_1",
      fetchedAt: "2026-07-10T12:00:00.000Z",
      fhirBaseUrlHash: HASH,
      generation: 1,
      grantedScopes: ["patient/Observation.read"],
      patientIdHash: HASH,
      requestedScopes: ["patient/Observation.read"],
      retrievalJobId: "job_1",
      retrievalProtocol: "query-slices-v2",
      retrievalSlices: ["observation-labs", "observation-vitals"].map((queryScopeId, index) => ({
        coverage: "whole-family",
        queryFingerprint: String(index + 1).repeat(64),
        queryScopeId,
        resourceType: "Observation",
        sliceId: "whole",
      })),
      runId: "clinical_run_1",
      sourceSystem: "epic-fhir",
    };
    expect(parseHostedClinicalRecordsRunDescriptor(descriptor)).toEqual(descriptor);
    expect(hostedClinicalRecordsFetchPageRequestSchema.parse({
      cursor: null,
      generation: 1,
      queryFingerprint: "2".repeat(64),
      queryScopeId: "observation-vitals",
      requestId: "request_1",
      resourceType: "Observation",
      retrievalProtocol: "query-slices-v2",
      runId: "clinical_run_1",
      sliceId: "whole",
    })).toMatchObject({ queryScopeId: "observation-vitals" });
    expect(hostedClinicalRecordsFetchPageRequestSchema.parse({
      cursor: null,
      generation: 1,
      queryScopeId: "observation-vitals",
      requestId: "request_from_prior_runner",
      resourceType: "Observation",
      retrievalProtocol: "query-slices-v2",
      runId: "clinical_run_1",
      sliceId: "whole",
    })).toMatchObject({
      queryScopeId: "observation-vitals",
      sliceId: "whole",
    });
    expect(() => hostedClinicalRecordsFetchPageRequestSchema.parse({
      cursor: null,
      generation: 1,
      requestId: "request_1",
      resourceType: "Observation",
      retrievalProtocol: "query-slices-v2",
      runId: "clinical_run_1",
    })).toThrow();
  });

  it("reuses canonical clinical domain validation at the hosted boundary", () => {
    expect(hostedClinicalRecordsRetrievalScopeSchema)
      .toBe(clinicalFhirRetrievalScopeSchema);
    expect(HOSTED_CLINICAL_RECORDS_MAX_RESOURCE_FAMILIES)
      .toBe(CLINICAL_FHIR_RESOURCE_TYPES.length);

    const descriptor = {
      connectionId: "connection_1",
      fetchedAt: "2026-07-10T12:00:00.000Z",
      fhirBaseUrlHash: HASH,
      generation: 1,
      grantedScopes: ["patient/*.read"],
      patientIdHash: HASH,
      requestedScopes: ["patient/*.read"],
      retrievalJobId: "job_1",
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: HASH,
        resourceType: "Observation",
      }],
      runId: "clinical_run_1",
      sourceSystem: "epic-fhir",
    };

    expect(() => parseHostedClinicalRecordsRunDescriptor({
      ...descriptor,
      sourceSystem: "unsupported-fhir",
    })).toThrow();
    expect(() => parseHostedClinicalRecordsRunDescriptor({
      ...descriptor,
      retrievalScopes: [{
        ...descriptor.retrievalScopes[0],
        resourceType: "Medication",
      }],
    })).toThrow();
    expect(() => parseHostedClinicalRecordsRunDescriptor({
      ...descriptor,
      fetchedAt: "2026-02-30T12:00:00.000Z",
    })).toThrow();
  });

  it("fails closed on extra run fields and malformed fetch responses", () => {
    expect(() => parseHostedClinicalRecordsRunDescriptor({
      accessToken: "not-allowed",
      connectionId: "connection_1",
      fetchedAt: "2026-07-10T12:00:00.000Z",
      fhirBaseUrlHash: HASH,
      generation: 1,
      grantedScopes: [],
      patientIdHash: HASH,
      requestedScopes: [],
      retrievalJobId: "job_1",
      retrievalScopes: [{
        coverage: "whole-family",
        queryFingerprint: HASH,
        resourceType: "Patient",
      }],
      runId: "clinical_run_1",
      sourceSystem: "epic-fhir",
    })).toThrow();

    expect(() => parseHostedClinicalRecordsFetchPageResponse({
      body: "{}",
      nextCursor: null,
      rawUrl: "not-allowed",
      status: "page",
    })).toThrow();
  });

  it("distinguishes ready runs from retryable and terminal pointer misses", () => {
    expect(parseHostedClinicalRecordsReadRunResponse({
      errorCode: "stale_generation",
      retryable: false,
      status: "unavailable",
    })).toEqual({
      errorCode: "stale_generation",
      retryable: false,
      status: "unavailable",
    });
    expect(() => parseHostedClinicalRecordsReadRunResponse({
      accessToken: "not-allowed",
      errorCode: "temporarily_unavailable",
      retryable: true,
      status: "unavailable",
    })).toThrow();
  });

  it("parses a bounded durable outcome and rejects extra or oversized fields", () => {
    const request = {
      counts: {
        createdCount: 1,
        executableDecisionCount: 1,
        fetchedPageCount: 2,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 3,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      runId: "clinical_run_1",
      status: "completed",
    };

    expect(parseHostedClinicalRecordsRecordOutcomeRequest(request)).toEqual(request);
    expect(() => parseHostedClinicalRecordsRecordOutcomeRequest({
      ...request,
      rawClinicalData: "not-allowed",
    })).toThrow("unsupported field");
    expect(() => parseHostedClinicalRecordsRecordOutcomeRequest({
      ...request,
      counts: {
        ...request.counts,
        rawFileCount: 1_000_001,
      },
    })).toThrow("count is invalid");

    expect(parseHostedClinicalRecordsRecordOutcomeRequest({
      ...request,
      retrievalProtocol: "query-slices-v2",
      retrievalSlices: [{
        queryScopeId: "laboratory-observations",
        sliceId: "whole",
      }],
    })).toMatchObject({
      retrievalProtocol: "query-slices-v2",
      retrievalSlices: [{
        queryScopeId: "laboratory-observations",
        sliceId: "whole",
      }],
    });
    expect(() => parseHostedClinicalRecordsRecordOutcomeRequest({
      ...request,
      retrievalProtocol: "query-slices-v2",
    })).toThrow("retrieval identity is invalid");
    expect(() => parseHostedClinicalRecordsRecordOutcomeRequest({
      ...request,
      retrievalSlices: [{
        queryScopeId: "laboratory-observations",
        sliceId: "whole",
      }],
    })).toThrow("retrieval identity is invalid");

    const maximumQueryOutcome = {
      ...request,
      retrievalProtocol: "query-slices-v2",
      retrievalSlices: Array.from({ length: 80 }, (_, index) => ({
        queryScopeId: `q${String(index).padStart(2, "0")}_${"a".repeat(116)}`,
        sliceId: `s${String(index).padStart(2, "0")}_${"b".repeat(116)}`,
      })),
    };
    const maximumQueryOutcomeBytes = Buffer.byteLength(
      JSON.stringify(maximumQueryOutcome),
      "utf8",
    );
    expect(maximumQueryOutcomeBytes).toBeGreaterThan(8 * 1_024);
    expect(maximumQueryOutcomeBytes).toBeLessThan(
      HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
    );
    expect(
      parseHostedClinicalRecordsRecordOutcomeRequest(maximumQueryOutcome)
        .retrievalSlices,
    ).toHaveLength(80);
  });
});
