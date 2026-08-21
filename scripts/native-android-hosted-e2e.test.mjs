import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectJunctionHealthConnectConnection,
  withoutNativeE2ECredentials,
} from "./native-ios-hosted-e2e-identity.mjs";
import { runPrLifecycle } from "./native-ios-hosted-e2e.mjs";

import {
  NATIVE_ANDROID_HOSTED_E2E_CONTRACT_VERSION,
  PRIVATE_ANDROID_DISPATCH_TTL_SECONDS,
  PRIVATE_ANDROID_JOB_TIMEOUT_SECONDS,
  PRIVATE_ANDROID_TERMINAL_GRACE_SECONDS,
  buildDispatchInputs,
  createGitHubAppTokenSupplier,
  dispatchAndWait,
  inspectCurrentProductionSha,
  inspectExactPrHead,
  inspectPrivateDispatchTag,
  inspectPrivateRun,
  inspectPrivateRunActionStatus,
  privateRunExecutionFenceDeadlineMs,
} from "./native-android-hosted-e2e-native.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_SHA = "a".repeat(40);
const ANDROID_SHA = "b".repeat(40);
const ANDROID_TAG = "native-hosted-e2e/android-v1";
const PRIVATE_ENV = {
  NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA: ANDROID_SHA,
  NATIVE_ANDROID_E2E_ANDROID_REF: ANDROID_TAG,
  NATIVE_ANDROID_E2E_ANDROID_REPOSITORY: "cobuildwithus/murph-android",
  NATIVE_ANDROID_E2E_ANDROID_WORKFLOW: "native-android-hosted-e2e.yml",
};

function prDispatch(overrides = {}) {
  return {
    androidSha: ANDROID_SHA,
    androidTag: ANDROID_TAG,
    correlationId: "murph-pr-safe-123",
    dispatchExpiresAt: 2_000_000_000,
    mode: "pr",
    webBaseUrl: "https://candidate-123.vercel.app",
    webSha: WEB_SHA,
    ...overrides,
  };
}

test("dispatch inputs bind both exact sources, origin, mode, and identity lifecycle", () => {
  assert.deepEqual(buildDispatchInputs(prDispatch()), {
    android_sha: ANDROID_SHA,
    android_tag: ANDROID_TAG,
    contract_version: NATIVE_ANDROID_HOSTED_E2E_CONTRACT_VERSION,
    correlation_id: "murph-pr-safe-123",
    dispatch_expires_at: "2000000000",
    identity_lifecycle: "orchestrator_owned_reset",
    mode: "pr",
    web_base_url: "https://candidate-123.vercel.app",
    web_sha: WEB_SHA,
  });

  assert.deepEqual(buildDispatchInputs(prDispatch({
    correlationId: "murph-production-safe",
    mode: "production_canary",
    webBaseUrl: "https://www.withmurph.ai",
  })).identity_lifecycle, "non_destructive_existing_identity");
  assert.equal(PRIVATE_ANDROID_DISPATCH_TTL_SECONDS, 30 * 60);
  assert.throws(() => buildDispatchInputs(prDispatch({
    correlationId: "murph-production-safe",
    mode: "production_canary",
    webBaseUrl: "https://candidate-123.vercel.app",
  })));
});

test("dispatch construction rejects malformed or mutable source identifiers", () => {
  for (const override of [
    { androidSha: "b".repeat(39) },
    { androidTag: "refs/tags/native-e2e" },
    { androidTag: "native//e2e" },
    { androidTag: "native/../e2e" },
    { correlationId: "unsafe value" },
    { dispatchExpiresAt: 0 },
    { dispatchExpiresAt: 2_000_000_000.5 },
    { mode: "preview" },
    { webBaseUrl: "http://candidate.vercel.app" },
    { webBaseUrl: "https://candidate.vercel.app/path" },
    { webBaseUrl: "https://vercel.app" },
    { webBaseUrl: "https://www.withmurph.ai" },
    { webSha: "A".repeat(40) },
  ]) {
    assert.throws(() => buildDispatchInputs(prDispatch(override)));
  }
});

