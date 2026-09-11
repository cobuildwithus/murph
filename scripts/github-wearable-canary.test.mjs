import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inspectWearableCanaryProof, inspectWearableCanaryRun, runWearableCanary, wearableCanaryProofDigest } from "./github-wearable-canary.mjs";

const publicSha = "a".repeat(40);
const privateSha = "b".repeat(40);
const now = Date.parse("2026-09-10T12:00:00Z");
const requestId = "wearable-12-1";
const digest = wearableCanaryProofDigest({ privateSha, publicSha, requestId });
const env = {
  GITHUB_EVENT_NAME: "schedule", GITHUB_REF: "refs/heads/main", GITHUB_REF_PROTECTED: "true",
  GITHUB_REPOSITORY: "cobuildwithus/murph", GITHUB_RUN_ID: "12", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: publicSha, GITHUB_TOKEN: "public-fixture", WEARABLE_CANARY_PRIVATE_GITHUB_TOKEN: "private-fixture",
};
const run = {
  id: 42, workflow_id: 7, name: "Private Junction Garmin Canary", path: ".github/workflows/junction-wearable-canary.yml",
  event: "workflow_dispatch", head_branch: "main", head_sha: privateSha, run_attempt: 1,
  repository: { full_name: "cobuildwithus/murph-cloud" }, head_repository: { full_name: "cobuildwithus/murph-cloud" },
  status: "completed", conclusion: "success",
};
const proof = {
  total_count: 1,
  jobs: [{ name: `Junction wearable canary proof / ${digest}`, run_id: 42, head_sha: privateSha,
    status: "completed", conclusion: "success", started_at: new Date(now).toISOString(), completed_at: new Date(now).toISOString() }],
};
const proofContext = { digest, dispatchedAt: now, now, privateSha, runId: 42 };

function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).origin, "https://api.github.com");
      assert.match(new URL(url).pathname, /^\/repos\/cobuildwithus\/murph(?:-cloud)?\//u);
      calls.push({ endpoint: url.replace("https://api.github.com/repos/", ""), method: init.method });
      assert.equal(init.redirect, "error");
      let body;
      if (url.endsWith("murph/git/ref/heads/main")) body = { object: { type: "commit", sha: publicSha } };
      else if (url.endsWith("murph-cloud/git/ref/heads/main")) body = { object: { type: "commit", sha: privateSha } };
      else if (url.endsWith("/actions/workflows/junction-wearable-canary.yml")) body = { id: 7, name: run.name, path: run.path, state: "active" };
      else if (url.endsWith("/dispatches")) {
        assert.deepEqual(JSON.parse(init.body), { inputs: { contract_version: "1", public_sha: publicSha, request_id: requestId }, ref: "main", return_run_details: true });
        assert.equal(init.headers.authorization, "Bearer private-fixture");
        body = { workflow_run_id: 42 };
      } else if (url.endsWith("/actions/runs/42")) body = run;
      else if (url.endsWith("/jobs?filter=latest&per_page=100&page=1")) body = proof;
      else throw new Error("Unexpected endpoint");
      const replacement = overrides[calls.at(-1).endpoint];
      return new Response(JSON.stringify(replacement ?? body), { headers: { "content-type": "application/json" } });
    },
    now: () => now,
    sleepImpl: async () => { throw new Error("Unexpected sleep"); },
  };
}

test("dispatches one protected-main journey and accepts its exact completed business proof", async () => {
  const options = harness();
  const result = await runWearableCanary(env, options);
  assert.deepEqual(result, { completedAt: new Date(now).toISOString(), journeyExecuted: true, outcome: "passed", privateSha, publicSha });
  assert.equal(options.calls.filter(({ method }) => method === "POST").length, 1);
  assert.ok(options.calls.every(({ endpoint }) => !/logs|artifacts|cancel|rerun/u.test(endpoint)));
});

test("missing credentials and untrusted events fail before any provider dispatch", async () => {
  for (const override of [
    { GITHUB_REF: "refs/heads/topic" }, { GITHUB_REF_PROTECTED: "false" }, { GITHUB_EVENT_NAME: "pull_request" },
    { WEARABLE_CANARY_PRIVATE_GITHUB_TOKEN: "" }, { GITHUB_RUN_ID: "private/input" },
  ]) {
    const options = harness();
    await assert.rejects(runWearableCanary({ ...env, ...override }, options));
    assert.equal(options.calls.length, 0);
  }
});

test("changed public main and unavailable private workflow fail before dispatch", async () => {
  for (const overrides of [
    { "cobuildwithus/murph/git/ref/heads/main": { object: { type: "commit", sha: "c".repeat(40) } } },
    { "cobuildwithus/murph-cloud/actions/workflows/junction-wearable-canary.yml": { id: 7, name: run.name, path: run.path, state: "disabled_manually" } },
  ]) {
    const options = harness(overrides);
    await assert.rejects(runWearableCanary(env, options));
    assert.equal(options.calls.filter(({ method }) => method === "POST").length, 0);
  }
});

