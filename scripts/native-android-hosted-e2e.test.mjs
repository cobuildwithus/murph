import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NATIVE_ANDROID_HOSTED_E2E_CONTRACT_VERSION,
  PRIVATE_ANDROID_DISPATCH_TTL_SECONDS,
  PRIVATE_ANDROID_JOB_TIMEOUT_SECONDS,
  PRIVATE_ANDROID_TERMINAL_GRACE_SECONDS,
  buildDispatchInputs,
  createGitHubAppTokenSupplier,
  dispatchAndWait,
  inspectPrivateDispatchTag,
  inspectPrivateRun,
  inspectPrivateRunActionStatus,
  privateRunExecutionFenceDeadlineMs,
} from "./native-android-hosted-e2e-native.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_SHA = "a".repeat(40);
const ANDROID_SHA = "b".repeat(40);
const ANDROID_TAG = "native-hosted-e2e/android-v1";
const SOURCE = { privateRef: ANDROID_TAG, privateSha: ANDROID_SHA };
const PRIVATE_ENV = {
  NATIVE_ANDROID_E2E_ANDROID_REPOSITORY: "example/murph-android",
  NATIVE_ANDROID_E2E_ANDROID_WORKFLOW: "native-android-hosted-e2e.yml",
};

function canaryInputs(overrides = {}) {
  return {
    androidSha: ANDROID_SHA,
    androidTag: ANDROID_TAG,
    correlationId: "murph-production-safe",
    dispatchExpiresAt: 2_000_000_000,
    webBaseUrl: "https://www.withmurph.ai",
    webSha: WEB_SHA,
    ...overrides,
  };
}

function canaryDispatch(overrides = {}) {
  return {
    correlationId: "murph-production-safe",
    source: SOURCE,
    webBaseUrl: "https://www.withmurph.ai",
    webSha: WEB_SHA,
    ...overrides,
  };
}

test("Android dispatch contract binds exact sources and non-destructive production mode", () => {
  assert.deepEqual(buildDispatchInputs(canaryInputs()), {
    android_sha: ANDROID_SHA,
    android_tag: ANDROID_TAG,
    contract_version: NATIVE_ANDROID_HOSTED_E2E_CONTRACT_VERSION,
    correlation_id: "murph-production-safe",
    dispatch_expires_at: "2000000000",
    identity_lifecycle: "non_destructive_existing_identity",
    mode: "production_canary",
    web_base_url: "https://www.withmurph.ai",
    web_sha: WEB_SHA,
  });
  assert.equal(PRIVATE_ANDROID_DISPATCH_TTL_SECONDS, 30 * 60);

  for (const override of [
    { androidSha: "b".repeat(39) },
    { androidTag: "refs/tags/native-e2e" },
    { androidTag: "native//e2e" },
    { androidTag: "native/../e2e" },
    { correlationId: "unsafe value" },
    { dispatchExpiresAt: 0 },
    { dispatchExpiresAt: 2_000_000_000.5 },
    { webBaseUrl: "https://candidate.example.test" },
    { webBaseUrl: "https://www.withmurph.ai/path" },
    { webSha: "A".repeat(40) },
  ]) {
    assert.throws(() => buildDispatchInputs(canaryInputs(override)));
  }
});

