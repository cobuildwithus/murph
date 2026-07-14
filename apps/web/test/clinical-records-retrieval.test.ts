import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
} from "@murphai/clinical-records";
import type { HostedClinicalRecordsFetchPageRequest } from "@murphai/hosted-execution/clinical-records";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  openClinicalConnectionFhirBaseUrl: vi.fn(),
  openClinicalConnectionSecret: vi.fn(),
  openClinicalPageCursor: vi.fn(),
  refreshSmartAccessToken: vi.fn(),
  sealClinicalConnectionSecret: vi.fn(),
  sealClinicalPageCursor: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/clinical-records/secrets", () => ({
  openClinicalConnectionFhirBaseUrl: mocks.openClinicalConnectionFhirBaseUrl,
  openClinicalConnectionSecret: mocks.openClinicalConnectionSecret,
  openClinicalPageCursor: mocks.openClinicalPageCursor,
  sealClinicalConnectionSecret: mocks.sealClinicalConnectionSecret,
  sealClinicalPageCursor: mocks.sealClinicalPageCursor,
  toClinicalJsonArray: (values: readonly string[]) => [...values],
}));
vi.mock("@/src/lib/clinical-records/smart", () => ({
  refreshSmartAccessToken: mocks.refreshSmartAccessToken,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

import {
  fetchClinicalRetrievalPage,
  readClinicalRetrievalRun,
  recordClinicalRetrievalOutcome,
} from "@/src/lib/clinical-records/retrieval";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";

const MEMBER_ID = "member_clinical_1";
const RUN_ID = "crr_run_1";
const CONNECTION_ID = "crc_connection_1";

describe("Clinical Records retrieval control plane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("derives the canonical manifest patient hash from decrypted context in memory", async () => {
    createHarness(["Patient", "Observation"]);

    const result = await readClinicalRetrievalRun({
      generation: 1,
      memberId: MEMBER_ID,
      runId: RUN_ID,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a ready Clinical Records run.");
    expect(result.run.patientIdHash).toBe(hashClinicalFhirPatientId("patient-1"));
  });

  it("lets transient patient-context decryption failures remain retryable", async () => {
    createHarness(["Patient", "Observation"]);
    mocks.openClinicalConnectionSecret.mockRejectedValueOnce(
      new Error("Transient secure-box failure."),
    );

    await expect(readClinicalRetrievalRun({
      generation: 1,
      memberId: MEMBER_ID,
      runId: RUN_ID,
    })).rejects.toThrow("Transient secure-box failure.");
  });

  it("lets transient cursor decryption failures remain retryable", async () => {
    createHarness(["Patient", "Observation"]);
    mocks.openClinicalPageCursor.mockRejectedValueOnce(
      new Error("Transient cursor decryption failure."),
    );
    const fetchImpl = vi.fn();

    await expect(fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({
        cursor: "encrypted-cursor",
        requestId: "request_transient_cursor",
        resourceType: "Observation",
      }),
    })).rejects.toThrow("Transient cursor decryption failure.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets transient cursor encryption failures remain retryable", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    mocks.sealClinicalPageCursor.mockRejectedValueOnce(
      new Error("Transient cursor encryption failure."),
    );

    await expect(fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(fhirResponse({
        entry: [],
        link: [{
          relation: "next",
          url: "https://fhir.example.test/FHIR/R4/Observation?page=2",
        }],
        resourceType: "Bundle",
        type: "searchset",
      })),
      memberId: MEMBER_ID,
      request: pageRequest({
        requestId: "request_transient_cursor_seal",
        resourceType: "Observation",
      }),
    })).rejects.toThrow("Transient cursor encryption failure.");
    expect(harness.state.run.pageCount).toBe(0);
  });

  it("preserves an Epic Bundle next link and returns a hash only for the continuation page", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const nextUrl = "https://fhir.example.test/FHIR/R4/Observation?_count=100&patient=patient-1&page=2";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fhirResponse({
        entry: [{ resource: { id: "obs-1", resourceType: "Observation", status: "final" } }],
        link: [{ relation: "next", url: nextUrl }],
        resourceType: "Bundle",
        type: "searchset",
      }))
      .mockResolvedValueOnce(fhirResponse({
        entry: [{ resource: { id: "obs-2", resourceType: "Observation", status: "final" } }],
        resourceType: "Bundle",
        type: "searchset",
      }));

    const first = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_1", resourceType: "Observation" }),
    });

    expect(first.status).toBe("page");
    if (first.status !== "page") throw new Error("Expected first retrieval page.");
    expect("pageUrlHash" in first).toBe(false);
    expect(first.nextCursor).not.toBeNull();
    expect(JSON.parse(first.body)).toMatchObject({
      link: [{ relation: "next", url: nextUrl }],
      resourceType: "Bundle",
    });

    const second = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({
        cursor: first.nextCursor,
        requestId: "request_2",
        resourceType: "Observation",
      }),
    });

    expect(second.status).toBe("page");
    if (second.status !== "page") throw new Error("Expected continuation retrieval page.");
    expect(second.pageUrlHash).toBe(sha256Hex(nextUrl));
    expect(second.nextCursor).toBeNull();
    expect(harness.state.run.pageCount).toBe(2);
    expect(harness.state.run.fetchedBytes).toBeGreaterThan(0);
  });

  it("uses the exact validated provider next-link text as pagination provenance", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const exactNextUrl =
      "https://FHIR.EXAMPLE.TEST:443/FHIR/R4/Observation?_count=100&patient=patient-1&page=2";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fhirResponse({
        entry: [{ resource: { id: "obs-exact-1", resourceType: "Observation", status: "final" } }],
        link: [{ relation: "next", url: exactNextUrl }],
        resourceType: "Bundle",
        type: "searchset",
      }))
      .mockResolvedValueOnce(fhirResponse({
        entry: [{ resource: { id: "obs-exact-2", resourceType: "Observation", status: "final" } }],
        resourceType: "Bundle",
        type: "searchset",
      }));

    const first = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_exact_1", resourceType: "Observation" }),
    });
    expect(first.status).toBe("page");
    if (first.status !== "page" || !first.nextCursor) {
      throw new Error("Expected an exact-link continuation cursor.");
    }
    expect(JSON.parse(harness.cursorPlaintexts.get(first.nextCursor) ?? "null")).toEqual({
      schema: "murph.clinical-page-cursor.v2",
      url: exactNextUrl,
    });

    const second = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({
        cursor: first.nextCursor,
        requestId: "request_exact_2",
        resourceType: "Observation",
      }),
    });

    expect(second).toEqual(expect.objectContaining({
      pageUrlHash: hashClinicalFhirPageUrl(exactNextUrl),
      status: "page",
    }));
    expect(JSON.parse(first.body)).toMatchObject({
      link: [{ relation: "next", url: exactNextUrl }],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL(exactNextUrl),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("deduplicates logical continuation pages across randomized cursor ciphertext", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const nextUrl =
      "https://fhir.example.test/FHIR/R4/Observation?_count=100&patient=patient-1&page=2";
    const rootBody = {
      entry: [{ resource: { id: "obs-root", resourceType: "Observation", status: "final" } }],
      link: [{ relation: "next", url: nextUrl }],
      resourceType: "Bundle",
      type: "searchset",
    };
    const continuationBody = {
      entry: [{ resource: { id: "obs-next", resourceType: "Observation", status: "final" } }],
      resourceType: "Bundle",
      type: "searchset",
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fhirResponse(rootBody))
      .mockResolvedValueOnce(fhirResponse(rootBody))
      .mockResolvedValueOnce(fhirResponse(continuationBody))
      .mockResolvedValueOnce(fhirResponse(continuationBody));

    const firstRoot = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_random_root_1", resourceType: "Observation" }),
    });
    const replayedRoot = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_random_root_2", resourceType: "Observation" }),
    });
    if (
      firstRoot.status !== "page"
      || replayedRoot.status !== "page"
      || !firstRoot.nextCursor
      || !replayedRoot.nextCursor
    ) {
      throw new Error("Expected two independently sealed continuation cursors.");
    }
    expect(replayedRoot.nextCursor).not.toBe(firstRoot.nextCursor);

    const firstContinuation = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({
        cursor: firstRoot.nextCursor,
        requestId: "request_random_next_1",
        resourceType: "Observation",
      }),
    });
    const replayedContinuation = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({
        cursor: replayedRoot.nextCursor,
        requestId: "request_random_next_2",
        resourceType: "Observation",
      }),
    });

    expect(firstContinuation).toEqual(expect.objectContaining({
      pageUrlHash: hashClinicalFhirPageUrl(nextUrl),
      status: "page",
    }));
    expect(replayedContinuation).toEqual(expect.objectContaining({
      pageUrlHash: hashClinicalFhirPageUrl(nextUrl),
      status: "page",
    }));
    expect(harness.state.run.pageCount).toBe(2);
    expect(harness.state.run.providerRequestCount).toBe(4);
  });

  it("returns a direct Patient read without exposing a root page URL hash", async () => {
    createHarness(["Patient"]);
    const fetchImpl = vi.fn().mockResolvedValue(fhirResponse({
      id: "patient-1",
      resourceType: "Patient",
    }));

    const result = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_patient", resourceType: "Patient" }),
    });

    expect(result.status).toBe("page");
    if (result.status !== "page") throw new Error("Expected Patient retrieval page.");
    expect("pageUrlHash" in result).toBe(false);
    expect(JSON.parse(result.body)).toEqual({ id: "patient-1", resourceType: "Patient" });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://fhir.example.test/FHIR/R4/Patient/patient-1"),
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("rejects another member, run, or generation before opening patient context", async () => {
    createHarness(["Patient", "Observation"]);

    const results = await Promise.all([
      readClinicalRetrievalRun({
        generation: 1,
        memberId: "member_clinical_other",
        runId: RUN_ID,
      }),
      readClinicalRetrievalRun({
        generation: 1,
        memberId: MEMBER_ID,
        runId: "crr_run_other",
      }),
      readClinicalRetrievalRun({
        generation: 2,
        memberId: MEMBER_ID,
        runId: RUN_ID,
      }),
    ]);

    for (const result of results) {
      expect(result).toEqual({
        errorCode: "run-not-found",
        retryable: false,
        status: "unavailable",
      });
    }
    expect(mocks.openClinicalConnectionSecret).not.toHaveBeenCalled();
  });

  it("rejects a continuation that changes the resource-family path", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    harness.cursorPlaintexts.set("bad-cursor", JSON.stringify({
      schema: "murph.clinical-page-cursor.v2",
      url: "https://fhir.example.test/FHIR/R4/Condition?_count=100&patient=patient-1",
    }));
    const fetchImpl = vi.fn();

    const result = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({
        cursor: "bad-cursor",
        requestId: "request_bad_cursor",
        resourceType: "Observation",
      }),
    });

    expect(result).toEqual({
      errorCode: "page-cursor-invalid",
      retryable: false,
      status: "unavailable",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([" ", "\t", "\n"])(
    "rejects a continuation cursor with surrounding ASCII whitespace: %j",
    async (whitespace) => {
      const harness = createHarness(["Patient", "Observation"]);
      harness.cursorPlaintexts.set("spaced-cursor", JSON.stringify({
        schema: "murph.clinical-page-cursor.v2",
        url: `${whitespace}https://fhir.example.test/FHIR/R4/Observation?_count=100&patient=patient-1`,
      }));
      const fetchImpl = vi.fn();

      await expect(fetchClinicalRetrievalPage({
        fetchImpl,
        memberId: MEMBER_ID,
        request: pageRequest({
          cursor: "spaced-cursor",
          requestId: `request_spaced_cursor_${whitespace.charCodeAt(0)}`,
          resourceType: "Observation",
        }),
      })).resolves.toEqual({
        errorCode: "page-cursor-invalid",
        retryable: false,
        status: "unavailable",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://foreign.example.test/FHIR/R4/Observation?_count=100&patient=patient-1&page=2",
    "https://fhir.example.test/FHIR/R4/Observation%2FCondition?_count=100&patient=patient-1",
  ])("rejects a foreign or path-escaped provider next link: %s", async (nextUrl) => {
    const harness = createHarness(["Patient", "Observation"]);
    const fetchImpl = vi.fn().mockResolvedValue(fhirResponse({
      entry: [{ resource: { id: "obs-1", resourceType: "Observation", status: "final" } }],
      link: [{ relation: "next", url: nextUrl }],
      resourceType: "Bundle",
      type: "searchset",
    }));

    const result = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_escaped_next", resourceType: "Observation" }),
    });

    expect(result).toEqual({
      errorCode: "provider-response-invalid",
      retryable: false,
      status: "unavailable",
    });
    expect(mocks.sealClinicalPageCursor).not.toHaveBeenCalled();
    expect(harness.state.run.pageCount).toBe(0);
  });

  it.each([
    " https://fhir.example.test/FHIR/R4/Observation?_count=100&patient=patient-1&page=2",
    "https://fhir.example.test/FHIR/R4/Observation?_count=100&patient=patient-1&page=2 ",
  ])("rejects a provider next link with surrounding ASCII whitespace: %j", async (nextUrl) => {
    const harness = createHarness(["Patient", "Observation"]);
    const result = await fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(fhirResponse({
        entry: [],
        link: [{ relation: "next", url: nextUrl }],
        resourceType: "Bundle",
        type: "searchset",
      })),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_spaced_next", resourceType: "Observation" }),
    });

    expect(result).toEqual({
      errorCode: "provider-response-invalid",
      retryable: false,
      status: "unavailable",
    });
    expect(mocks.sealClinicalPageCursor).not.toHaveBeenCalled();
    expect(harness.state.run.pageCount).toBe(0);
  });

  it("rejects a Bundle containing a resource outside the requested family", async () => {
    const harness = createHarness(["Patient", "Observation"]);

    const result = await fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(fhirResponse({
        entry: [{ resource: { id: "condition-1", resourceType: "Condition" } }],
        resourceType: "Bundle",
        type: "searchset",
      })),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_wrong_family", resourceType: "Observation" }),
    });

    expect(result).toEqual({
      errorCode: "provider-response-invalid",
      retryable: false,
      status: "unavailable",
    });
    expect(harness.state.run.pageCount).toBe(0);
  });

  it("distinguishes a forbidden family from expired authorization", async () => {
    const forbidden = createHarness(["Patient", "Observation"]);
    const forbiddenResult = await fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_forbidden", resourceType: "Observation" }),
    });
    expect(forbiddenResult).toEqual({
      errorCode: "family-unavailable",
      retryable: false,
      status: "unavailable",
    });
    expect(forbidden.state.run.connection.status).toBe("active");

    const unauthorized = createHarness(["Patient", "Observation"]);
    const unauthorizedResult = await fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_unauthorized", resourceType: "Observation" }),
    });
    expect(unauthorizedResult).toEqual({
      errorCode: "authorization-required",
      retryable: false,
      status: "unavailable",
    });
    expect(unauthorized.state.run.connection).toMatchObject({
      accessTokenEncrypted: null,
      patientIdEncrypted: null,
      refreshTokenEncrypted: null,
      status: "needs_reauth",
    });
    expect(unauthorized.state.run.status).toBe("needs_reauth");
    await expect(readClinicalRetrievalRun({
      generation: 1,
      memberId: MEMBER_ID,
      runId: RUN_ID,
    })).resolves.toEqual({
      errorCode: "authorization-required",
      retryable: false,
      status: "unavailable",
    });
  });

  it("cancels an oversized FHIR stream even when Content-Length is underreported", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const streamed = oversizedFhirResponse([3 * 1_024 * 1_024, 3 * 1_024 * 1_024], "1");

    const result = await fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(streamed.response),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_oversized", resourceType: "Observation" }),
    });

    expect(result).toEqual({
      errorCode: "provider-response-invalid",
      retryable: false,
      status: "unavailable",
    });
    expect(streamed.wasCanceled()).toBe(true);
    expect(harness.state.run.pageCount).toBe(0);
    expect(harness.state.run.providerRequestCount).toBe(1);
    expect(harness.state.run.egressBytes).toBeGreaterThan(0);
  });

  it("rejects malformed UTF-8 instead of persisting replacement characters", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const prefix = new TextEncoder().encode('{"entry":[],"id":"');
    const suffix = new TextEncoder().encode('","resourceType":"Bundle","type":"searchset"}');
    const body = new Uint8Array(prefix.length + 1 + suffix.length);
    body.set(prefix);
    body[prefix.length] = 0xff;
    body.set(suffix, prefix.length + 1);

    const result = await fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(new Response(body, {
        headers: { "content-type": "application/fhir+json" },
      })),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_invalid_utf8", resourceType: "Observation" }),
    });

    expect(result).toEqual({
      errorCode: "provider-response-invalid",
      retryable: false,
      status: "unavailable",
    });
    expect(harness.state.run.pageCount).toBe(0);
  });

  it("deduplicates concurrent claims for the same page across distinct caller request ids", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const fetchStarted = deferred<void>();
    const releaseFetch = deferred<Response>();
    const fetchImpl = vi.fn(async () => {
      fetchStarted.resolve();
      return releaseFetch.promise;
    });

    const first = fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_same_page_1", resourceType: "Observation" }),
    });
    await fetchStarted.promise;
    const duplicate = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_same_page_2", resourceType: "Observation" }),
    });
    releaseFetch.resolve(fhirResponse({ entry: [], resourceType: "Bundle", type: "searchset" }));

    await expect(first).resolves.toMatchObject({ status: "page" });
    expect(duplicate).toEqual({
      errorCode: "request-in-progress",
      retryable: true,
      status: "unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(harness.state.run.providerRequestCount).toBe(1);
    expect(harness.state.run.pageCount).toBe(1);
  });

  it("charges completed same-page replays without double-counting the logical page", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    const fetchImpl = vi.fn().mockImplementation(async () => fhirResponse({
      entry: [],
      resourceType: "Bundle",
      type: "searchset",
    }));

    const first = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_replay_1", resourceType: "Observation" }),
    });
    const replay = await fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_replay_2", resourceType: "Observation" }),
    });

    expect(first.status).toBe("page");
    expect(replay.status).toBe("page");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(harness.state.run.providerRequestCount).toBe(2);
    expect(harness.state.run.pageCount).toBe(1);
    expect(harness.state.run.fetchedBytes).toBeGreaterThan(0);
    expect(harness.state.run.egressBytes).toBe(harness.state.run.fetchedBytes);
  });

  it("persists server-page dedupe and pre-egress reservation counters in the additive migration", () => {
    const migration = readFileSync(new URL(
      "../prisma/migrations/20260710160000_clinical_records_control_plane/migration.sql",
      import.meta.url,
    ), "utf8");

    expect(migration).toContain('"egress_bytes" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('"provider_request_count" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('"reserved_bytes" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain(
      'ON "clinical_record_retrieval_request"("run_id", "request_fingerprint")',
    );
    expect(migration).not.toContain("request_id_hash");
  });

  it("uses claim-version CAS so a stale claimant cannot double-count a page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T16:00:00.000Z"));
    const harness = createHarness(["Patient", "Observation"]);
    const firstFetchStarted = deferred<void>();
    const releaseFirstFetch = deferred<Response>();
    let fetchCount = 0;
    const fetchImpl = vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        firstFetchStarted.resolve();
        return releaseFirstFetch.promise;
      }
      return fhirResponse({ entry: [], resourceType: "Bundle", type: "searchset" });
    });
    const request = pageRequest({ requestId: "request_race", resourceType: "Observation" });

    const staleClaim = fetchClinicalRetrievalPage({ fetchImpl, memberId: MEMBER_ID, request });
    await firstFetchStarted.promise;
    vi.setSystemTime(new Date("2026-07-10T16:00:31.000Z"));
    const reclaimResult = await fetchClinicalRetrievalPage({ fetchImpl, memberId: MEMBER_ID, request });
    releaseFirstFetch.resolve(fhirResponse({ entry: [], resourceType: "Bundle", type: "searchset" }));
    const staleResult = await staleClaim;

    expect(reclaimResult.status).toBe("page");
    expect(staleResult).toEqual({
      errorCode: "request-superseded",
      retryable: true,
      status: "unavailable",
    });
    expect(harness.state.run.pageCount).toBe(1);
    expect([...harness.state.requests.values()][0]).toMatchObject({
      claimVersion: 3,
      responseBytes: expect.any(Number),
    });
  });

  it("does not let a stale invalid-grant response erase concurrently rotated credentials", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    harness.state.run.connection.accessTokenExpiresAt = new Date(Date.now() - 1_000);
    const refreshesStarted = deferred<void>();
    const successfulRefresh = deferred<{
      accessToken: string;
      expiresInSeconds: number;
      grantedScopes: string[];
      refreshToken: string;
    }>();
    const staleInvalidGrant = deferred<void>();
    let refreshCallCount = 0;
    mocks.refreshSmartAccessToken.mockImplementation(async () => {
      refreshCallCount += 1;
      if (refreshCallCount === 2) refreshesStarted.resolve();
      if (refreshCallCount === 1) return successfulRefresh.promise;
      await staleInvalidGrant.promise;
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED",
        httpStatus: 401,
        message: "Authorization expired.",
      });
    });
    const fetchImpl = vi.fn().mockResolvedValue(fhirResponse({
      entry: [],
      resourceType: "Bundle",
      type: "searchset",
    }));

    const winner = fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_refresh_winner", resourceType: "Observation" }),
    });
    const stale = fetchClinicalRetrievalPage({
      fetchImpl,
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_refresh_stale", resourceType: "Patient" }),
    });
    await refreshesStarted.promise;
    successfulRefresh.resolve({
      accessToken: "rotated-access-token",
      expiresInSeconds: 3_600,
      grantedScopes: ["patient/Patient.rs", "patient/Observation.rs"],
      refreshToken: "rotated-refresh-token",
    });
    await vi.waitFor(() => expect(harness.state.run.connection.tokenVersion).toBe(2));
    staleInvalidGrant.resolve();

    await expect(winner).resolves.toMatchObject({ status: "page" });
    await expect(stale).resolves.toEqual({
      errorCode: "credentials-updated-retry",
      retryable: true,
      status: "unavailable",
    });
    expect(harness.state.run.connection).toMatchObject({
      accessTokenEncrypted: "sealed-accessToken-2",
      refreshTokenEncrypted: "sealed-refreshToken-2",
      status: "active",
      tokenVersion: 2,
    });
    expect(harness.state.run.status).not.toBe("needs_reauth");
  });

  it.each([
    [["patient/Observation.rs", "patient/Patient.rs"]],
    [["patient/Patient.rs"]],
  ])("keeps the run scope snapshot immutable when refresh changes connection scopes: %j", async (
    refreshedScopes,
  ) => {
    const harness = createHarness(["Patient", "Observation"]);
    const originalScopes = ["patient/Patient.rs", "patient/Observation.rs"];
    harness.state.run.grantedScopesJson = [...originalScopes];
    harness.state.run.connection.accessTokenExpiresAt = new Date(Date.now() - 1_000);
    mocks.refreshSmartAccessToken.mockResolvedValue({
      accessToken: "rotated-access-token",
      expiresInSeconds: 3_600,
      grantedScopes: refreshedScopes,
      refreshToken: "rotated-refresh-token",
    });

    await expect(fetchClinicalRetrievalPage({
      fetchImpl: vi.fn().mockResolvedValue(fhirResponse({
        entry: [],
        resourceType: "Bundle",
        type: "searchset",
      })),
      memberId: MEMBER_ID,
      request: pageRequest({ requestId: "request_scope_snapshot", resourceType: "Observation" }),
    })).resolves.toMatchObject({ status: "page" });
    expect(harness.state.run.connection.grantedScopesJson).toEqual(refreshedScopes);

    await expect(readClinicalRetrievalRun({
      generation: 1,
      memberId: MEMBER_ID,
      runId: RUN_ID,
    })).resolves.toMatchObject({
      run: { grantedScopes: originalScopes },
      status: "ready",
    });
  });

  it("requeues a preempted run and accepts a reordered idempotent completion", async () => {
    const harness = createHarness(["Patient", "Observation"]);
    harness.state.run.status = "retrieving";
    await recordClinicalRetrievalOutcome({
      memberId: MEMBER_ID,
      request: {
        counts: outcomeCounts(),
        errorCode: "runtime-preempted",
        generation: 1,
        runId: RUN_ID,
        status: "preempted",
      },
    });
    expect(harness.state.run).toMatchObject({
      completedAt: null,
      pageCount: 0,
      status: "queued",
    });
    await expect(readClinicalRetrievalRun({
      generation: 1,
      memberId: MEMBER_ID,
      runId: RUN_ID,
    })).resolves.toMatchObject({ status: "ready" });

    const counts = outcomeCounts();
    await recordClinicalRetrievalOutcome({
      memberId: MEMBER_ID,
      request: { counts, generation: 1, runId: RUN_ID, status: "completed" },
    });
    const updateCount = harness.runUpdateCalls.length;
    const reorderedCounts = {
      supersededCount: counts.supersededCount,
      skippedExistingCount: counts.skippedExistingCount,
      reviewDecisionCount: counts.reviewDecisionCount,
      retractedCount: counts.retractedCount,
      rawFileCount: counts.rawFileCount,
      fetchedResourceFamilyCount: counts.fetchedResourceFamilyCount,
      fetchedPageCount: counts.fetchedPageCount,
      executableDecisionCount: counts.executableDecisionCount,
      createdCount: counts.createdCount,
    };
    await recordClinicalRetrievalOutcome({
      memberId: MEMBER_ID,
      request: {
        counts: reorderedCounts,
        generation: 1,
        runId: RUN_ID,
        status: "completed",
      },
    });

    expect(harness.state.run.status).toBe("complete");
    expect(harness.runUpdateCalls).toHaveLength(updateCount);
  });

  it("rejects terminal and preempted outcomes when reconnect advances the generation", async () => {
    const terminal = createHarness(["Patient", "Observation"]);
    terminal.hooks.beforeConnectionUpdateMany = () => {
      terminal.state.run.connection.retrievalGeneration = 2;
      terminal.state.run.status = "canceled";
      terminal.state.run.completedAt = new Date("2026-07-10T17:00:00.000Z");
    };
    await expect(recordClinicalRetrievalOutcome({
      memberId: MEMBER_ID,
      request: {
        counts: outcomeCounts(),
        generation: 1,
        runId: RUN_ID,
        status: "completed",
      },
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_RUN_STALE" });
    expect(terminal.state.run.status).toBe("canceled");
    expect(terminal.state.run.connection.status).toBe("active");

    const preempted = createHarness(["Patient", "Observation"]);
    preempted.state.run.status = "retrieving";
    preempted.hooks.beforeRunUpdateMany = () => {
      preempted.state.run.connection.retrievalGeneration = 2;
      preempted.state.run.status = "canceled";
      preempted.state.run.completedAt = new Date("2026-07-10T17:01:00.000Z");
    };
    await expect(recordClinicalRetrievalOutcome({
      memberId: MEMBER_ID,
      request: {
        counts: outcomeCounts(),
        generation: 1,
        runId: RUN_ID,
        status: "preempted",
      },
    })).rejects.toMatchObject({ code: "CLINICAL_RECORD_RUN_STALE" });
    expect(preempted.state.run.status).toBe("canceled");
  });
});

function createHarness(resourceTypes: string[]) {
  const cursorPlaintexts = new Map<string, string>();
  const runUpdateCalls: Array<Record<string, unknown>> = [];
  const hooks: {
    beforeConnectionUpdateMany: (() => void) | null;
    beforeRunUpdateMany: (() => void) | null;
  } = {
    beforeConnectionUpdateMany: null,
    beforeRunUpdateMany: null,
  };
  const state = {
    requests: new Map<string, RetrievalRequestRow>(),
    run: buildRun(resourceTypes),
  };
  const requestApi = {
    updateMany: vi.fn(async (args: Record<string, unknown>) =>
      updateRetrievalRequest(state.requests, args)
    ),
    upsert: vi.fn(async (args: {
      create: RetrievalRequestRow;
      where: {
        runId_requestFingerprint: { requestFingerprint: string; runId: string };
      };
    }) => {
      const key = requestKey(args.where.runId_requestFingerprint);
      const existing = state.requests.get(key);
      if (existing) return { ...existing };
      const created: RetrievalRequestRow = {
        ...args.create,
        claimVersion: 1,
        completedAt: null,
        reservedBytes: 0,
        responseBytes: null,
      };
      state.requests.set(key, created);
      return { ...created };
    }),
  };
  const runApi = {
    findFirst: vi.fn(async (args?: {
      where?: { generation?: number; id?: string; memberId?: string };
    }) => {
      const where = args?.where;
      if (
        (where?.generation !== undefined && where.generation !== state.run.generation)
        || (where?.id !== undefined && where.id !== state.run.id)
        || (where?.memberId !== undefined && where.memberId !== state.run.memberId)
      ) return null;
      return snapshotRun(state.run);
    }),
    updateMany: vi.fn(async (args: {
      data: Record<string, unknown>;
      where?: Record<string, unknown>;
    }) => {
      const hook = hooks.beforeRunUpdateMany;
      hooks.beforeRunUpdateMany = null;
      hook?.();
      const where = args.where ?? {};
      const connectionWhere = where.connection as {
        retrievalGeneration?: number;
        status?: { in: string[] };
      } | undefined;
      if (
        (where.completedAt === null && state.run.completedAt !== null)
        || (typeof where.generation === "number" && where.generation !== state.run.generation)
        || !matchesNumberBound(state.run.egressBytes, where.egressBytes)
        || !matchesNumberBound(state.run.providerRequestCount, where.providerRequestCount)
        || (where.status && !(where.status as { in: string[] }).in.includes(state.run.status))
        || (
          connectionWhere?.retrievalGeneration !== undefined
          && connectionWhere.retrievalGeneration !== state.run.connection.retrievalGeneration
        )
        || (
          connectionWhere?.status
          && !connectionWhere.status.in.includes(state.run.connection.status)
        )
      ) return { count: 0 };
      runUpdateCalls.push(args.data);
      applyRunUpdate(state.run, args.data);
      return { count: 1 };
    }),
  };
  const connectionApi = {
    updateMany: vi.fn(async (args: {
      data: Record<string, unknown>;
      where?: {
        retrievalGeneration?: number;
        status?: { in: string[] };
        tokenVersion?: number;
      };
    }) => {
      const hook = hooks.beforeConnectionUpdateMany;
      hooks.beforeConnectionUpdateMany = null;
      hook?.();
      if (
        args.where?.tokenVersion !== undefined
        && args.where.tokenVersion !== state.run.connection.tokenVersion
      ) return { count: 0 };
      if (
        args.where?.retrievalGeneration !== undefined
        && args.where.retrievalGeneration !== state.run.connection.retrievalGeneration
      ) return { count: 0 };
      if (
        args.where?.status
        && !args.where.status.in.includes(state.run.connection.status)
      ) return { count: 0 };
      Object.assign(state.run.connection, args.data);
      return { count: 1 };
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
      clinicalRecordConnection: connectionApi,
      clinicalRecordRetrievalRequest: requestApi,
      clinicalRecordRetrievalRun: runApi,
    })),
    clinicalRecordConnection: connectionApi,
    clinicalRecordRetrievalRequest: requestApi,
    clinicalRecordRetrievalRun: runApi,
  };
  mocks.getPrisma.mockReturnValue(prisma);
  mocks.openClinicalConnectionFhirBaseUrl.mockResolvedValue(
    "https://fhir.example.test/FHIR/R4",
  );
  mocks.openClinicalConnectionSecret.mockImplementation(async (input: { field: string }) => {
    if (input.field === "patientId") return "patient-1";
    if (input.field === "accessToken") return "access-token";
    if (input.field === "refreshToken") return "refresh-token";
    return null;
  });
  mocks.openClinicalPageCursor.mockImplementation(async (input: { value: string }) => {
    const plaintext = cursorPlaintexts.get(input.value);
    if (!plaintext) throw new TypeError("Unknown test cursor.");
    return plaintext;
  });
  let cursorSequence = 0;
  mocks.sealClinicalPageCursor.mockImplementation(async (input: { value: string }) => {
    cursorSequence += 1;
    const cursor = `cursor-${cursorSequence}`;
    cursorPlaintexts.set(cursor, input.value);
    return cursor;
  });
  mocks.sealClinicalConnectionSecret.mockImplementation(async (input: {
    field: string;
    tokenVersion: number;
  }) => `sealed-${input.field}-${input.tokenVersion}`);
  mocks.refreshSmartAccessToken.mockResolvedValue({
    accessToken: "refreshed-access-token",
    expiresInSeconds: 3_600,
    grantedScopes: ["patient/Patient.rs", "patient/Observation.rs"],
    refreshToken: "refreshed-refresh-token",
  });
  return { cursorPlaintexts, hooks, runUpdateCalls, state };
}

