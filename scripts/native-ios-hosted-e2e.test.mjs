import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDispatchInputs,
  dispatchAndWait,
  inspectPrivateDispatchTag,
  inspectPrivateRun,
} from "./native-ios-hosted-e2e-native.mjs";
import {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  inspectBoundedCommandResult,
  inspectNativeE2EControllerPolicy,
  readNativeE2EControllerPolicy,
  runBoundedCommand,
  selectProductionCanaryWebSha,
} from "./native-ios-hosted-e2e-support.mjs";

const SHA = "a".repeat(40);
const IOS_SHA = "b".repeat(40);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROLLER_POLICY = path.join(REPO_ROOT, ".github", "native-hosted-e2e-controller.json");
const COMMAND_TREE_FIXTURE = path.join(
  REPO_ROOT,
  "scripts",
  "fixtures",
  "native-ios-hosted-e2e-command-tree.mjs",
);

test("production iOS contract is minimal and non-destructive", () => {
  assert.equal(NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION, "3");
  assert.deepEqual(buildDispatchInputs({
    correlationId: "murph-production-canary",
    webBaseUrl: "https://www.withmurph.ai",
    webSha: SHA,
  }), {
    contract_version: "3",
    correlation_id: "murph-production-canary",
    identity_lifecycle: "non_destructive_existing_identity",
    mode: "production_canary",
    web_base_url: "https://www.withmurph.ai",
    web_sha: SHA,
  });
  assert.throws(() => buildDispatchInputs({
    correlationId: "murph-production-canary",
    webBaseUrl: "https://candidate.example.test",
    webSha: SHA,
  }), /production origin/u);
});

test("protected-main policy owns both immutable native sources", async () => {
  const policy = await readNativeE2EControllerPolicy(CONTROLLER_POLICY);
  assert.match(policy.ios.privateRef, /^native-ios-e2e-/u);
  assert.match(policy.android.privateRef, /^native-android-e2e-/u);
  assert.match(policy.ios.privateSha, /^[0-9a-f]{40}$/u);
  assert.match(policy.android.privateSha, /^[0-9a-f]{40}$/u);

  assert.throws(() => inspectNativeE2EControllerPolicy({
    contractVersion: 2,
    ios: policy.ios,
    android: policy.android,
  }), /version/u);
  assert.throws(() => inspectNativeE2EControllerPolicy({
    contractVersion: 1,
    ios: { privateRef: "refs/heads/main", privateSha: policy.ios.privateSha },
    android: policy.android,
  }), /lightweight tag/u);
  assert.throws(() => inspectNativeE2EControllerPolicy({
    contractVersion: 1,
    ios: { privateRef: policy.ios.privateRef, privateSha: "not-a-sha" },
    android: policy.android,
  }), /40-character SHA/u);
});

test("trusted iOS controller is six-hour, latest-outcome gated, and production-only", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "native-ios-hosted-e2e.yml"),
    "utf8",
  );
  const workflowConcurrency = workflow.slice(
    workflow.indexOf("\nconcurrency:\n"),
    workflow.indexOf("\njobs:\n"),
  );

  assert.match(workflow, /schedule:\n\s+- cron: "17 \*\/6 \* \* \*"/u);
  assert.match(workflow, /actions: read\n\s+contents: read/u);
  assert.match(workflowConcurrency, /group: native-ios-production-canary/u);
  assert.match(workflowConcurrency, /cancel-in-progress: false/u);
  assert.doesNotMatch(workflowConcurrency, /queue:/u);
  assert.match(
    workflow,
    /native-ios-hosted-e2e\.yml\/runs\?event=schedule&status=completed&per_page=1/u,
  );
  assert.doesNotMatch(workflow, /status=success/u);
  assert.match(workflow, /previous_conclusion.*success/su);
  assert.match(workflow, /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/u);
  assert.match(workflow, /CURRENT_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /if: \$\{\{ needs\.select-main\.outputs\.should_run == 'true' \}\}/u);
  assert.match(workflow, /environment: native-ios-production-canary/u);
  assert.match(workflow, /node scripts\/native-ios-hosted-e2e\.mjs canary/u);
  assert.match(workflow, /--policy \.github\/native-hosted-e2e-controller\.json/u);
  assert.match(workflow, /NATIVE_IOS_E2E_IOS_WORKFLOW/u);
  assert.doesNotMatch(workflow, /NATIVE_IOS_E2E_IOS_(?:EXPECTED_SHA|REF)/u);
  assert.doesNotMatch(
    workflow,
    /workflow_run:|deployment_status:|workflow_dispatch:|pull_request:|push:|pull-requests:|statuses: write|node scripts\/native-ios-hosted-e2e\.mjs pr/u,
  );
  assert.doesNotMatch(
    workflow,
    /NATIVE_IOS_E2E_DATABASE_URL|NATIVE_IOS_E2E_PRIVY_TEST_PHONE|NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID/u,
  );

  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  assert.deepEqual(
    [...jobs.matchAll(/^  (?<name>[a-z][a-z-]+):$/gmu)].map((match) => match.groups.name),
    ["select-main", "production-canary"],
  );
  for (const line of workflow.split("\n").filter((value) => /^\s*uses:/u.test(value))) {
    assert.match(line, /uses: [^\s]+@[0-9a-f]{40}(?:\s|$)/u, line);
  }
});

