import { describe, expect, it, vi } from "vitest";

import {
  buildHostedContainerFatalReportBody,
  buildHostedContainerFatalReportPayload,
  HOSTED_CONTAINER_FATAL_REPORT_MAX_BODY_BYTES,
  HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS,
  reportHostedContainerFatalBestEffort,
} from "../src/container-fatal-report.ts";
import {
  CLOUDFLARE_HOSTED_CONTAINER_FATAL_ENDPOINT,
} from "../src/internal-hosts.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../src/runner-outbound/headers.ts";

describe("buildHostedContainerFatalReportPayload", () => {
  it("builds a redacted payload from an Error through the shared safe-error helper", () => {
    const payload = buildHostedContainerFatalReportPayload({
      error: Object.assign(new TypeError("synthetic fatal detail"), {
        code: "ECONNRESET",
      }),
      stage: "unhandled_rejection",
    });

    expect(payload.stage).toBe("unhandled_rejection");
    expect(payload.errorName).toBe("TypeError");
    expect(typeof payload.errorCode).toBe("string");
    expect(payload.safeErrorDetails).toBeDefined();
  });

  it("degrades an oversized sanitized payload to a truncated envelope under the route cap", () => {
    const hugeDetails: Record<string, string> = {};
    for (let index = 0; index < 32; index += 1) {
      hugeDetails[`detail_${index}`] = "x".repeat(300);
    }
    const body = buildHostedContainerFatalReportBody({
      error: Object.assign(new TypeError("synthetic oversized fatal"), {
        details: hugeDetails,
      }),
      stage: "uncaught_exception",
    });

    expect(new TextEncoder().encode(body).byteLength)
      .toBeLessThanOrEqual(HOSTED_CONTAINER_FATAL_REPORT_MAX_BODY_BYTES);
    const parsed = JSON.parse(body);
    expect(parsed.detailsTruncated).toBe(true);
    expect(parsed.stage).toBe("uncaught_exception");
    expect(parsed.errorName).toBe("TypeError");
    expect(parsed.safeErrorDetails).toBeUndefined();
  });

  it("keeps non-Error fatal values out of the payload entirely", () => {
    const payload = buildHostedContainerFatalReportPayload({
      error: "raw string with possibly sensitive content",
      stage: "uncaught_exception",
    });

    expect(payload.stage).toBe("uncaught_exception");
    expect(payload.errorName).toBeUndefined();
    expect(payload.safeErrorDetails).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("possibly sensitive");
  });
});

describe("reportHostedContainerFatalBestEffort", () => {
  it("posts the payload to the runner-control fatal endpoint", async () => {
    const requests: Array<{ init: RequestInit | undefined; url: string }> = [];
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ init, url: String(url) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await reportHostedContainerFatalBestEffort({
      boundUserId: "member_123",
      error: new Error("synthetic fatal"),
      fetchImpl,
      stage: "shell_isolation_poison",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(CLOUDFLARE_HOSTED_CONTAINER_FATAL_ENDPOINT);
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe("member_123");
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body.stage).toBe("shell_isolation_poison");
  });

  it("omits the bound user header when no user binding exists", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    await reportHostedContainerFatalBestEffort({
      error: new Error("synthetic fatal"),
      fetchImpl,
      stage: "uncaught_exception",
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBeNull();
  });

  it("swallows transport failures so a dying process never gains a new rejection", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });

    await expect(reportHostedContainerFatalBestEffort({
      error: new Error("synthetic fatal"),
      fetchImpl,
      stage: "entrypoint_start_failed",
    })).resolves.toBeUndefined();
  });

  it("resolves on its own deadline even when fetch never settles", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (() => new Promise<Response>(() => {
        // Never settles and ignores the abort signal entirely.
      })) as typeof fetch;
      const report = reportHostedContainerFatalBestEffort({
        error: new Error("synthetic fatal"),
        fetchImpl,
        stage: "uncaught_exception",
      });
      await vi.advanceTimersByTimeAsync(HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS + 600);
      await expect(report).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
