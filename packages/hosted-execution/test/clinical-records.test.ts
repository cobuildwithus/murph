import { describe, expect, it } from "vitest";

import {
  parseHostedClinicalRecordsFetchPageResponse,
  parseHostedClinicalRecordsReadRunResponse,
  parseHostedClinicalRecordsRunDescriptor,
} from "../src/clinical-records.ts";
import {
  buildHostedExecutionClinicalRecordsSyncRequestedWake,
} from "../src/builders.ts";
import {
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
} from "../src/parsers.ts";
import {
  HOSTED_MAILBOX_KINDS,
} from "../src/runtime-control.ts";

const HASH = "a".repeat(64);

describe("clinical records hosted execution contracts", () => {
  it("round-trips the pointer-only system wake", () => {
    const wake = buildHostedExecutionClinicalRecordsSyncRequestedWake({
      eventId: "clinical-sync-1",
      generation: 2,
      occurredAt: "2026-07-10T12:00:00.000Z",
      runId: "clinical_run_1",
      userId: "member_1",
    });

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
    })).toThrow(/unsupported field/u);
    expect(() => parseHostedExecutionEvent({
      generation: 0,
      kind: "clinical-records.sync-requested",
      runId: "clinical_run_1",
      userId: "member_1",
    })).toThrow(/positive safe integer/u);
  });

  it("parses a bounded retrieval descriptor without provider credentials or URLs", () => {
    expect(parseHostedClinicalRecordsRunDescriptor({
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
    })).toMatchObject({
      generation: 1,
      runId: "clinical_run_1",
      sourceSystem: "epic-fhir",
    });
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
});
