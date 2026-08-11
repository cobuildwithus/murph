import {
  CLINICAL_FHIR_MAX_RETRIEVAL_SLICES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
} from "@murphai/clinical-records";
import {
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
} from "@murphai/hosted-execution/clinical-records";
import {
  HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES,
} from "@murphai/hosted-execution/clinical-records-boundary";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedWebClinicalRecordsPort,
} from "../src/runtime-platform/clinical-records-port.ts";
import {
  readHostedRunnerWebControlOperation,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "./hosted-execution-fixtures.ts";

const HASH = "a".repeat(64);

function createQuoteDenseClinicalBundleBody(): string {
  const prefix =
    '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Observation","valueString":"';
  const suffix = '"}}]}';
  const escapedQuote = '\\"';
  const escapedQuoteCount = Math.floor(
    (HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS - prefix.length - suffix.length)
      / escapedQuote.length,
  );
  return `${prefix}${escapedQuote.repeat(escapedQuoteCount)}${suffix}`;
}

function createThreeByteClinicalBundleBody(): string {
  const prefix =
    '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Observation","valueString":"';
  const suffix = '"}}]}';
  const priorTwoByteEnvelope =
    (2 * HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS) + (64 * 1024);
  const contentLength = Math.ceil(
    (priorTwoByteEnvelope - Buffer.byteLength(prefix) - Buffer.byteLength(suffix) + 1) / 3,
  );
  return `${prefix}${"漢".repeat(contentLength)}${suffix}`;
}

describe("hosted clinical records runtime port", () => {
  it("rejects direct callback transport without active write-fence authority", () => {
    expect(() => createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetch,
      timeoutMs: 5_000,
      transport: {
        callbackSigning: {
          keyId: "v1",
          privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
        mode: "direct",
        webControlBaseUrl: "https://web.example.test",
        workspaceCheckpointBridge: null,
      },
    })).toThrow("active write-fence authority");
  });

  it("allows and forwards only bounded execution contracts through the web-control proxy", async () => {
    const received: Array<{ body: unknown; path: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      received.push({ body: await request.json(), path });

      if (path === HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH) {
        return Response.json({
          run: {
            connectionId: "connection_1",
            fetchedAt: "2026-07-10T12:00:00.000Z",
            fhirBaseUrlHash: HASH,
            generation: 1,
            grantedScopes: ["patient/Observation.read"],
            patientIdHash: HASH,
            requestedScopes: ["patient/Observation.read"],
            retrievalJobId: "run_1",
            retrievalScopes: [{
              coverage: "whole-family",
              queryFingerprint: HASH,
              resourceType: "Observation",
            }],
            runId: "run_1",
            sourceSystem: "epic-fhir",
          },
          status: "ready",
        });
      }
      if (path === HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH) {
        return Response.json({
          connectUrl:
            `https://web.example.test/records/connect#clinicalRecordsIntent=cr_${"a".repeat(32)}`,
          expiresAt: "2026-07-10T12:15:00.000Z",
          ok: true,
        });
      }
      if (path === HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH) {
        return Response.json({
          body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
          nextCursor: null,
          status: "page",
        });
      }
      if (path === HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH) {
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    });
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    const requestKey = `scheduled_${"a".repeat(64)}`;
    await expect(port.createConnectLink?.({ requestKey }))
      .resolves.toMatchObject({ ok: true });
    await expect(port.readRun({ generation: 1, runId: "run_1" }))
      .resolves.toMatchObject({ status: "ready" });
    await expect(port.fetchPage({
      cursor: null,
      generation: 1,
      requestId: "request_1",
      resourceType: "Observation",
      runId: "run_1",
    })).resolves.toMatchObject({ nextCursor: null, status: "page" });
    await expect(port.recordOutcome({
      counts: {
        createdCount: 0,
        executableDecisionCount: 0,
        fetchedPageCount: 1,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 2,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      runId: "run_1",
      status: "completed",
    })).resolves.toBeUndefined();

    expect(received).toEqual([
      {
        body: { requestKey },
        path: HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
      },
      {
        body: { generation: 1, runId: "run_1" },
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
      },
      {
        body: {
          cursor: null,
          generation: 1,
          requestId: "request_1",
          resourceType: "Observation",
          runId: "run_1",
        },
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
      },
      {
        body: expect.objectContaining({
          generation: 1,
          runId: "run_1",
          status: "completed",
        }),
        path: HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
      },
    ]);
    expect(JSON.stringify(received)).not.toContain("member_1");
  });

  it("replays only deterministic scheduled connect-link requests after a retryable failure", async () => {
    const connectLink = {
      connectUrl: "https://web.example.test/records/connect?launch=clinical-records",
      expiresAt: null,
      ok: true,
    };
    const scheduledFetch = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 502 }))
      .mockResolvedValueOnce(Response.json(connectLink));
    const scheduledPort = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: scheduledFetch as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(scheduledPort.createConnectLink?.({
      requestKey: `scheduled_${"a".repeat(64)}`,
    })).resolves.toEqual(connectLink);
    expect(scheduledFetch).toHaveBeenCalledTimes(2);

    const acceptedFetch = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 502 }))
      .mockResolvedValueOnce(Response.json({
        ...connectLink,
        expiresAt: "2026-07-10T12:15:00.000Z",
      }));
    const acceptedPort = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: acceptedFetch as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(acceptedPort.createConnectLink?.()).rejects.toMatchObject({
      status: 502,
    });
    expect(acceptedFetch).toHaveBeenCalledOnce();

    const rejectedScheduledFetch = vi.fn()
      .mockResolvedValueOnce(new Response("invalid request", { status: 400 }))
      .mockResolvedValueOnce(Response.json(connectLink));
    const rejectedScheduledPort = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: rejectedScheduledFetch as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(rejectedScheduledPort.createConnectLink?.({
      requestKey: `scheduled_${"b".repeat(64)}`,
    })).rejects.toMatchObject({ status: 400 });
    expect(rejectedScheduledFetch).toHaveBeenCalledOnce();
  });

  it("transports a maximum-shape query descriptor inside the metadata envelope", async () => {
    const maxIdentifier = "i".repeat(120);
    const maxScope = "s".repeat(200);
    const responseBody = JSON.stringify({
      run: {
        connectionId: maxIdentifier,
        fetchedAt: "2026-07-10T12:00:00.000Z",
        fhirBaseUrlHash: HASH,
        generation: Number.MAX_SAFE_INTEGER,
        grantedScopes: Array.from({ length: 50 }, () => maxScope),
        patientIdHash: HASH,
        providerDirectoryEntryId: maxIdentifier,
        requestedScopes: Array.from({ length: 50 }, () => maxScope),
        retrievalJobId: maxIdentifier,
        retrievalProtocol: "query-slices-v2",
        retrievalSlices: Array.from(
          { length: CLINICAL_FHIR_MAX_RETRIEVAL_SLICES },
          (_, index) => ({
            coverage: "whole-family",
            queryFingerprint: HASH,
            queryScopeId: `${"q".repeat(118)}${String(index).padStart(2, "0")}`,
            resourceType: "DiagnosticReport",
            sliceId: "s".repeat(120),
          }),
        ),
        runId: maxIdentifier,
        sourceSystem: "epic-fhir",
      },
      status: "ready",
    });
    expect(new TextEncoder().encode(responseBody).byteLength)
      .toBeLessThanOrEqual(64 * 1024);
    const fetchMock = vi.fn(async () => new Response(responseBody, {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    const response = await port.readRun({ generation: 1, runId: "run_1" });
    expect(response).toMatchObject({ status: "ready" });
    if (response.status !== "ready" || !("retrievalProtocol" in response.run)) {
      throw new TypeError("Expected a query-aware Clinical Records run.");
    }
    expect(response.run.retrievalSlices)
      .toHaveLength(CLINICAL_FHIR_MAX_RETRIEVAL_SLICES);
  });

  it("preserves query, slice, and fingerprint identity through page and outcome callbacks", async () => {
    const received: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      received.push(await request.json());
      return new URL(request.url).pathname === HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH
        ? Response.json({
            body: "{\"resourceType\":\"Bundle\",\"entry\":[]}",
            nextCursor: null,
            status: "page",
          })
        : Response.json({ ok: true });
    });
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await port.fetchPage({
      cursor: null,
      generation: 1,
      queryFingerprint: HASH,
      queryScopeId: "laboratory-observations",
      requestId: "request_1",
      resourceType: "Observation",
      retrievalProtocol: "query-slices-v2",
      runId: "run_1",
      sliceId: "whole",
    });
    await port.recordOutcome({
      counts: {
        createdCount: 0,
        executableDecisionCount: 0,
        fetchedPageCount: 1,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 1,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      retrievalProtocol: "query-slices-v2",
      retrievalSlices: [{
        queryScopeId: "laboratory-observations",
        sliceId: "whole",
      }],
      runId: "run_1",
      status: "completed",
    });

    expect(received).toEqual([
      expect.objectContaining({
        queryFingerprint: HASH,
        queryScopeId: "laboratory-observations",
        sliceId: "whole",
      }),
      expect.objectContaining({
        retrievalProtocol: "query-slices-v2",
        retrievalSlices: [{
          queryScopeId: "laboratory-observations",
          sliceId: "whole",
        }],
      }),
    ]);
  });

  it("rejects a direct-transport connect link on another origin", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      connectUrl:
        `https://other.example.test/records/connect#clinicalRecordsIntent=cr_${"a".repeat(32)}`,
      expiresAt: "2026-07-10T12:15:00.000Z",
      ok: true,
    }));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: {
        callbackSigning: {
          keyId: "v1",
          privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
        mode: "direct",
        webControlBaseUrl: "https://web.example.test",
        workspaceCheckpointBridge: {
          readCurrentLease: () => ({
            attemptId: "attempt_1",
            leaseGeneration: "1",
            userId: "member_1",
            workspaceVersion: "1",
          }),
        },
      },
    });

    await expect(port.createConnectLink?.()).rejects.toThrow(
      "must use the configured Web origin",
    );
  });

  it("forwards cancellation through the outcome-record transport", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return await new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason),
          { once: true },
        );
      });
    });
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    const recording = port.recordOutcome({
      counts: {
        createdCount: 0,
        executableDecisionCount: 0,
        fetchedPageCount: 1,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 2,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      runId: "run_1",
      status: "completed",
    }, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("Foreground work arrived.", "AbortError"));

    await expect(recording).rejects.toMatchObject({
      hostedRuntimeFetchCallerSignalAborted: true,
      hostedRuntimeFetchCauseKind: "abort",
      hostedRuntimeFetchRequestSignalAborted: true,
    });
  });

  it("accepts a quote-dense valid page within the bounded response envelope", async () => {
    const body = createQuoteDenseClinicalBundleBody();
    const responseText = JSON.stringify({
      body,
      nextCursor: null,
      status: "page",
    });
    expect(body.length).toBeLessThanOrEqual(HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS);
    expect(new TextEncoder().encode(responseText).byteLength)
      .toBeLessThanOrEqual(HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES);
    expect(JSON.parse(body)).toMatchObject({ resourceType: "Bundle" });

    const fetchMock = vi.fn(async () => new Response(responseText, {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.fetchPage({
      cursor: null,
      generation: 1,
      requestId: "request_1",
      resourceType: "Observation",
      runId: "run_1",
    })).resolves.toMatchObject({ body, status: "page" });
  });

  it("forwards a three-byte page to the runtime-owned raw-byte limit", async () => {
    const body = createThreeByteClinicalBundleBody();
    const responseText = JSON.stringify({
      body,
      nextCursor: null,
      status: "page",
    });
    expect(body.length).toBeLessThanOrEqual(HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(
      CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
    );
    expect(new TextEncoder().encode(responseText).byteLength)
      .toBeLessThanOrEqual(HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES);
    expect(JSON.parse(body)).toMatchObject({ resourceType: "Bundle" });

    const fetchMock = vi.fn(async () => new Response(responseText, {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.fetchPage({
      cursor: null,
      generation: 1,
      requestId: "request_1",
      resourceType: "Observation",
      runId: "run_1",
    })).resolves.toMatchObject({ body, status: "page" });
  });

  it("forwards caller cancellation to an in-flight clinical control-plane read", async () => {
    const observed: { signal: AbortSignal | null } = { signal: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      observed.signal = request.signal;
      return await new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason),
          { once: true },
        );
      });
    });
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });
    const controller = new AbortController();

    const read = port.readRun(
      { generation: 1, runId: "run_1" },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("foreground work arrived", "AbortError"));

    await expect(read).rejects.toThrow(
      "Hosted clinical records read run request failed.",
    );
    expect(observed.signal?.aborted).toBe(true);
  });

  it("cancels a clinical response body that stalls after headers", async () => {
    let cancelled = false;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });
    const controller = new AbortController();
    const abortReason = new DOMException("foreground work arrived", "AbortError");

    const read = port.readRun(
      { generation: 1, runId: "run_1" },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(abortReason);

    await expect(read).rejects.toBe(abortReason);
    expect(cancelled).toBe(true);
  });

  it("keeps malformed sensitive clinical JSON out of propagated errors", async () => {
    const sensitiveText = "synthetic-clinical-sentinel";
    const fetchMock = vi.fn(async () => new Response(
      `{\"status\":\"ready\",\"detail\":${sensitiveText}}`,
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    try {
      await port.readRun({ generation: 1, runId: "run_1" });
      throw new Error("Expected malformed sensitive Clinical Records JSON to fail.");
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toBe("Hosted clinical records read run returned invalid JSON.");
      expect(error.message).not.toContain(sensitiveText);
      expect(Reflect.get(error, "code")).toBe(
        "HOSTED_WEB_CONTROL_SENSITIVE_RESPONSE_INVALID_JSON",
      );
      expect(Reflect.has(error, "cause")).toBe(false);
    }
  });

  it("cancels a fetch-page response at exactly one byte beyond its envelope limit", async () => {
    let cancelled = false;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(
          new Uint8Array(HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES),
        );
        controller.enqueue(new Uint8Array(1));
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    const port = createHostedWebClinicalRecordsPort({
      boundUserId: "member_1",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.fetchPage({
      cursor: null,
      generation: 1,
      requestId: "request_1",
      resourceType: "Observation",
      runId: "run_1",
    })).rejects.toThrow(
      `response exceeded the ${HOSTED_CLINICAL_RECORDS_FETCH_PAGE_RESPONSE_MAX_BYTES} byte safety limit`,
    );
    expect(cancelled).toBe(true);
  });

  it("classifies each clinical records route as an explicit POST-only operation", () => {
    expect(readHostedRunnerWebControlOperation({
      method: "POST",
      path: HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
    })).toBe("clinical_records_connect_link");
    expect(readHostedRunnerWebControlOperation({
      method: "POST",
      path: HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
    })).toBe("clinical_records_read_run");
    expect(readHostedRunnerWebControlOperation({
      method: "POST",
      path: HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
    })).toBe("clinical_records_fetch_page");
    expect(readHostedRunnerWebControlOperation({
      method: "POST",
      path: HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
    })).toBe("clinical_records_record_outcome");
    expect(readHostedRunnerWebControlOperation({
      method: "GET",
      path: HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
    })).toBe("web_control_blocked");
    expect(readHostedRunnerWebControlOperation({
      method: "GET",
      path: HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
    })).toBe("web_control_blocked");
  });
});
