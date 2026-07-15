import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
} from "@murphai/clinical-records";
import type {
  HostedClinicalRecordsRunDescriptor,
} from "@murphai/hosted-execution/clinical-records";
import {
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
} from "@murphai/hosted-execution/clinical-records";
import {
  readClinicalFhirRetrievalCheckpointForRun,
  writeClinicalFhirRetrievalCheckpoint,
} from "@murphai/vault-usecases/clinical-records";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runHostedClinicalRecordsSyncWakeLane,
} from "../src/hosted-runtime/clinical-records-maintenance.ts";
import type {
  HostedRuntimeClinicalRecordsPort,
} from "../src/hosted-runtime/platform.ts";

const HASH = "a".repeat(64);
const RUN: HostedClinicalRecordsRunDescriptor = {
  connectionId: "connection_1",
  fetchedAt: "2026-07-10T12:00:00.000Z",
  fhirBaseUrlHash: HASH,
  generation: 1,
  grantedScopes: ["patient/Observation.read"],
  patientIdHash: HASH,
  requestedScopes: ["patient/Observation.read"],
  retrievalJobId: "clinical_run_1",
  retrievalScopes: [{
    coverage: "whole-family",
    queryFingerprint: HASH,
    resourceType: "Observation",
  }],
  runId: "clinical_run_1",
  sourceSystem: "epic-fhir",
};
const WAKE = {
  eventId: "clinical-sync-1",
  generation: 1,
  kind: "clinical-records.sync-requested" as const,
  occurredAt: "2026-07-10T12:00:00.000Z",
  runId: "clinical_run_1",
  userId: "member_1",
};

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-runtime-"));
});

afterEach(async () => {
  await rm(vaultRoot, { force: true, recursive: true });
});