test("private run identity rejects a different revision, workflow, repository, or rerun", () => {
  for (const override of [{ id: 43 }, { workflow_id: 8 }, { head_sha: publicSha }, { run_attempt: 2 },
    { event: "push" }, { head_branch: "topic" }, { path: ".github/workflows/other.yml" }, { repository: { full_name: "example/other" } }]) {
    assert.throws(() => inspectWearableCanaryRun({ ...run, ...override }, { privateSha, runId: 42, workflowId: 7 }));
  }
});

test("success without an executed current-run business receipt fails", () => {
  for (const override of [
    { status: "queued" }, { conclusion: "skipped" }, { name: `Junction wearable canary proof / ${"c".repeat(64)}` },
    { run_id: 41 }, { head_sha: publicSha }, { started_at: new Date(now - 120_000).toISOString() },
    { completed_at: new Date(now + 120_000).toISOString() }, { completed_at: null },
  ]) assert.throws(() => inspectWearableCanaryProof({ ...proof, jobs: [{ ...proof.jobs[0], ...override }] }, proofContext));
  assert.throws(() => inspectWearableCanaryProof({ total_count: 2, jobs: proof.jobs }, proofContext));
  assert.throws(() => inspectWearableCanaryProof({ total_count: 2, jobs: [...proof.jobs, ...proof.jobs] }, proofContext));
  assert.throws(() => inspectWearableCanaryProof({ total_count: 0, jobs: [] }, proofContext));
});

test("GitHub failures expose no private response and do not retry dispatch", async () => {
  const options = harness();
  let count = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/dispatches")) {
      count += 1;
      throw new Error("private-token-and-provider-response");
    }
    return options.fetchImpl(url, init);
  };
  await assert.rejects(runWearableCanary(env, { ...options, fetchImpl }), (error) => {
    assert.doesNotMatch(error.message, /private-token-and-provider-response/u);
    return true;
  });
  assert.equal(count, 1);
});

test("queued execution waits, then requires the exact terminal receipt", async () => {
  const options = harness();
  let pending = true;
  let sleeps = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/actions/runs/42") && pending) {
      return new Response(JSON.stringify({ ...run, status: "queued", conclusion: null }));
    }
    return options.fetchImpl(url, init);
  };
  const result = await runWearableCanary(env, { ...options, fetchImpl, sleepImpl: async (ms) => {
    assert.equal(ms, 15_000);
    sleeps += 1;
    pending = false;
  } });
  assert.equal(sleeps, 1);
  assert.equal(result.journeyExecuted, true);
});

test("timeout leaves private provider execution alone and never reports success", async () => {
  const options = harness({ "cobuildwithus/murph-cloud/actions/runs/42": { ...run, status: "in_progress", conclusion: null } });
  let instant = now;
  await assert.rejects(runWearableCanary(env, { ...options, now: () => instant, sleepImpl: async () => {
    instant += 54 * 60_000;
  } }), /timed out/u);
  assert.equal(options.calls.filter(({ method }) => method === "POST").length, 1);
  assert.ok(options.calls.every(({ endpoint }) => !/cancel|rerun/u.test(endpoint)));
});

test("a successful run becomes invalid if private main moved during its execution", async () => {
  const options = harness();
  let mainReads = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("murph-cloud/git/ref/heads/main") && ++mainReads > 1) {
      return new Response(JSON.stringify({ object: { type: "commit", sha: "c".repeat(40) } }));
    }
    return options.fetchImpl(url, init);
  };
  await assert.rejects(runWearableCanary(env, { ...options, fetchImpl }), /main changed during execution/u);
});

test("an ambiguous dispatch response is never retried or accepted as proof", async () => {
  const options = harness({ "cobuildwithus/murph-cloud/actions/workflows/junction-wearable-canary.yml/dispatches": {} });
  await assert.rejects(runWearableCanary(env, options), /exact run receipt/u);
  assert.equal(options.calls.filter(({ method }) => method === "POST").length, 1);
  assert.ok(options.calls.every(({ endpoint }) => !endpoint.includes("actions/runs/")));
});

test("public workflow grants only private dispatch authority and never provider credentials", async () => {
  const workflow = await readFile(new URL("../.github/workflows/junction-wearable-canary.yml", import.meta.url), "utf8");
  assert.match(workflow, /environment: temporal-compatibility/u);
  assert.match(workflow, /permission-actions: write/u);
  assert.match(workflow, /permission-contents: read/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /schedule:/u);
  assert.doesNotMatch(workflow, /JUNCTION_API_KEY|GARMIN_PASSWORD|KERNEL_API_KEY|pull_request|actions\/download-artifact|pnpm install|force-cancel/u);
});