test("iOS schedule skips only a same-SHA successful latest outcome", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "native-ios-hosted-e2e.yml"),
    "utf8",
  );
  const script = extractWorkflowStepScript(
    workflow,
    "Compare main with the latest completed scheduled outcome",
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-cadence-proof-"));
  try {
    await writeFile(path.join(tempDir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 4 ]] || exit 64
[[ "$1" == api ]] || exit 64
[[ "$2" == "repos/\${GITHUB_REPOSITORY}/actions/workflows/native-ios-hosted-e2e.yml/runs?event=schedule&status=completed&per_page=1" ]] || exit 64
[[ "$3" == --jq ]] || exit 64
[[ "$4" == '.workflow_runs[0] // {}' ]] || exit 64
[[ "\${FAIL_HISTORY_LOOKUP:-0}" != 1 ]] || exit 42
if [[ -z "\${PREVIOUS_SHA:-}" ]]; then
  printf '{}\n'
else
  printf '{"head_sha":"%s","status":"%s","conclusion":"%s"}\n' "\${PREVIOUS_SHA}" "\${PREVIOUS_STATUS:-completed}" "\${PREVIOUS_CONCLUSION:-success}"
fi
`, { mode: 0o755 });
    const scenarios = [
      { attempt: "1", conclusion: "", expected: "true", previousSha: "" },
      { attempt: "1", conclusion: "success", expected: "false", previousSha: SHA },
      { attempt: "1", conclusion: "failure", expected: "true", previousSha: SHA },
      { attempt: "1", conclusion: "success", expected: "true", previousSha: "c".repeat(40) },
      { attempt: "2", conclusion: "success", expected: "true", previousSha: SHA },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const outputPath = path.join(tempDir, `output-${index}`);
      const result = spawnSync("bash", ["-c", script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          CURRENT_SHA: SHA,
          FAIL_HISTORY_LOOKUP: scenario.attempt === "2" ? "1" : "0",
          GITHUB_OUTPUT: outputPath,
          GITHUB_REPOSITORY: "example/murph",
          PATH: `${tempDir}:${process.env.PATH ?? ""}`,
          PREVIOUS_CONCLUSION: scenario.conclusion,
          PREVIOUS_SHA: scenario.previousSha,
          RUN_ATTEMPT: scenario.attempt,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const output = Object.fromEntries(
        (await readFile(outputPath, "utf8"))
          .trim()
          .split("\n")
          .map((line) => line.split("=", 2)),
      );
      assert.deepEqual(output, { should_run: scenario.expected, web_sha: SHA });
    }

    for (const [invalidIndex, invalid] of [
      { PREVIOUS_SHA: "not-a-sha" },
      { PREVIOUS_CONCLUSION: "unknown", PREVIOUS_SHA: SHA },
      { PREVIOUS_SHA: SHA, PREVIOUS_STATUS: "in_progress" },
    ].entries()) {
      const result = spawnSync("bash", ["-c", script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          CURRENT_SHA: SHA,
          GITHUB_OUTPUT: path.join(tempDir, `invalid-${invalidIndex}`),
          GITHUB_REPOSITORY: "example/murph",
          PATH: `${tempDir}:${process.env.PATH ?? ""}`,
          PREVIOUS_CONCLUSION: "success",
          PREVIOUS_STATUS: "completed",
          RUN_ATTEMPT: "1",
          ...invalid,
        },
      });
      assert.equal(result.status, 1);
    }

    const historyFailure = spawnSync("bash", ["-c", script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CURRENT_SHA: SHA,
        FAIL_HISTORY_LOOKUP: "1",
        GITHUB_OUTPUT: path.join(tempDir, "history-failure-output"),
        GITHUB_REPOSITORY: "example/murph",
        PATH: `${tempDir}:${process.env.PATH ?? ""}`,
        RUN_ATTEMPT: "1",
      },
    });
    assert.equal(historyFailure.status, 42);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("release-note-only alias lag dispatches the actual production SHA", () => {
  let classifiedEnv = null;
  assert.equal(selectProductionCanaryWebSha(SHA, SHA, {
    classifyBuild: () => {
      throw new Error("same SHA must not classify a range");
    },
  }), SHA);
  assert.equal(selectProductionCanaryWebSha(SHA, IOS_SHA, {
    classifyBuild: ({ env }) => {
      classifiedEnv = env;
      return { reason: "eligible-markdown-docs", skipBuild: true };
    },
  }), SHA);
  assert.deepEqual(classifiedEnv, {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: IOS_SHA,
    VERCEL_GIT_PREVIOUS_SHA: SHA,
  });
  assert.throws(() => selectProductionCanaryWebSha(SHA, IOS_SHA, {
    classifyBuild: () => ({ reason: "ineligible-path", skipBuild: false }),
  }), /runtime-relevant change/u);
});

test("private workflow proof pins the immutable tag and returned run SHA", () => {
  assert.equal(inspectPrivateDispatchTag({
    object: { sha: IOS_SHA, type: "commit" },
    ref: "refs/tags/native-ios-e2e-v3",
  }, { expectedSha: IOS_SHA, ref: "native-ios-e2e-v3" }), IOS_SHA);
  assert.throws(() => inspectPrivateDispatchTag({
    object: { sha: IOS_SHA, type: "commit" },
    ref: "refs/tags/native-ios-e2e-v3",
  }, { expectedSha: SHA, ref: "native-ios-e2e-v3" }), /reviewed pinned SHA/u);
  assert.deepEqual(inspectPrivateRun({
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: IOS_SHA,
    id: 42,
    status: "completed",
  }, { runId: 42, sha: IOS_SHA }), { complete: true, conclusion: "success" });
  assert.throws(() => inspectPrivateRun({
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: SHA,
    id: 42,
    status: "completed",
  }, { runId: 42, sha: IOS_SHA }), /does not match/u);
});

test("iOS canary resolves production, proves the pinned tag, and accepts one exact run", async () => {
  const env = {
    NATIVE_IOS_E2E_GITHUB_TOKEN: "private-token",
    NATIVE_IOS_E2E_IOS_REPOSITORY: "example/murph-ios",
    NATIVE_IOS_E2E_IOS_WORKFLOW: "native-ios-hosted-e2e.yml",
  };
  const originalEnv = new Map(Object.keys(env).map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const calls = [];
  try {
    Object.assign(process.env, env);
    console.log = () => undefined;
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value.includes("/git/ref/tags/")) {
        calls.push("tag");
        return jsonResponse({
          object: { sha: IOS_SHA, type: "commit" },
          ref: "refs/tags/native-ios-e2e-v3",
        });
      }
      if (value.endsWith("/dispatches")) {
        calls.push("dispatch");
        const body = JSON.parse(init.body);
        assert.equal(body.ref, "native-ios-e2e-v3");
        assert.equal(body.inputs.web_sha, SHA);
        assert.equal(body.inputs.mode, "production_canary");
        return jsonResponse({ workflow_run_id: 42 });
      }
      if (value.endsWith("/actions/runs/42")) {
        calls.push("status");
        return jsonResponse({
          conclusion: "success",
          event: "workflow_dispatch",
          head_sha: IOS_SHA,
          id: 42,
          status: "completed",
        });
      }
      throw new Error(`unexpected URL ${value}`);
    };
    await dispatchAndWait({
      correlationId: "murph-production-canary",
      source: { privateRef: "native-ios-e2e-v3", privateSha: IOS_SHA },
      webBaseUrl: "https://www.withmurph.ai",
      webSha: SHA,
    }, {
      resolveWebSha: async ({ scheduledMainSha }) => {
        calls.push("production");
        assert.equal(scheduledMainSha, SHA);
        return SHA;
      },
    });
    assert.deepEqual(calls, ["production", "tag", "dispatch", "status"]);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("bounded command result is explicit and fail closed", () => {
  assert.equal(inspectBoundedCommandResult({
    code: 0,
    label: "test command",
    maxOutputChars: 200,
    outputLength: 40,
    timedOut: false,
  }), true);
  assert.throws(() => inspectBoundedCommandResult({
    code: null,
    label: "test command",
    timedOut: true,
  }), /timed out/u);
  assert.throws(() => inspectBoundedCommandResult({
    code: 0,
    label: "test command",
    maxOutputChars: 200,
    outputLength: 201,
    timedOut: false,
  }), /more output than expected/u);
  assert.throws(() => inspectBoundedCommandResult({
    code: 1,
    label: "test command",
    timedOut: false,
  }), /failed/u);
});

test("bounded command timeout reaps its wrapper and grandchild", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-command-timeout-"));
  const pidFile = path.join(tempDir, "pids.json");
  try {
    await assert.rejects(() => runBoundedCommand({
      argv: [COMMAND_TREE_FIXTURE, "wrapper", "timeout", pidFile],
      command: process.execPath,
      env: process.env,
      label: "wrapper timeout",
      timeoutMs: 1_500,
    }), /timed out/u);
    await assertOwnedProcessesGone(pidFile);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("bounded command output overflow reaps its wrapper and grandchild", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-command-overflow-"));
  const pidFile = path.join(tempDir, "pids.json");
  try {
    await assert.rejects(() => runBoundedCommand({
      argv: [COMMAND_TREE_FIXTURE, "wrapper", "overflow", pidFile],
      captureStdout: true,
      command: process.execPath,
      env: process.env,
      label: "wrapper overflow",
      maxOutputChars: 128,
      timeoutMs: 5_000,
    }), /more output than expected/u);
    await assertOwnedProcessesGone(pidFile);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("bounded command success waits for its wrapper and grandchild", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-command-success-"));
  const pidFile = path.join(tempDir, "pids.json");
  try {
    assert.equal(await runBoundedCommand({
      argv: [COMMAND_TREE_FIXTURE, "wrapper", "success", pidFile],
      captureStdout: true,
      command: process.execPath,
      env: process.env,
      label: "wrapper success",
      maxOutputChars: 200,
      timeoutMs: 5_000,
    }), "grandchild:success\nwrapper:success\n");
    await assertOwnedProcessesGone(pidFile);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

function extractWorkflowStepScript(workflow, stepName) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}\n`);
  assert.ok(stepStart >= 0, `${stepName} step must exist`);
  const runMarker = "        run: |\n";
  const scriptStart = workflow.indexOf(runMarker, stepStart);
  assert.ok(scriptStart >= 0, `${stepName} script must exist`);
  const scriptLines = [];
  for (const line of workflow.slice(scriptStart + runMarker.length).split("\n")) {
    if (!line.startsWith("          ")) break;
    scriptLines.push(line.slice(10));
  }
  assert.ok(scriptLines.length > 0, `${stepName} script must be readable`);
  return scriptLines.join("\n");
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

async function assertOwnedProcessesGone(pidFile) {
  const pids = JSON.parse(await readFile(pidFile, "utf8"));
  for (const [label, pid] of Object.entries(pids)) {
    assert.equal(Number.isSafeInteger(pid) && pid > 0, true, `${label} pid was invalid`);
    assert.equal(processExists(pid), false, `${label} process ${pid} was still running`);
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}
