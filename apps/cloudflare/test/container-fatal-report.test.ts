import { describe, expect, it, vi } from "vitest";

import {
  buildHostedContainerFatalReportPayload,
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
  it("posts the payload to the runner-control fatal endpoint with a bounded timeout", async () => {
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

  it("keeps the report timeout shorter than the entrypoint hard-exit backstop", () => {
    expect(HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });
});