interface RetrievalRequestRow {
  claimVersion: number;
  claimedAt: Date;
  completedAt: Date | null;
  connectionId: string;
  generation: number;
  id: string;
  memberId: string;
  requestFingerprint: string;
  reservedBytes: number;
  responseBytes: number | null;
  runId: string;
}

function updateRetrievalRequest(
  requests: Map<string, RetrievalRequestRow>,
  args: Record<string, unknown>,
): { count: number } {
  const data = args.data as Record<string, unknown>;
  const where = args.where as {
    claimVersion?: number;
    completedAt?: null;
    id?: string;
    reservedBytes?: number;
    responseBytes?: null | { not: null };
  };
  const row = [...requests.values()].find((candidate) => candidate.id === where.id);
  if (!row) return { count: 0 };
  if (data.claimVersion && typeof data.claimVersion === "object") {
    const staleBefore = new Date(Date.now() - 30_000);
    const completedReplay = row.completedAt !== null && row.reservedBytes === 0;
    const staleClaim = row.claimedAt <= staleBefore;
    if (
      row.claimVersion !== where.claimVersion
      || (!completedReplay && !staleClaim)
    ) return { count: 0 };
    row.claimVersion += 1;
    row.claimedAt = data.claimedAt as Date;
    row.completedAt = null;
    row.reservedBytes = data.reservedBytes as number;
    return { count: 1 };
  }
  if (typeof data.responseBytes === "number") {
    const expectsFirstCompletion = where.responseBytes === null;
    if (
      row.claimVersion !== where.claimVersion
      || row.completedAt !== null
      || row.reservedBytes !== where.reservedBytes
      || (expectsFirstCompletion ? row.responseBytes !== null : row.responseBytes === null)
    ) return { count: 0 };
    row.completedAt = data.completedAt as Date;
    row.reservedBytes = data.reservedBytes as number;
    row.responseBytes = data.responseBytes;
    return { count: 1 };
  }
  if (data.claimedAt instanceof Date) {
    if (
      row.claimVersion !== where.claimVersion
      || row.completedAt !== null
      || row.reservedBytes !== where.reservedBytes
    ) return { count: 0 };
    row.claimedAt = data.claimedAt;
    row.completedAt = (data.completedAt as Date | null) ?? null;
    row.reservedBytes = data.reservedBytes as number;
    return { count: 1 };
  }
  return { count: 0 };
}