test("private lightweight tag proof binds the reviewed Android SHA", () => {
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
});

test("private run cancellation accepts only GitHub terminal-action statuses", () => {
  assert.equal(inspectPrivateRunActionStatus(202, "cancel"), true);
  assert.equal(inspectPrivateRunActionStatus(409, "cancel"), true);
  assert.throws(() => inspectPrivateRunActionStatus(200, "cancel"));
  assert.throws(() => inspectPrivateRunActionStatus(403, "cancel"));
});

test("fallback execution fence covers the latest leased start and private timeout", () => {
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

test("private run and Web PR attestations reject revision skew", () => {
  assert.deepEqual(inspectPrivateRun({
    conclusion: null,
    event: "workflow_dispatch",
    head_sha: ANDROID_SHA,
    id: 42,
    status: "in_progress",
  }, { runId: 42, sha: ANDROID_SHA }), {
    complete: false,
    conclusion: null,
  });
  assert.throws(() => inspectPrivateRun({
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: "c".repeat(40),
    id: 42,
    status: "completed",
  }, { runId: 42, sha: ANDROID_SHA }));

  assert.equal(inspectExactPrHead({
    head: { sha: WEB_SHA },
    number: 123,
  }, { expectedSha: WEB_SHA, prNumber: 123 }), true);
  assert.throws(() => inspectExactPrHead({
    head: { sha: "c".repeat(40) },
    number: 123,
  }, { expectedSha: WEB_SHA, prNumber: 123 }));
});

test("shared hosted-native lifecycle preserves an Android-specific failure label", async () => {
  let retireCalls = 0;
  await assert.rejects(
    runPrLifecycle({
      cleanup: async () => undefined,
      deploy: async () => "https://candidate-123.vercel.app",
      dispatch: async () => undefined,
      laneLabel: "Native Android E2E",
      now: () => 123,
      postconditions: async () => undefined,
      retire: async () => {
        retireCalls += 1;
        if (retireCalls === 2) throw new Error("retire failed");
      },
    }),
    /Native Android E2E finalization failed at retire_after_run/u,
  );
});


test("shared child processes scrub both native-lane credential namespaces", () => {
  assert.deepEqual(withoutNativeE2ECredentials({
    KEEP: "safe",
    NATIVE_ANDROID_E2E_GITHUB_APP_ID: "android-app-id",
    NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY: "android-private-key",
    NATIVE_ANDROID_E2E_GITHUB_TOKEN: "android-secret",
    NATIVE_IOS_E2E_DATABASE_URL: "ios-secret",
  }), { KEEP: "safe" });
});

test("Android postcondition accepts only a connected Health Connect provider", () => {
  assert.equal(inspectJunctionHealthConnectConnection({
    providers: [{ slug: "health_connect", status: "connected" }],
  }), true);
  assert.throws(() => inspectJunctionHealthConnectConnection({
    providers: [{ slug: "apple_health_kit", status: "connected" }],
  }));
  assert.throws(() => inspectJunctionHealthConnectConnection({
    providers: [{ slug: "health_connect", status: "disconnected" }],
  }));
});

test("production alias proof requires the exact deployed Web SHA", () => {
  assert.equal(inspectCurrentProductionSha(WEB_SHA, WEB_SHA), true);
  assert.throws(() => inspectCurrentProductionSha("c".repeat(40), WEB_SHA));
});

test("Android dispatch executes tag, exact-head, dispatch, and exact-run proof in order", async () => {
  const calls = [];
  await withPrivateEnv(async () => {
    await dispatchAndWait({
      correlationId: "murph-pr-safe-123",
      mode: "pr",
      prHead: {
        prNumber: 123,
        repository: "cobuildwithus/murph",
        token: "web-token",
      },
      webBaseUrl: "https://candidate-123.vercel.app",
      webSha: WEB_SHA,
    }, {
      fetchImpl: async (url, init) => {
        calls.push("dispatch");
        assert.match(String(url), /\/dispatches$/u);
        assert.equal(init.headers.authorization, "Bearer private-token");
        return jsonResponse({ workflow_run_id: 42 });
      },
      fetchJsonImpl: async (url, init) => {
        const value = String(url);
        if (value.includes("/git/ref/tags/")) {
          calls.push("tag");
          assert.equal(init.headers.authorization, "Bearer private-token");
          return {
            object: { sha: ANDROID_SHA, type: "commit" },
            ref: `refs/tags/${ANDROID_TAG}`,
          };
        }
        if (value.endsWith("/pulls/123")) {
          calls.push("head");
          assert.equal(init.headers.authorization, "Bearer web-token");
          return { head: { sha: WEB_SHA }, number: 123 };
        }
        if (value.endsWith("/actions/runs/42")) {
          calls.push("status");
          assert.equal(init.headers.authorization, "Bearer private-token");
          return completedRun("success");
        }
        throw new Error(`unexpected URL ${value}`);
      },
      tokenSupplier: async () => "private-token",
    });
  });
  assert.deepEqual(calls, ["tag", "head", "dispatch", "status"]);
});

test("stale Web head rejects before Android dispatch", async () => {
  let dispatchCalled = false;
  await withPrivateEnv(async () => {
    await assert.rejects(() => dispatchAndWait({
      correlationId: "murph-pr-safe-123",
      mode: "pr",
      prHead: {
        prNumber: 123,
        repository: "cobuildwithus/murph",
        token: "web-token",
      },
      webBaseUrl: "https://candidate-123.vercel.app",
      webSha: WEB_SHA,
    }, {
      fetchImpl: async () => {
        dispatchCalled = true;
        return jsonResponse({ workflow_run_id: 42 });
      },
      fetchJsonImpl: async (url) => String(url).includes("/git/ref/tags/")
        ? {
            object: { sha: ANDROID_SHA, type: "commit" },
            ref: `refs/tags/${ANDROID_TAG}`,
          }
        : { head: { sha: "c".repeat(40) }, number: 123 },
      tokenSupplier: async () => "private-token",
    }), /head changed/u);
  });
  assert.equal(dispatchCalled, false);
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
      await assert.rejects(() => dispatchAndWait({
        correlationId: "murph-pr-safe-123",
        mode: "pr",
        prHead: {
          prNumber: 123,
          repository: "cobuildwithus/murph",
          token: "web-token",
        },
        webBaseUrl: "https://candidate-123.vercel.app",
        webSha: WEB_SHA,
      }, {
        fetchImpl: async () => dispatchResponse(),
        fetchJsonImpl: privatePrerequisiteResponse,
        now: () => nowMs,
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
    await assert.rejects(() => dispatchAndWait({
      correlationId: "murph-pr-safe-123",
      mode: "pr",
      prHead: {
        prNumber: 123,
        repository: "cobuildwithus/murph",
        token: "web-token",
      },
      webBaseUrl: "https://candidate-123.vercel.app",
      webSha: WEB_SHA,
    }, {
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
    repository: "cobuildwithus/murph-android",
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
    repository: "cobuildwithus/murph-android",
  });
  const statusCredentials = [];
  let statusCalls = 0;
  await withPrivateEnv(() => dispatchAndWait({
    correlationId: "murph-pr-safe-123",
    mode: "pr",
    prHead: {
      prNumber: 123,
      repository: "cobuildwithus/murph",
      token: "web-token",
    },
    webBaseUrl: "https://candidate-123.vercel.app",
    webSha: WEB_SHA,
  }, {
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

test("default Android token owner removes App credentials before controller work continues", async () => {
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
    await withPrivateEnv(() => dispatchAndWait({
      correlationId: "murph-pr-safe-123",
      mode: "pr",
      prHead: {
        prNumber: 123,
        repository: "cobuildwithus/murph",
        token: "web-token",
      },
      webBaseUrl: "https://candidate-123.vercel.app",
      webSha: WEB_SHA,
    }, {
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
    }));
    assert.equal(process.env.NATIVE_ANDROID_E2E_GITHUB_APP_ID, undefined);
    assert.equal(process.env.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY, undefined);
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("backend controller reuses canonical identity, deployment, and postcondition owners", async () => {
  const source = await readFile(
    path.join(ROOT, "scripts", "native-android-hosted-e2e.mjs"),
    "utf8",
  );
  assert.match(source, /runPrLifecycle/u);
  assert.match(source, /laneLabel: "Native Android E2E"/u);
  assert.match(source, /from "\.\/native-ios-hosted-e2e\.mjs"/u);
  assert.match(source, /cleanupE2e/u);
  assert.match(source, /createE2eDeployment/u);
  assert.match(source, /waitForE2eDeployment/u);
  assert.match(source, /proveAndroidRunPostconditions/u);
  assert.match(source, /retireE2eDeployments/u);
  assert.match(source, /mode: "pr"/u);
  assert.match(source, /mode: "production_canary"/u);
  assert.doesNotMatch(source, /fixed.?otp|login.?identifier/iu);

  const native = await readFile(
    path.join(ROOT, "scripts", "native-android-hosted-e2e-native.mjs"),
    "utf8",
  );
  assert.match(native, /dispatch_expires_at/u);
  assert.match(native, /PRIVATE_ANDROID_DISPATCH_TTL_SECONDS/u);
  assert.match(native, /actions\/runs\/\$\{runId\}\/cancel/u);
  assert.match(native, /actions\/runs\/\$\{runId\}\/force-cancel/u);
  assert.match(native, /holdPrivateRunExecutionFence/u);
  assert.match(native, /holdUnreceiptedDispatchFence/u);
  assert.match(native, /createGitHubAppTokenSupplier/u);
  assert.match(native, /dispatch lease and private job timeout/u);
});

test("trusted workflow is pinned, protected, source-bound, and shares the destructive live lock", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "native-android-hosted-e2e.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /deployment_status:/u);
  assert.match(workflow, /--paginate/u);
  assert.match(workflow, /previous_filename/u);
  assert.match(workflow, /context='Native Android hosted E2E'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: native-ios-hosted-e2e/u);
  assert.match(workflow, /timeout-minutes: 150/u);
  assert.match(workflow, /timeout-minutes: 110/u);
  assert.match(workflow, /environment: native-android-production-canary/u);
  assert.match(workflow, /group: native-ios-hosted-e2e-live/u);
  assert.match(workflow, /group: native-android-production-canary-live/u);
  assert.match(workflow, /queue: max/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_REF/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_WORKFLOW/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY/u);
  assert.match(workflow, /secrets\.NATIVE_IOS_E2E_DATABASE_URL/u);
  assert.match(workflow, /secrets\.NATIVE_IOS_E2E_PRIVY_TEST_PHONE/u);
  assert.match(workflow, /secrets\.NATIVE_IOS_E2E_VERCEL_TOKEN/u);
  assert.match(workflow, /vars\.NATIVE_IOS_E2E_PRIVY_APP_ID/u);
  assert.match(workflow, /vars\.NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID/u);
  assert.doesNotMatch(workflow, /secrets\.NATIVE_ANDROID_E2E_DATABASE_URL/u);
  assert.doesNotMatch(workflow, /secrets\.NATIVE_ANDROID_E2E_PRIVY_TEST_PHONE/u);
  assert.doesNotMatch(workflow, /secrets\.NATIVE_ANDROID_E2E_VERCEL_TOKEN/u);
  assert.doesNotMatch(workflow, /vars\.NATIVE_ANDROID_E2E_PRIVY_APP_ID/u);
  assert.doesNotMatch(workflow, /vars\.NATIVE_ANDROID_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID/u);
  assert.doesNotMatch(workflow, /create-github-app-token|NATIVE_ANDROID_E2E_GITHUB_TOKEN/u);
  assert.doesNotMatch(workflow, /upload-artifact|download-artifact/u);
  for (const line of workflow.split("\n").filter((value) => /^\s*uses:/u.test(value))) {
    assert.match(line, /uses: [^\s]+@[0-9a-f]{40}(?:\s|$)/u, line);
  }
});

test("Android workflow selector executes representative selected and neutral paths", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "native-android-hosted-e2e.yml"),
    "utf8",
  );
  for (const selected of [
    "apps/web/app/page.tsx",
    "scripts/native-android-hosted-e2e-native.mjs",
    ".github/workflows/native-android-hosted-e2e.yml",
  ]) {
    assert.equal(runWorkflowSelector(workflow, selected), "selected", selected);
  }
  for (const neutral of [
    "README.md",
    "agent-docs/product-specs/companion-app.md",
  ]) {
    assert.equal(runWorkflowSelector(workflow, neutral), "neutral", neutral);
  }
});

test("Android commit status shell distinguishes retry, skip, trust, live pass, and failure", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "native-android-hosted-e2e.yml"),
    "utf8",
  );
  const script = extractWorkflowStepScript(workflow, "Publish stable commit status");
  const baseEnv = {
    LIVE_RESULT: "skipped",
    PR_NUMBER: "42",
    RUN_ATTEMPT: "1",
    SELECT_RESULT: "success",
    SELECTED: "true",
    SOURCE_RESULT: "success",
    TRUSTED: "true",
  };
  const scenarios = [
    [{ RUN_ATTEMPT: "2" }, "failure", "Retry with node scripts/native-ios-hosted-e2e-retry.mjs --pr 42; native reruns do not enter the live queue."],
    [{ SELECT_RESULT: "failure" }, "failure", "Hosted-native Android selection failed; no passing proof was recorded."],
    [{ SOURCE_RESULT: "failure" }, "failure", "Repo Hygiene did not pass; hosted-native Android was not run."],
    [{ SELECTED: "false" }, "success", "Path filter did not select hosted-native Android for this exact commit."],
    [{ TRUSTED: "false" }, "failure", "A trusted same-repository human head is required for live Android credentials."],
    [{ LIVE_RESULT: "success" }, "success", "Real hosted-native Android E2E passed for the exact commit."],
    [{ LIVE_RESULT: "failure" }, "failure", "No passing terminal hosted-native Android proof was recorded."],
  ];
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-android-status-proof-"));
  try {
    await writeFile(path.join(tempDir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$GH_CAPTURE"
`, { mode: 0o755 });
    for (const [index, [overrides, expectedState, expectedDescription]] of scenarios.entries()) {
      const capturePath = path.join(tempDir, `gh-${index}.args`);
      const result = spawnSync("bash", ["-c", script], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          ...baseEnv,
          ...overrides,
          GH_CAPTURE: capturePath,
          GITHUB_REPOSITORY: "cobuildwithus/murph",
          GITHUB_RUN_ID: "987",
          GITHUB_SERVER_URL: "https://github.example.test",
          PATH: `${tempDir}:${process.env.PATH ?? ""}`,
          STATUS_SHA: WEB_SHA,
        },
      });
      assert.equal(result.status, expectedState === "success" ? 0 : 1, result.stderr);
      const ghArgs = (await readFile(capturePath, "utf8")).trimEnd().split("\n");
      assert.ok(ghArgs.includes(`state=${expectedState}`));
      assert.ok(ghArgs.includes(`description=${expectedDescription}`));
    }
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

function privatePrerequisiteResponse(url) {
  const value = String(url);
  if (value.includes("/git/ref/tags/")) {
    return {
      object: { sha: ANDROID_SHA, type: "commit" },
      ref: `refs/tags/${ANDROID_TAG}`,
    };
  }
  if (value.endsWith("/pulls/123")) {
    return { head: { sha: WEB_SHA }, number: 123 };
  }
  throw new Error(`unexpected URL ${value}`);
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

function runWorkflowSelector(workflow, file) {
  const match = /case "\$\{file\}" in\n(?<patterns>[\s\S]*?)\)\n\s+selected=true\n\s+break/u.exec(workflow);
  assert.ok(match?.groups?.patterns, "workflow selector case was not found");
  const script = [
    "set -euo pipefail",
    'file="$1"',
    'case "${file}" in',
    `${match.groups.patterns})`,
    '  printf "selected\\n"',
    "  ;;",
    "*)",
    '  printf "neutral\\n"',
    "  ;;",
    "esac",
  ].join("\n");
  const result = spawnSync("bash", ["-c", script, "selector", file], {
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