test("private Android tag, run, cancellation, and fence proofs are exact", () => {
  assert.equal(inspectPrivateDispatchTag({
    object: { sha: ANDROID_SHA, type: "commit" },
    ref: `refs/tags/${ANDROID_TAG}`,
  }, { expectedSha: ANDROID_SHA, ref: ANDROID_TAG }), ANDROID_SHA);
  assert.throws(() => inspectPrivateDispatchTag({
    object: { sha: "c".repeat(40), type: "commit" },
    ref: `refs/tags/${ANDROID_TAG}`,
  }, { expectedSha: ANDROID_SHA, ref: ANDROID_TAG }));
  assert.throws(() => inspectPrivateDispatchTag({
    object: { sha: ANDROID_SHA, type: "tag" },
    ref: `refs/tags/${ANDROID_TAG}`,
  }, { expectedSha: ANDROID_SHA, ref: ANDROID_TAG }));

  assert.deepEqual(inspectPrivateRun({
    conclusion: null,
    event: "workflow_dispatch",
    head_sha: ANDROID_SHA,
    id: 42,
    status: "in_progress",
  }, { runId: 42, sha: ANDROID_SHA }), { complete: false, conclusion: null });
  assert.throws(() => inspectPrivateRun({
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: "c".repeat(40),
    id: 42,
    status: "completed",
  }, { runId: 42, sha: ANDROID_SHA }));

  assert.equal(inspectPrivateRunActionStatus(202, "cancel"), true);
  assert.equal(inspectPrivateRunActionStatus(409, "cancel"), true);
  assert.throws(() => inspectPrivateRunActionStatus(200, "cancel"));
  assert.throws(() => inspectPrivateRunActionStatus(403, "cancel"));

  const dispatchExpiresAt = 2_000_000_000;
  assert.equal(PRIVATE_ANDROID_JOB_TIMEOUT_SECONDS, 55 * 60);
  assert.equal(PRIVATE_ANDROID_TERMINAL_GRACE_SECONDS, 2 * 60);
  assert.equal(
    privateRunExecutionFenceDeadlineMs(dispatchExpiresAt),
    (dispatchExpiresAt + 55 * 60 + 2 * 60) * 1000,
  );
  assert.throws(() => privateRunExecutionFenceDeadlineMs(0));
  assert.throws(() => privateRunExecutionFenceDeadlineMs(2_000_000_000.5));
});

test("Android canary resolves production, proves the pinned tag, and accepts one exact run", async () => {
  const calls = [];
  await withPrivateEnv(async () => {
    await dispatchAndWait(canaryDispatch(), {
      fetchImpl: async (url, init) => {
        calls.push("dispatch");
        assert.match(String(url), /\/dispatches$/u);
        assert.equal(init.headers.authorization, "Bearer private-token");
        const body = JSON.parse(init.body);
        assert.equal(body.ref, ANDROID_TAG);
        assert.equal(body.inputs.web_sha, WEB_SHA);
        assert.equal(body.inputs.mode, "production_canary");
        return jsonResponse({ workflow_run_id: 42 });
      },
      fetchJsonImpl: async (url, init) => {
        const value = String(url);
        if (value.includes("/git/ref/tags/")) {
          calls.push("tag");
          assert.equal(init.headers.authorization, "Bearer private-token");
          return privateTag();
        }
        if (value.endsWith("/actions/runs/42")) {
          calls.push("status");
          assert.equal(init.headers.authorization, "Bearer private-token");
          return completedRun("success");
        }
        throw new Error(`unexpected URL ${value}`);
      },
      resolveWebSha: async ({ scheduledMainSha }) => {
        calls.push("production");
        assert.equal(scheduledMainSha, WEB_SHA);
        return WEB_SHA;
      },
      tokenSupplier: async () => "private-token",
    });
  });
  assert.deepEqual(calls, ["production", "tag", "dispatch", "status"]);
});