function buildRun(resourceTypes: string[]) {
  return {
    completedAt: null as Date | null,
    connection: {
      accessTokenEncrypted: "encrypted-access-token",
      accessTokenExpiresAt: null as Date | null,
      clientId: "epic-client-id",
      fhirBaseHash: sha256Hex("https://fhir.example.test/FHIR/R4"),
      fhirBaseUrlEncrypted: "encrypted-fhir-base-url",
      grantedScopesJson: ["patient/Patient.rs", "patient/Observation.rs"],
      id: CONNECTION_ID,
      memberId: MEMBER_ID,
      patientIdEncrypted: "encrypted-patient-id",
      providerDirectoryEntryId: "epic-test",
      refreshTokenEncrypted: "encrypted-refresh-token" as string | null,
      requestedScopesJson: ["patient/Patient.rs", "patient/Observation.rs"],
      retrievalGeneration: 1,
      sourceSystem: "epic-fhir",
      status: "active",
      tokenEndpoint: "https://fhir.example.test/oauth2/token",
      tokenVersion: 1,
    },
    createdAt: new Date("2026-07-10T15:00:00.000Z"),
    egressBytes: 0,
    fetchedBytes: 0,
    generation: 1,
    grantedScopesJson: ["patient/Patient.rs", "patient/Observation.rs"],
    id: RUN_ID,
    importedCount: 0,
    lastErrorCode: null as string | null,
    memberId: MEMBER_ID,
    outcomeCountsJson: null as Record<string, unknown> | null,
    pageCount: 0,
    providerRequestCount: 0,
    resourceTypesJson: resourceTypes,
    reviewCount: 0,
    status: "queued",
  };
}

