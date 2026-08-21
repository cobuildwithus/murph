import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
  assert.match(workflow, /environment: native-android-hosted-e2e/u);
  assert.match(workflow, /timeout-minutes: 150/u);
  assert.match(workflow, /timeout-minutes: 110/u);
  assert.match(workflow, /environment: native-android-production-canary/u);
  assert.match(workflow, /group: native-ios-hosted-e2e-live/u);
  assert.match(workflow, /group: native-ios-production-canary-live/u);
  assert.match(workflow, /queue: max/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_REF/u);
  assert.match(workflow, /NATIVE_ANDROID_E2E_ANDROID_WORKFLOW/u);
  assert.match(workflow, /permission-actions: write/u);
  assert.doesNotMatch(workflow, /upload-artifact|download-artifact/u);
  for (const line of workflow.split("\n").filter((value) => /^\s*uses:/u.test(value))) {
    assert.match(line, /uses: [^\s]+@[0-9a-f]{40}(?:\s|$)/u, line);
  }
});