describe("hosted clinical records maintenance", () => {
  it("fetches finite opaque-cursor pages, imports once, and records bounded counts", async () => {
    const nextPageUrl = "https://ehr.example.test/fhir/Observation?page=2";
    const nextPageUrlHash = createHash("sha256").update(nextPageUrl).digest("hex");
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        body: JSON.stringify({
          entry: [],
          link: [{ relation: "next", url: nextPageUrl }],
          resourceType: "Bundle",
        }),
        nextCursor: "opaque-cursor-2",
        nextPageUrlHash,
        status: "page",
      })
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: null,
        pageUrlHash: nextPageUrlHash,
        status: "page",
      });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn().mockResolvedValue({
      canonical: {
        applied: true,
        createdCount: 2,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      executableDecisionCount: 2,
      manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
      rawFileCount: 3,
      reviewDecisionCount: 0,
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cursor: null,
      generation: 1,
      resourceType: "Observation",
      runId: "clinical_run_1",
    }), expect.objectContaining({ signal: null }));
    expect(fetchPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: "opaque-cursor-2",
    }), expect.objectContaining({ signal: null }));
    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      completedResourceTypes: ["Observation"],
      pages: [
        expect.objectContaining({ nextPageUrlHash, resourceType: "Observation" }),
        expect.objectContaining({ pageUrlHash: nextPageUrlHash, resourceType: "Observation" }),
      ],
    }));
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        createdCount: 2,
        fetchedPageCount: 2,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 3,
      }),
      status: "completed",
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("persists typed evidence and a partial outcome for a terminal family error", async () => {
    const port = createPort({
      fetchPage: vi.fn().mockResolvedValue({
        errorCode: "provider_denied",
        retryable: false,
        status: "unavailable",
      }),
    });
    const importSnapshot = vi.fn().mockResolvedValue({
      canonical: {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      executableDecisionCount: 0,
      manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
      rawFileCount: 1,
      reviewDecisionCount: 0,
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      completedResourceTypes: [],
      errors: [{
        code: "provider_denied",
        message: "Provider did not return this FHIR resource family.",
        resourceType: "Observation",
      }],
      pages: [],
    }));
    expect(result.outcome).toEqual(expect.objectContaining({
      errorCode: "provider_denied",
      status: "partial",
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
  });

  it("persists partial evidence but leaves a web-terminalized reauthorization run untouched", async () => {
    const port = createPort({
      fetchPage: vi.fn()
        .mockResolvedValueOnce({
          body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
          nextCursor: "opaque-cursor-2",
          nextPageUrlHash: "b".repeat(64),
          status: "page",
        })
        .mockResolvedValueOnce({
          errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
          retryable: false,
          status: "unavailable",
        }),
    });
    const importSnapshot = vi.fn().mockResolvedValue({
      canonical: {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      executableDecisionCount: 0,
      manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
      rawFileCount: 1,
      reviewDecisionCount: 0,
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      errors: [expect.objectContaining({
        code: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
      })],
      pages: [],
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
  });

  it("records unattempted families when authorization ends during a multi-family run", async () => {
    const multiFamilyRun: HostedClinicalRecordsRunDescriptor = {
      ...RUN,
      retrievalScopes: [
        RUN.retrievalScopes[0]!,
        {
          coverage: "whole-family",
          queryFingerprint: "b".repeat(64),
          resourceType: "Condition",
        },
        {
          coverage: "whole-family",
          queryFingerprint: "c".repeat(64),
          resourceType: "MedicationRequest",
        },
      ],
    };
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: null,
        status: "page",
      })
      .mockResolvedValueOnce({
        errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
        retryable: false,
        status: "unavailable",
      });
    const readRun = vi.fn()
      .mockResolvedValueOnce({ run: multiFamilyRun, status: "ready" })
      .mockResolvedValueOnce({
        errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
        retryable: false,
        status: "unavailable",
      });
    const port = createPort({ fetchPage, readRun });
    const importSnapshot = vi.fn<
      NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>
    >(async (snapshot) => {
      await snapshot.assertCurrent?.();
      return {
        canonical: {
          applied: false,
          createdCount: 0,
          retractedCount: 0,
          skippedExistingCount: 0,
          supersededCount: 0,
        },
        executableDecisionCount: 0,
        manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
        rawFileCount: 3,
        reviewDecisionCount: 0,
      };
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(readRun).toHaveBeenCalledTimes(2);
    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      completedResourceTypes: ["Observation"],
      errors: [
        {
          code: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
          message: "Provider did not return this FHIR resource family.",
          resourceType: "Condition",
        },
        {
          code: "not-attempted",
          message: "Retrieval was not attempted after provider authorization ended.",
          resourceType: "MedicationRequest",
        },
      ],
      pages: [expect.objectContaining({ resourceType: "Observation" })],
      retrievalScopes: multiFamilyRun.retrievalScopes,
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
  });

  it("does not overwrite authorization-required when retained evidence is rejected", async () => {
    const multiFamilyRun: HostedClinicalRecordsRunDescriptor = {
      ...RUN,
      retrievalScopes: [
        RUN.retrievalScopes[0]!,
        {
          coverage: "whole-family",
          queryFingerprint: "b".repeat(64),
          resourceType: "Condition",
        },
      ],
    };
    const port = createPort({
      fetchPage: vi.fn()
        .mockResolvedValueOnce({
          body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
          nextCursor: null,
          status: "page",
        })
        .mockResolvedValueOnce({
          errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
          retryable: false,
          status: "unavailable",
        }),
      readRun: vi.fn().mockResolvedValue({ run: multiFamilyRun, status: "ready" }),
    });
    const importSnapshot = vi.fn().mockRejectedValue(
      Object.assign(new Error("safe semantic rejection"), {
        code: "CLINICAL_FHIR_SNAPSHOT_REJECTED",
      }),
    );

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      completedResourceTypes: ["Observation"],
      errors: [expect.objectContaining({
        code: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
        resourceType: "Condition",
      })],
    }));
    expect(result).toEqual(expect.objectContaining({
      outcome: null,
      status: "failed",
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    await expect(readClinicalFhirRetrievalCheckpointForRun({
      identity: WAKE,
      vaultRoot,
    })).resolves.toBeNull();
  });

  it("retries transient control-plane misses without recording a terminal outcome", async () => {
    const port = createPort({
      readRun: vi.fn().mockResolvedValue({
        errorCode: "temporarily_unavailable",
        retryable: true,
        status: "unavailable",
      }),
    });

    await expect(runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot: vi.fn(),
      vaultRoot,
      wake: WAKE,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORDS_RUN_RETRYABLE" });
    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("rejects a run descriptor that does not match its mailbox pointer", async () => {
    const port = createPort({
      readRun: vi.fn().mockResolvedValue({
        run: { ...RUN, generation: RUN.generation + 1 },
        status: "ready",
      }),
    });
    const importSnapshot = vi.fn();

    await expect(runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORDS_RUN_POINTER_MISMATCH" });

    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("retries a transient page miss without importing or recording a terminal outcome", async () => {
    const port = createPort({
      fetchPage: vi.fn().mockResolvedValue({
        errorCode: "temporarily_unavailable",
        retryable: true,
        status: "unavailable",
      }),
    });
    const importSnapshot = vi.fn();

    await expect(runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORDS_PAGE_RETRYABLE" });

    expect(importSnapshot).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("fails a repeated opaque cursor before fetching the same page a third time", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
      nextCursor: "repeated-cursor",
      status: "page",
    });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: 2 }),
      errorCode: "cursor_cycle",
      status: "failed",
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("fails a logical page-URL cycle even when every opaque cursor is distinct", async () => {
    const firstPageUrlHash = "a".repeat(64);
    const secondPageUrlHash = "b".repeat(64);
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: "randomized-cursor-1",
        nextPageUrlHash: firstPageUrlHash,
        status: "page",
      })
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: "randomized-cursor-2",
        nextPageUrlHash: secondPageUrlHash,
        pageUrlHash: firstPageUrlHash,
        status: "page",
      })
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: "randomized-cursor-3",
        nextPageUrlHash: firstPageUrlHash,
        pageUrlHash: secondPageUrlHash,
        status: "page",
      });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: 3 }),
      errorCode: "cursor_cycle",
      status: "failed",
    }));
    expect(result.status).toBe("failed");
  });

  it("fails a three-byte page whose encoded bytes exceed the raw-file cap", async () => {
    const port = createPort({
      fetchPage: vi.fn().mockResolvedValue({
        body: "漢".repeat(Math.floor(CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES / 3) + 1),
        nextCursor: null,
        status: "page",
      }),
    });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(result.status).toBe("failed");
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      errorCode: "page_size_exceeded",
      status: "failed",
    }));
  });

  it("fails before import when individually bounded pages exceed the snapshot byte cap", async () => {
    const body = JSON.stringify({
      entry: [],
      padding: "x".repeat(CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES - 100),
      resourceType: "Bundle",
    });
    const pageBodyBytes = Buffer.byteLength(body, "utf8");
    const pageCount = Math.floor(
      HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES / pageBodyBytes,
    ) + 1;
    let fetchedPageCount = 0;
    const fetchPage = vi.fn(async () => {
      fetchedPageCount += 1;
      return {
        body,
        nextCursor: fetchedPageCount < pageCount
          ? `opaque-cursor-${fetchedPageCount + 1}`
          : null,
        status: "page" as const,
      };
    });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn();

    expect(pageBodyBytes).toBeLessThanOrEqual(CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES);

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(pageCount);
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: pageCount }),
      errorCode: "snapshot_size_exceeded",
      status: "failed",
    }));
    expect(result.status).toBe("failed");
  });

  it.each([
    {
      body: "not-json",
      errorCode: "invalid_fhir_page",
      label: "malformed FHIR JSON",
    },
    {
      body: createFhirBundleBody(CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE + 1),
      errorCode: "page_resource_limit_exceeded",
      label: "a page above the resource cap",
    },
  ])("rejects $label before import", async ({ body, errorCode }) => {
    const port = createPort({
      fetchPage: vi.fn().mockResolvedValue({
        body,
        nextCursor: null,
        status: "page",
      }),
    });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: 1 }),
      errorCode,
      status: "failed",
    }));
    expect(result.status).toBe("failed");
  });

  it("accepts exactly the snapshot resource cap across pages and imports it once", async () => {
    const fullPageBody = createFhirBundleBody(
      CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    );
    const pageCount = Math.floor(
      CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES
        / CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    );
    const fetchPage = vi.fn();
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      fetchPage.mockResolvedValueOnce({
        body: fullPageBody,
        nextCursor: pageIndex + 1 < pageCount
          ? `opaque-cursor-${pageIndex + 2}`
          : null,
        status: "page",
      });
    }
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn().mockResolvedValue({
      canonical: {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      executableDecisionCount: 0,
      manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
      rawFileCount: pageCount + 1,
      reviewDecisionCount: 0,
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(pageCount);
    expect(importSnapshot).toHaveBeenCalledOnce();
    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      pages: Array.from({ length: pageCount }, () =>
        expect.objectContaining({ resourceType: "Observation" })
      ),
    }));
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: pageCount }),
      status: "completed",
    }));
    expect(result.status).toBe("completed");
  });

  it("fails before import when the next page would exceed the snapshot resource cap", async () => {
    const fullPageBody = createFhirBundleBody(
      CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    );
    const pageCountAtLimit = Math.floor(
      CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES
        / CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    );
    const fetchPage = vi.fn();
    for (let pageIndex = 0; pageIndex < pageCountAtLimit; pageIndex += 1) {
      fetchPage.mockResolvedValueOnce({
        body: fullPageBody,
        nextCursor: `opaque-cursor-${pageIndex + 2}`,
        status: "page",
      });
    }
    fetchPage.mockResolvedValueOnce({
      body: createFhirBundleBody(1),
      nextCursor: null,
      status: "page",
    });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(pageCountAtLimit + 1);
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: pageCountAtLimit + 1 }),
      errorCode: "snapshot_resource_limit_exceeded",
      status: "failed",
    }));
    expect(result.status).toBe("failed");
  });

  it("keeps discarded family resources charged to the run-wide resource cap", async () => {
    const conditionScope = {
      coverage: "whole-family",
      queryFingerprint: "b".repeat(64),
      resourceType: "Condition",
    } satisfies HostedClinicalRecordsRunDescriptor["retrievalScopes"][number];
    const multiFamilyRun: HostedClinicalRecordsRunDescriptor = {
      ...RUN,
      retrievalScopes: [RUN.retrievalScopes[0]!, conditionScope],
    };
    const fullObservationPage = createFhirBundleBody(
      CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    );
    const fullConditionPage = createFhirBundleBody(
      CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
      "Condition",
    );
    const conditionPageCount = Math.floor(
      CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES
        / CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
    );
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        body: fullObservationPage,
        nextCursor: "observation-cursor-2",
        status: "page",
      })
      .mockResolvedValueOnce({
        body: fullObservationPage,
        nextCursor: "observation-cursor-3",
        status: "page",
      })
      .mockResolvedValueOnce({
        errorCode: "provider_denied",
        retryable: false,
        status: "unavailable",
      });
    for (let pageIndex = 0; pageIndex < conditionPageCount; pageIndex += 1) {
      fetchPage.mockResolvedValueOnce({
        body: fullConditionPage,
        nextCursor: pageIndex + 1 < conditionPageCount
          ? `condition-cursor-${pageIndex + 2}`
          : null,
        status: "page",
      });
    }
    const port = createPort({
      fetchPage,
      readRun: vi.fn().mockResolvedValue({ run: multiFamilyRun, status: "ready" }),
    });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        fetchedPageCount: conditionPageCount + 1,
      }),
      errorCode: "snapshot_resource_limit_exceeded",
      status: "failed",
    }));
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("does not reset the absolute page-fetch cap when a partial family is discarded", async () => {
    const conditionScope = {
      coverage: "whole-family",
      queryFingerprint: "b".repeat(64),
      resourceType: "Condition",
    } satisfies HostedClinicalRecordsRunDescriptor["retrievalScopes"][number];
    const multiFamilyRun: HostedClinicalRecordsRunDescriptor = {
      ...RUN,
      retrievalScopes: [RUN.retrievalScopes[0]!, conditionScope],
    };
    let fetchCallCount = 0;
    const fetchPage = vi.fn(async () => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        return {
          body: createFhirBundleBody(0),
          nextCursor: "observation-cursor-2",
          status: "page" as const,
        };
      }
      if (fetchCallCount === 2) {
        return {
          errorCode: "provider_denied",
          retryable: false,
          status: "unavailable" as const,
        };
      }
      return {
        body: createFhirBundleBody(0, "Condition"),
        nextCursor: `condition-cursor-${fetchCallCount}`,
        status: "page" as const,
      };
    });
    const port = createPort({
      fetchPage,
      readRun: vi.fn().mockResolvedValue({ run: multiFamilyRun, status: "ready" }),
    });
    const importSnapshot = vi.fn();

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(fetchPage).toHaveBeenCalledTimes(HOSTED_CLINICAL_RECORDS_MAX_PAGES);
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        fetchedPageCount: HOSTED_CLINICAL_RECORDS_MAX_PAGES - 1,
      }),
      errorCode: "page_limit_exceeded",
      status: "failed",
    }));
    expect(result.status).toBe("failed");
  });

  it("consumes stale terminal pointers without fetching or rewriting outcomes", async () => {
    const port = createPort({
      readRun: vi.fn().mockResolvedValue({
        errorCode: "stale_generation",
        retryable: false,
        status: "unavailable",
      }),
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot: vi.fn(),
      vaultRoot,
      wake: WAKE,
    });

    expect(result.status).toBe("unavailable");
    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("turns deterministic importer rejection into one checkpointed terminal outcome", async () => {
    const port = createPort();
    const privateResourceId = "private-resource-id";
    const importSnapshot = vi.fn().mockRejectedValue(
      Object.assign(
        new Error("Clinical FHIR snapshot failed semantic validation.", {
          cause: new Error(`Conflicting external reference includes ${privateResourceId}.`),
        }),
        { code: "CLINICAL_FHIR_SNAPSHOT_REJECTED" },
      ),
    );

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(result).toMatchObject({
      outcome: {
        errorCode: "snapshot_rejected",
        generation: 1,
        runId: "clinical_run_1",
        status: "failed",
      },
      status: "failed",
    });
    expect(JSON.stringify(result)).not.toContain(privateResourceId);
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("fails closed when web revokes the run at the vault write boundary", async () => {
    const readRun = vi.fn()
      .mockResolvedValueOnce({ run: RUN, status: "ready" })
      .mockResolvedValueOnce({
        errorCode: "connection-inactive",
        retryable: false,
        status: "unavailable",
      });
    const port = createPort({ readRun });
    const importSnapshot = vi.fn<
      NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>
    >(async (snapshot) => {
      await snapshot.assertCurrent?.();
      throw new Error("Revoked authority must stop the import.");
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      vaultRoot,
      wake: WAKE,
    });

    expect(result).toEqual({
      counts: {
        createdCount: 0,
        executableDecisionCount: 0,
        fetchedPageCount: 0,
        fetchedResourceFamilyCount: 0,
        rawFileCount: 0,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      outcome: null,
      status: "unavailable",
    });
    expect(readRun).toHaveBeenCalledTimes(2);
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("does not overwrite a web-terminalized authorization-required read", async () => {
    const port = createPort({
      readRun: vi.fn().mockResolvedValue({
        errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
        retryable: false,
        status: "unavailable",
      }),
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot: vi.fn(),
      vaultRoot,
      wake: WAKE,
    });

    expect(result.status).toBe("unavailable");
    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("resumes completed families after authorization terminalization and import preemption", async () => {
    const multiFamilyRun: HostedClinicalRecordsRunDescriptor = {
      ...RUN,
      retrievalScopes: [
        RUN.retrievalScopes[0]!,
        {
          coverage: "whole-family",
          queryFingerprint: "b".repeat(64),
          resourceType: "Condition",
        },
        {
          coverage: "whole-family",
          queryFingerprint: "c".repeat(64),
          resourceType: "MedicationRequest",
        },
      ],
    };
    const { completedPage } = await seedPartialClinicalCheckpoint(multiFamilyRun);
    const terminalAuthorization = {
      errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
      retryable: false,
      status: "unavailable" as const,
    };
    const port = createPort({
      readRun: vi.fn().mockResolvedValue(terminalAuthorization),
    });
    let shouldYield = false;
    let importAttempt = 0;
    let successfulImports = 0;
    let firstImportAuthorized: (() => void) | undefined;
    const firstImportReachedAuthorityCheck = new Promise<void>((resolve) => {
      firstImportAuthorized = resolve;
    });
    const importSnapshot = vi.fn<
      NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>
    >(async (snapshot) => {
      importAttempt += 1;
      await snapshot.assertCurrent?.();
      if (importAttempt === 1) {
        firstImportAuthorized?.();
        return await new Promise<never>((_resolve, reject) => {
          const signal = snapshot.signal;
          if (!signal) {
            reject(new Error("Expected a Clinical Records cancellation signal."));
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      successfulImports += 1;
      return {
        canonical: {
          applied: true,
          createdCount: 1,
          retractedCount: 0,
          skippedExistingCount: 0,
          supersededCount: 0,
        },
        executableDecisionCount: 1,
        manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
        rawFileCount: 2,
        reviewDecisionCount: 0,
      };
    });

    const interrupted = runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => shouldYield,
      vaultRoot,
      wake: WAKE,
    });
    await firstImportReachedAuthorityCheck;
    shouldYield = true;
    await expect(interrupted).rejects.toMatchObject({ name: "AbortError" });

    const retained = await readClinicalFhirRetrievalCheckpointForRun({
      identity: WAKE,
      vaultRoot,
    });
    expect(retained).toMatchObject({
      checkpoint: {
        authorizationRequired: true,
        completedResourceTypes: ["Observation"],
        currentResourceIndex: 3,
        errors: [
          {
            code: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
            resourceType: "Condition",
          },
          { code: "not-attempted", resourceType: "MedicationRequest" },
        ],
        pages: [{ content: completedPage, resourceType: "Observation" }],
      },
      identity: multiFamilyRun,
    });

    shouldYield = false;
    const completed = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => shouldYield,
      vaultRoot,
      wake: WAKE,
    });

    expect(completed).toMatchObject({
      counts: { createdCount: 1, fetchedResourceFamilyCount: 1 },
      outcome: null,
      status: "partial",
    });
    expect(successfulImports).toBe(1);
    expect(importSnapshot).toHaveBeenCalledTimes(2);
    for (const [snapshot] of importSnapshot.mock.calls) {
      expect(snapshot).toMatchObject({
        completedResourceTypes: ["Observation"],
        pages: [{ content: completedPage, resourceType: "Observation" }],
      });
    }
    await expect(readClinicalFhirRetrievalCheckpointForRun({
      identity: WAKE,
      vaultRoot,
    })).resolves.toBeNull();
    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it.each(["connection-inactive", "run-generation-stale"])(
    "rejects a retained authorization checkpoint when web authority becomes %s",
    async (authorityErrorCode) => {
      const multiFamilyRun: HostedClinicalRecordsRunDescriptor = {
        ...RUN,
        retrievalScopes: [
          RUN.retrievalScopes[0]!,
          {
            coverage: "whole-family",
            queryFingerprint: "b".repeat(64),
            resourceType: "Condition",
          },
        ],
      };
      await seedPartialClinicalCheckpoint(multiFamilyRun);
      const readRun = vi.fn()
        .mockResolvedValueOnce({
          errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
          retryable: false,
          status: "unavailable",
        })
        .mockResolvedValueOnce({
          errorCode: authorityErrorCode,
          retryable: false,
          status: "unavailable",
        });
      let simulatedRawWrites = 0;
      let simulatedCanonicalWrites = 0;
      const importSnapshot = vi.fn<
        NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>
      >(async (snapshot) => {
        await snapshot.assertCurrent?.();
        simulatedRawWrites += 1;
        simulatedCanonicalWrites += 1;
        throw new Error("Revoked authority must stop the import.");
      });

      const result = await runHostedClinicalRecordsSyncWakeLane({
        clinicalRecordsPort: createPort({ readRun }),
        importSnapshot,
        vaultRoot,
        wake: WAKE,
      });

      expect(result).toEqual(unavailableClinicalRecordsResult());
      expect(simulatedRawWrites).toBe(0);
      expect(simulatedCanonicalWrites).toBe(0);
      await expect(readClinicalFhirRetrievalCheckpointForRun({
        identity: WAKE,
        vaultRoot,
      })).resolves.toBeNull();
    },
  );

  it("preempts before reading and leaves the durable mailbox item retryable", async () => {
    const port = createPort();

    await expect(runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot: vi.fn(),
      shouldYieldClinicalRecords: () => true,
      vaultRoot,
      wake: WAKE,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORDS_FOREGROUND_PREEMPTED" });
    expect(port.readRun).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("aborts an in-flight control-plane read when foreground work arrives", async () => {
    let shouldYield = false;
    const readRun = vi.fn<HostedRuntimeClinicalRecordsPort["readRun"]>(
      async (_request, options) => await new Promise<never>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) {
          reject(new Error("Expected a Clinical Records cancellation signal."));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    );
    const port = createPort({ readRun });

    const sync = runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot: vi.fn(),
      shouldYieldClinicalRecords: () => shouldYield,
      vaultRoot,
      wake: WAKE,
    });
    await vi.waitFor(() => expect(readRun).toHaveBeenCalledOnce());
    shouldYield = true;

    await expect(sync).rejects.toMatchObject({ name: "AbortError" });
    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("aborts an in-flight vault import when foreground work arrives", async () => {
    let shouldYield = false;
    const importSnapshot = vi.fn<
      NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>
    >(async (snapshot) => await new Promise<never>((_resolve, reject) => {
      const signal = snapshot.signal;
      if (!signal) {
        reject(new Error("Expected a Clinical Records cancellation signal."));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const port = createPort();

    const sync = runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => shouldYield,
      vaultRoot,
      wake: WAKE,
    });
    await vi.waitFor(() => expect(importSnapshot).toHaveBeenCalledOnce());
    shouldYield = true;

    await expect(sync).rejects.toMatchObject({ name: "AbortError" });
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("preserves committed import counts when cancellation arrives at commit completion", async () => {
    const controller = new AbortController();
    const importSnapshot = vi.fn<
      NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>
    >(async () => {
      controller.abort(new DOMException("Foreground work arrived.", "AbortError"));
      return {
        canonical: {
          applied: true,
          createdCount: 1,
          retractedCount: 0,
          skippedExistingCount: 0,
          supersededCount: 0,
        },
        executableDecisionCount: 1,
        manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
        rawFileCount: 2,
        reviewDecisionCount: 0,
      };
    });

    const result = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: createPort(),
      importSnapshot,
      signal: controller.signal,
      vaultRoot,
      wake: WAKE,
    });

    expect(result).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ createdCount: 1 }),
      outcome: expect.objectContaining({
        counts: expect.objectContaining({ createdCount: 1 }),
        status: "completed",
      }),
      status: "completed",
    }));
  });

  it("reuses the same generation after preemption and then completes", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: "opaque-cursor-2",
        status: "page",
      })
      .mockResolvedValueOnce({
        body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
        nextCursor: null,
        status: "page",
      });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn().mockResolvedValue({
      canonical: {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      executableDecisionCount: 0,
      manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
      rawFileCount: 2,
      reviewDecisionCount: 0,
    });

    let preemptionChecks = 0;
    await expect(runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => {
        preemptionChecks += 1;
        return preemptionChecks === 6;
      },
      vaultRoot,
      wake: WAKE,
    })).rejects.toMatchObject({ code: "CLINICAL_RECORDS_FOREGROUND_PREEMPTED" });
    const completed = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => false,
      vaultRoot,
      wake: WAKE,
    });

    expect(completed.status).toBe("completed");
    expect(port.readRun).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(port.recordOutcome).not.toHaveBeenCalled();
    expect(completed.outcome).toEqual(expect.objectContaining({
      generation: 1,
      status: "completed",
    }));
    expect(fetchPage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cursor: null,
      requestId: "cr-1-1-1",
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: "opaque-cursor-2",
      requestId: "cr-1-1-2",
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("resumes a staged snapshot above sixteen MiB without replaying provider pages", async () => {
    const pageBodies = Array.from({ length: 5 }, (_, index) =>
      createLargeFhirBundleBody(index + 1, 4 * 1024 * 1024)
    );
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ body: pageBodies[0], nextCursor: "cursor-2", status: "page" })
      .mockResolvedValueOnce({ body: pageBodies[1], nextCursor: "cursor-3", status: "page" })
      .mockResolvedValueOnce({ body: pageBodies[2], nextCursor: "cursor-4", status: "page" })
      .mockResolvedValueOnce({ body: pageBodies[3], nextCursor: "cursor-5", status: "page" })
      .mockResolvedValueOnce({ body: pageBodies[4], nextCursor: null, status: "page" });
    const port = createPort({ fetchPage });
    const importSnapshot = vi.fn().mockResolvedValue({
      canonical: {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      executableDecisionCount: 0,
      manifestPath: "raw/clinical/fhir/connection_1/clinical_run_1/manifest.json",
      rawFileCount: 6,
      reviewDecisionCount: 0,
    });

    await expect(runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => fetchPage.mock.calls.length >= 3,
      vaultRoot,
      wake: WAKE,
    })).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|HostedClinicalRecordsRuntimeError/u) });

    const completed = await runHostedClinicalRecordsSyncWakeLane({
      clinicalRecordsPort: port,
      importSnapshot,
      shouldYieldClinicalRecords: () => false,
      vaultRoot,
      wake: WAKE,
    });

    expect(completed).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ fetchedPageCount: 5 }),
      status: "completed",
    }));
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(fetchPage).toHaveBeenNthCalledWith(4, expect.objectContaining({
      cursor: "cursor-4",
      requestId: "cr-1-1-4",
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(importSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      pages: pageBodies.map((content) => expect.objectContaining({ content })),
    }));
  }, 20_000);

  it("keeps raw FHIR and the clinical importer out of the static mailbox path", async () => {
    const [eventsSource, importerRootSource, maintenanceImportSource] = await Promise.all([
      readFile(new URL("../src/hosted-runtime/events.ts", import.meta.url), "utf8"),
      readFile(new URL("../../importers/src/index.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/hosted-runtime/clinical-records-maintenance-import.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(eventsSource).not.toContain("@murphai/vault-usecases/clinical-records");
    expect(eventsSource).not.toContain("@murphai/importers/clinical-records");
    expect(importerRootSource).not.toContain('export * from "./clinical-records/index.js"');
    expect(maintenanceImportSource).toContain('import("./clinical-records-maintenance.ts")');
  });
});

type HostedRuntimeClinicalRecordsPortMocks = {
  fetchPage: ReturnType<typeof vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>>;
  readRun: ReturnType<typeof vi.fn<HostedRuntimeClinicalRecordsPort["readRun"]>>;
  recordOutcome: ReturnType<typeof vi.fn<HostedRuntimeClinicalRecordsPort["recordOutcome"]>>;
};

function createPort(
  overrides: Partial<HostedRuntimeClinicalRecordsPort> = {},
): HostedRuntimeClinicalRecordsPortMocks {
  const defaultFetchPage: HostedRuntimeClinicalRecordsPort["fetchPage"] = async () => ({
    body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
    nextCursor: null,
    status: "page",
  });
  const defaultReadRun: HostedRuntimeClinicalRecordsPort["readRun"] = async () => ({
    run: RUN,
    status: "ready",
  });
  const defaultRecordOutcome: HostedRuntimeClinicalRecordsPort["recordOutcome"] = async () => {
    return undefined;
  };

  return {
    fetchPage: vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>(
      overrides.fetchPage ?? defaultFetchPage,
    ),
    readRun: vi.fn<HostedRuntimeClinicalRecordsPort["readRun"]>(
      overrides.readRun ?? defaultReadRun,
    ),
    recordOutcome: vi.fn<HostedRuntimeClinicalRecordsPort["recordOutcome"]>(
      overrides.recordOutcome ?? defaultRecordOutcome,
    ),
  };
}

async function seedPartialClinicalCheckpoint(
  run: HostedClinicalRecordsRunDescriptor,
): Promise<{ completedPage: string; partialPage: string }> {
  const completedPage = "{\"resourceType\":\"Bundle\",\"entry\":[]}";
  const partialPage = "{\"resourceType\":\"Bundle\",\"entry\":[]}";
  await writeClinicalFhirRetrievalCheckpoint({
    checkpoint: {
      authorizationRequired: false,
      completedResourceTypes: ["Observation"],
      currentResourceIndex: 1,
      cursor: "condition-page-2",
      errors: [],
      pageFetchCount: 2,
      pages: [
        { content: completedPage, resourceType: "Observation" },
        { content: partialPage, resourceType: "Condition" },
      ],
      resourcePageStartIndex: 1,
      seenCursors: [],
      seenPageUrlHashes: [],
      successfulPageCount: 2,
      totalBodyBytes: Buffer.byteLength(completedPage, "utf8")
        + Buffer.byteLength(partialPage, "utf8"),
      totalResourceCount: 0,
    },
    identity: run,
    vaultRoot,
  });
  return { completedPage, partialPage };
}

function unavailableClinicalRecordsResult() {
  return {
    counts: {
      createdCount: 0,
      executableDecisionCount: 0,
      fetchedPageCount: 0,
      fetchedResourceFamilyCount: 0,
      rawFileCount: 0,
      retractedCount: 0,
      reviewDecisionCount: 0,
      skippedExistingCount: 0,
      supersededCount: 0,
    },
    outcome: null,
    status: "unavailable",
  };
}

function createFhirBundleBody(
  resourceCount: number,
  resourceType = "Observation",
): string {
  return JSON.stringify({
    entry: Array.from({ length: resourceCount }, () => ({
      resource: { resourceType },
    })),
    resourceType: "Bundle",
  });
}

function createLargeFhirBundleBody(page: number, minimumBytes: number): string {
  const prefix = JSON.stringify({
    entry: [],
    page,
    padding: "",
    resourceType: "Bundle",
  });
  return JSON.stringify({
    entry: [],
    page,
    padding: "x".repeat(Math.max(0, minimumBytes - Buffer.byteLength(prefix, "utf8"))),
    resourceType: "Bundle",
  });
}