function snapshotRun(run: ReturnType<typeof buildRun>) {
  return { ...run, connection: { ...run.connection } };
}

function applyRunUpdate(run: ReturnType<typeof buildRun>, data: Record<string, unknown>): void {
  for (const key of ["egressBytes", "fetchedBytes", "pageCount", "providerRequestCount"] as const) {
    const operation = data[key];
    if (!operation || typeof operation !== "object") continue;
    if ("increment" in operation) run[key] += (operation as { increment: number }).increment;
    if ("decrement" in operation) run[key] -= (operation as { decrement: number }).decrement;
  }
  for (const [key, value] of Object.entries(data)) {
    if (
      key === "egressBytes"
      || key === "fetchedBytes"
      || key === "pageCount"
      || key === "providerRequestCount"
      || value === undefined
    ) continue;
    Object.assign(run, { [key]: value });
  }
}

function pageRequest(input: {
  cursor?: string | null;
  requestId: string;
  resourceType: HostedClinicalRecordsFetchPageRequest["resourceType"];
}) {
  return {
    cursor: input.cursor ?? null,
    generation: 1,
    requestId: input.requestId,
    resourceType: input.resourceType,
    runId: RUN_ID,
  };
}

function fhirResponse(value: unknown): Response {
  return Response.json(value, { headers: { "content-type": "application/fhir+json" } });
}

