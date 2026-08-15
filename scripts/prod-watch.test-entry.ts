#!/usr/bin/env node

import process from "node:process";

const TEST_OVERRIDES_KEY = "__MURPH_PROD_WATCH_TEST_OVERRIDES__";
const runtimeRoot = process.env.MURPH_PROD_WATCH_TEST_RUNTIME_ROOT;
const providerTrackerPath = process.env.TEST_PROVIDER_TRACKER_PATH;

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
  } catch (error) {
    const errorCode = error instanceof Error
      && typeof (error as NodeJS.ErrnoException).code === "string"
      && /^[A-Z0-9_]{1,32}$/u.test((error as NodeJS.ErrnoException).code!)
      ? (error as NodeJS.ErrnoException).code
      : error instanceof SyntaxError
        ? "SYNTAX_ERROR"
        : error instanceof Error && /^[A-Za-z0-9._-]{1,64}$/u.test(error.message)
          ? error.message
          : "test_entry_import_failed";
    console.error(`prod-watch-test: ${errorCode}`);
    process.exitCode = 1;
  }
}
