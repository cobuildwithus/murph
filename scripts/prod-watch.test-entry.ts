#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";

const TEST_OVERRIDES_KEY = "__MURPH_PROD_WATCH_TEST_OVERRIDES__";
const runtimeRoot = process.env.MURPH_PROD_WATCH_TEST_RUNTIME_ROOT;
const vercelFetchLog = process.env.TEST_VERCEL_FETCH_LOG;
const vercelToken = process.env.TEST_VERCEL_TOKEN;
const providerTrackerPath = process.env.TEST_PROVIDER_TRACKER_PATH;
const withTrackedProviderWork = providerTrackerPath === undefined
  ? async <T>(_label: string, _gated: boolean, operation: () => Promise<T>): Promise<T> => await operation()
  : (createRequire(import.meta.url)(providerTrackerPath) as {
      withTrackedProviderWork: <T>(label: string, gated: boolean, operation: () => Promise<T>) => Promise<T>;
    }).withTrackedProviderWork;
let vercelRequestCount = 0;

if (vercelFetchLog !== undefined && vercelToken !== undefined) {
  const mockedVercelFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const isRequestLogs = url.hostname === "vercel.com" && url.pathname === "/api/logs/request-logs";
    const label = isRequestLogs
      ? `vercel:request:${++vercelRequestCount}`
      : url.pathname === "/v2/teams"
        ? "vercel:teams"
        : "vercel:project";
    return await withTrackedProviderWork(label, isRequestLogs && vercelRequestCount <= 7, async () => {
      appendFileSync(vercelFetchLog, `${url.hostname}${url.pathname}\n`);
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization !== `Bearer ${vercelToken}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.hostname === "api.vercel.com" && url.pathname === "/v2/teams") {
        return new Response(JSON.stringify({
          teams: [{ id: "team-test", slug: "cobuildwithus" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "api.vercel.com" && url.pathname === "/v9/projects/murph") {
        return new Response(JSON.stringify({ id: "project-test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (isRequestLogs) {
        if (process.env.TEST_PROVIDER_FAIL_LABEL === label) {
          return new Response(JSON.stringify({ error: "synthetic_provider_failure" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if (process.env.TEST_PROVIDER_FAIL_LABEL !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (init?.signal?.aborted) {
            throw new DOMException("synthetic_provider_abort", "AbortError");
          }
        }
        const referenceMs = Number(process.env.TEST_PROVIDER_REFERENCE_MS ?? Date.now());
        const isDetailQuery = ["statusCode", "level", "search"]
          .some((key) => url.searchParams.has(key));
        const rows = process.env.TEST_VERCEL_NONEMPTY !== "1"
          ? []
          : isDetailQuery
            ? [
                vercelRow("current-failure", referenceMs - 14 * 60_000, 504, "warning", "deadline exceeded"),
                vercelRow("current-success", referenceMs - 60_000, 200, "info", "completed"),
                vercelRow("previous-failure", referenceMs - 16 * 60_000, 500, "warning", "retry scheduled"),
                vercelRow("previous-success", referenceMs - 29 * 60_000, 200, "info", "completed"),
                vercelRow("outside-window", referenceMs - 31 * 60_000, 500, "error", "outside"),
                vercelRow("future-window", referenceMs + 60_000, 500, "error", "future"),
              ]
            : [
                vercelRow(`sample-${label}-a`, referenceMs - 2_000, 200, "info", "sample"),
                vercelRow(`sample-${label}-b`, referenceMs - 1_000, 200, "info", "sample"),
              ];
        return new Response(JSON.stringify({ rows, hasMoreRows: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected_test_url" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
  };
  globalThis.fetch = mockedVercelFetch;
}

function vercelRow(
  requestId: string,
  timestamp: number,
  statusCode: number,
  level: string,
  message: string,
): Record<string, unknown> {
  return { requestId, timestamp, statusCode, logs: [{ level, message }] };
}

if (runtimeRoot === undefined) {
  console.error("prod-watch-test: test_runtime_root_required");
  process.exitCode = 1;
} else {
  (globalThis as Record<string, unknown>)[TEST_OVERRIDES_KEY] = Object.freeze({
    runtimeRoot,
    providerFixture: process.env.TEST_PROVIDER_FIXTURE,
    nodeModulesSource: process.env.TEST_NODE_MODULES_SOURCE,
    codexBin: process.env.MURPH_PROD_WATCH_CODEX_BIN,
    mcpRemoteBin: process.env.TEST_MCP_REMOTE_BIN,
    codexArgsCapture: process.env.TEST_CODEX_ARGS_CAPTURE,
    codexPromptCapture: process.env.TEST_CODEX_PROMPT_CAPTURE,
    extraMcp: process.env.TEST_CODEX_EXTRA_MCP === "1",
    providerTrackerPath,
    providerActiveRoot: process.env.TEST_PROVIDER_ACTIVE_ROOT,
    providerTimeline: process.env.TEST_PROVIDER_TIMELINE,
    providerGateCount: process.env.TEST_PROVIDER_GATE_COUNT,
    providerFailLabel: process.env.TEST_PROVIDER_FAIL_LABEL,
  });
  try {
    const [{ runCli }, { safeErrorCode }] = await Promise.all([
      import("./prod-watch.ts"),
      import("./prod-watch/core.ts"),
    ]);
    delete (globalThis as Record<string, unknown>)[TEST_OVERRIDES_KEY];
    try {
      await runCli(process.argv.slice(2));
    } catch (error) {
      console.error(`prod-watch-test: ${safeErrorCode(error)}`);
      process.exitCode = 1;
    }
  } catch {
    console.error("prod-watch-test: test_entry_import_failed");
    process.exitCode = 1;
  }
}