function oversizedFhirResponse(chunkSizes: number[], declaredLength: string): {
  response: Response;
  wasCanceled: () => boolean;
} {
  let canceled = false;
  const chunks = [...chunkSizes];
  const response = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true;
    },
    pull(controller) {
      const size = chunks.shift();
      if (size === undefined) return;
      controller.enqueue(new Uint8Array(size));
    },
  }), {
    headers: {
      "Content-Length": declaredLength,
      "Content-Type": "application/fhir+json",
    },
  });
  return { response, wasCanceled: () => canceled };
}

function outcomeCounts(): {
  createdCount: number;
  executableDecisionCount: number;
  fetchedPageCount: number;
  fetchedResourceFamilyCount: number;
  rawFileCount: number;
  retractedCount: number;
  reviewDecisionCount: number;
  skippedExistingCount: number;
  supersededCount: number;
} {
  return {
    createdCount: 0,
    executableDecisionCount: 0,
    fetchedPageCount: 0,
    fetchedResourceFamilyCount: 0,
    rawFileCount: 0,
    retractedCount: 0,
    reviewDecisionCount: 0,
    skippedExistingCount: 0,
    supersededCount: 0,
  };
}

function requestKey(value: { requestFingerprint: string; runId: string }): string {
  return `${value.runId}:${value.requestFingerprint}`;
}

function matchesNumberBound(
  value: number,
  bound: unknown,
): boolean {
  if (!bound || typeof bound !== "object") return true;
  if ("lt" in bound && value >= (bound as { lt: number }).lt) return false;
  if ("lte" in bound && value > (bound as { lte: number }).lte) return false;
  return true;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
}