for (const [name, dispatchResponse] of [
  ["lost response", () => { throw new Error("response lost"); }],
  ["invalid JSON", () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid"); } })],
  ["missing run id", () => jsonResponse({})],
]) {
  test(`unreceipted Android dispatch fences cleanup for ${name}`, async () => {
    let nowMs = 2_000_000_000_000;
    const dispatchExpiresAt = Math.floor(nowMs / 1000) + PRIVATE_ANDROID_DISPATCH_TTL_SECONDS;
    const deadlineMs = privateRunExecutionFenceDeadlineMs(dispatchExpiresAt);
    let fenceSleeps = 0;
    await withPrivateEnv(async () => {
      await assert.rejects(() => dispatchAndWait(canaryDispatch(), {
        fetchImpl: async () => dispatchResponse(),
        fetchJsonImpl: privatePrerequisiteResponse,
        now: () => nowMs,
        resolveWebSha: async () => WEB_SHA,
        sleepImpl: async () => {
          fenceSleeps += 1;
          nowMs = deadlineMs;
        },
        tokenSupplier: async () => "private-token",
      }), /dispatch receipt was uncertain/u);
    });
    assert.equal(fenceSleeps, 1);
    assert.equal(nowMs, deadlineMs);
  });
}

test("Android dispatch cancellation escalates on the same attested run", async () => {
  let nowMs = 2_000_000_000_000;
  let statusCalls = 0;
  const actions = [];
  let sleepCalls = 0;
  await withPrivateEnv(async () => {
    await assert.rejects(() => dispatchAndWait(canaryDispatch(), {
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.endsWith("/dispatches")) return jsonResponse({ workflow_run_id: 42 });
        actions.push(value.endsWith("/force-cancel") ? "force-cancel" : "cancel");
        return new Response(null, { status: 202 });
      },
      fetchJsonImpl: async (url, init) => {
        const value = String(url);
        if (!value.endsWith("/actions/runs/42")) return privatePrerequisiteResponse(url, init);
        statusCalls += 1;
        return statusCalls < 3
          ? { ...completedRun(null), status: "in_progress" }
          : completedRun("cancelled");
      },
      now: () => nowMs,
      resolveWebSha: async () => WEB_SHA,
      sleepImpl: async () => {
        sleepCalls += 1;
        nowMs += sleepCalls === 1 ? 86 * 60_000 : 31_000;
      },
      tokenSupplier: async () => "private-token",
    }), /timed out/u);
  });
  assert.deepEqual(actions, ["cancel", "force-cancel"]);
  assert.equal(statusCalls, 3);
});

test("GitHub App token supplier refreshes before expiry and keeps one installation owner", async () => {
  let nowMs = 2_000_000_000_000;
  let mintCount = 0;
  let installationLookups = 0;
  const supplier = createGitHubAppTokenSupplier({
    appId: "123",
    createJwt: () => "signed-app-jwt",
    fetchJsonImpl: async (url, init) => {
      assert.equal(init.headers.authorization, "Bearer signed-app-jwt");
      if (String(url).endsWith("/installation")) {
        installationLookups += 1;
        return { id: 77 };
      }
      mintCount += 1;
      assert.deepEqual(JSON.parse(init.body), {
        permissions: { actions: "write", contents: "read" },
        repositories: ["murph-android"],
      });
      return {
        expires_at: new Date(nowMs + 60 * 60_000).toISOString(),
        token: `private-token-${mintCount}`,
      };
    },
    now: () => nowMs,
    privateKey: "x".repeat(256),
    repository: "example/murph-android",
  });
  assert.equal(await supplier(), "private-token-1");
  assert.equal(await supplier(), "private-token-1");
  nowMs += 59 * 60_000;
  assert.equal(await supplier(), "private-token-2");
  assert.equal(installationLookups, 1);
  assert.equal(mintCount, 2);
});

test("Android polling refreshes credentials without changing the attested run", async () => {
  let nowMs = 2_000_000_000_000;
  let mintCount = 0;
  const supplier = createGitHubAppTokenSupplier({
    appId: "123",
    createJwt: () => "signed-app-jwt",
    fetchJsonImpl: async (url) => {
      if (String(url).endsWith("/installation")) return { id: 77 };
      mintCount += 1;
      return {
        expires_at: new Date(nowMs + 60 * 60_000).toISOString(),
        token: `private-token-${mintCount}`,
      };
    },
    now: () => nowMs,
    privateKey: "x".repeat(256),
    repository: "example/murph-android",
  });
  const statusCredentials = [];
  let statusCalls = 0;
  await withPrivateEnv(() => dispatchAndWait(canaryDispatch(), {
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, "Bearer private-token-1");
      return jsonResponse({ workflow_run_id: 42 });
    },
    fetchJsonImpl: async (url, init) => {
      const value = String(url);
      if (!value.endsWith("/actions/runs/42")) return privatePrerequisiteResponse(url, init);
      statusCredentials.push(init.headers.authorization);
      statusCalls += 1;
      return statusCalls === 1
        ? { ...completedRun(null), status: "in_progress" }
        : completedRun("success");
    },
    now: () => nowMs,
    resolveWebSha: async () => WEB_SHA,
    sleepImpl: async () => {
      nowMs += 59 * 60_000;
    },
    tokenSupplier: supplier,
  }));
  assert.deepEqual(statusCredentials, [
    "Bearer private-token-1",
    "Bearer private-token-2",
  ]);
  assert.equal(mintCount, 2);
});

