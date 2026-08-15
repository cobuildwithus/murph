#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import process from "node:process";

const TEST_OVERRIDES_KEY = "__MURPH_PROD_WATCH_TEST_OVERRIDES__";
const runtimeRoot = process.env.MURPH_PROD_WATCH_TEST_RUNTIME_ROOT;
const vercelFetchLog = process.env.TEST_VERCEL_FETCH_LOG;
const vercelToken = process.env.TEST_VERCEL_TOKEN;

if (vercelFetchLog !== undefined && vercelToken !== undefined) {
  const mockedVercelFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
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
    if (url.hostname === "vercel.com" && url.pathname === "/api/logs/request-logs") {
      return new Response(JSON.stringify({ rows: [], hasMoreRows: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "unexpected_test_url" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  globalThis.fetch = mockedVercelFetch;
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