test("default Android token owner removes App credentials before child work", async () => {
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    format: "pem",
    type: "pkcs8",
  });
  const names = [
    "NATIVE_ANDROID_E2E_GITHUB_APP_ID",
    "NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY",
  ];
  const original = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NATIVE_ANDROID_E2E_GITHUB_APP_ID = "123";
    process.env.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY = privateKey;
    await withPrivateEnv(() => dispatchAndWait(canaryDispatch(), {
      fetchImpl: async () => jsonResponse({ workflow_run_id: 42 }),
      fetchJsonImpl: async (url, init) => {
        const value = String(url);
        if (value.endsWith("/installation")) {
          assert.match(init.headers.authorization, /^Bearer [A-Za-z0-9._-]+$/u);
          return { id: 77 };
        }
        if (value.endsWith("/access_tokens")) {
          return {
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
            token: "private-token",
          };
        }
        if (value.endsWith("/actions/runs/42")) return completedRun("success");
        return privatePrerequisiteResponse(url, init);
      },
      resolveWebSha: async () => {
        assert.equal(process.env.NATIVE_ANDROID_E2E_GITHUB_APP_ID, undefined);
        assert.equal(process.env.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY, undefined);
        return WEB_SHA;
      },
    }));
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("public Android controller has no PR lifecycle and retains fail-closed run fencing", async () => {
  const controller = await readFile(
    path.join(ROOT, "scripts", "native-android-hosted-e2e.mjs"),
    "utf8",
  );
  assert.match(controller, /readNativeE2EControllerPolicy/u);
  assert.match(controller, /policy\.android/u);
  assert.doesNotMatch(controller, /runPr|mode: "pr"|cleanupE2e|createE2eDeployment/u);

  const native = await readFile(
    path.join(ROOT, "scripts", "native-android-hosted-e2e-native.mjs"),
    "utf8",
  );
  assert.match(native, /dispatch_expires_at/u);
  assert.match(native, /actions\/runs\/\$\{runId\}\/cancel/u);
  assert.match(native, /actions\/runs\/\$\{runId\}\/force-cancel/u);
  assert.match(native, /holdPrivateRunExecutionFence/u);
  assert.match(native, /holdUnreceiptedDispatchFence/u);
  assert.match(native, /createGitHubAppTokenSupplier/u);
  assert.doesNotMatch(native, /mode === "pr"|prHead|pulls\/\$\{/u);
});

test("trusted Android controller is six-hour, latest-outcome gated, and production-only", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "native-android-hosted-e2e.yml"),
    "utf8",
  );
  const workflowConcurrency = workflow.slice(
    workflow.indexOf("\nconcurrency:\n"),
    workflow.indexOf("\njobs:\n"),
  );

  assert.match(workflow, /schedule:\n\s+- cron: "47 \*\/6 \* \* \*"/u);
  assert.match(workflow, /actions: read\n\s+contents: read/u);
  assert.match(workflowConcurrency, /group: native-android-production-canary/u);
  assert.match(workflowConcurrency, /cancel-in-progress: false/u);
  assert.match(
    workflow,
    /native-android-hosted-e2e\.yml\/runs\?event=schedule&status=completed&per_page=1/u,
  );
  assert.doesNotMatch(workflow, /status=success/u);
  assert.match(workflow, /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/u);
  assert.match(workflow, /if: \$\{\{ needs\.select-main\.outputs\.should_run == 'true' \}\}/u);
  assert.match(workflow, /environment: native-android-production-canary/u);
  assert.match(workflow, /node scripts\/native-android-hosted-e2e\.mjs canary/u);
  assert.match(workflow, /--policy \.github\/native-hosted-e2e-controller\.json/u);
  assert.match(workflow, /timeout-minutes: 110/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_WORKFLOW/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY/u);
  assert.doesNotMatch(workflow, /NATIVE_ANDROID_E2E_ANDROID_(?:EXPECTED_SHA|REF)/u);
  assert.doesNotMatch(
    workflow,
    /workflow_run:|deployment_status:|workflow_dispatch:|pull_request:|push:|pull-requests:|statuses: write|node scripts\/native-android-hosted-e2e\.mjs pr/u,
  );
  assert.doesNotMatch(
    workflow,
    /create-github-app-token|NATIVE_ANDROID_E2E_GITHUB_TOKEN|upload-artifact|download-artifact/u,
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

test("Android schedule skips only a same-SHA successful latest outcome", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "native-android-hosted-e2e.yml"),
    "utf8",
  );
  const script = extractWorkflowStepScript(
    workflow,
    "Compare main with the latest completed scheduled outcome",
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-android-cadence-proof-"));
  try {
    await writeFile(path.join(tempDir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 4 ]] || exit 64
[[ "$1" == api ]] || exit 64
[[ "$2" == "repos/\${GITHUB_REPOSITORY}/actions/workflows/native-android-hosted-e2e.yml/runs?event=schedule&status=completed&per_page=1" ]] || exit 64
[[ "$3" == --jq ]] || exit 64
[[ "$4" == '.workflow_runs[0] // {}' ]] || exit 64
[[ "\${FAIL_HISTORY_LOOKUP:-0}" != 1 ]] || exit 42
if [[ -z "\${PREVIOUS_SHA:-}" ]]; then
  printf '{}\n'
else
  printf '{"head_sha":"%s","status":"completed","conclusion":"%s"}\n' "\${PREVIOUS_SHA}" "\${PREVIOUS_CONCLUSION:-success}"
fi
`, { mode: 0o755 });
    const scenarios = [
      { attempt: "1", conclusion: "", expected: "true", previousSha: "" },
      { attempt: "1", conclusion: "success", expected: "false", previousSha: WEB_SHA },
      { attempt: "1", conclusion: "failure", expected: "true", previousSha: WEB_SHA },
      { attempt: "1", conclusion: "success", expected: "true", previousSha: ANDROID_SHA },
      { attempt: "2", conclusion: "success", expected: "true", previousSha: WEB_SHA },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const outputPath = path.join(tempDir, `output-${index}`);
      const result = spawnSync("bash", ["-c", script], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          CURRENT_SHA: WEB_SHA,
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
      assert.deepEqual(output, { should_run: scenario.expected, web_sha: WEB_SHA });
    }

    const historyFailure = spawnSync("bash", ["-c", script], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CURRENT_SHA: WEB_SHA,
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

async function withPrivateEnv(callback) {
  const original = new Map(Object.keys(PRIVATE_ENV).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, PRIVATE_ENV);
    return await callback();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function privateTag() {
  return {
    object: { sha: ANDROID_SHA, type: "commit" },
    ref: `refs/tags/${ANDROID_TAG}`,
  };
}

function privatePrerequisiteResponse(url) {
  if (String(url).includes("/git/ref/tags/")) return privateTag();
  throw new Error(`unexpected URL ${String(url)}`);
}

function completedRun(conclusion) {
  return {
    conclusion,
    event: "workflow_dispatch",
    head_sha: ANDROID_SHA,
    id: 42,
    status: "completed",
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

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
