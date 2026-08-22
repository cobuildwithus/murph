import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY,
  TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
  TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
  buildAttestationJobName,
  buildDispatchInputs,
  buildReaderJobName,
  cancelAcceptedRun,
  inspectAttestationJobs,
  inspectChangedFilePage,
  inspectDispatchReceipt,
  inspectExactPublicHead,
  inspectJobPage,
  inspectPrivateRun,
  inspectPrivateTag,
  inspectPrivateWorkflow,
  inspectPullRequest,
  isTemporalCompatibilityRelevantPath,
  runTemporalCompatibility,
  selectPullRequest,
  supportedReaderDigest,
} from "./hosted-orchestration-compatibility.mjs";

const PUBLIC_SHA = "a".repeat(40);
const PRIVATE_SHA = "b".repeat(40);
const OTHER_READER_SHA = "c".repeat(40);
const PRIVATE_REF = "temporal-compatibility-v1";
const REQUEST_ID = `temporal-${PUBLIC_SHA}-123-1`;
const WORKFLOW_ID = 321;
const RUN_ID = 654;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pullRequest(overrides = {}) {
  return {
    changed_files: 1,
    head: {
      repo: { full_name: "cobuildwithus/murph" },
      sha: PUBLIC_SHA,
    },
    number: 42,
    state: "open",
    user: { type: "User" },
    ...overrides,
  };
}

function privateRun(overrides = {}) {
  return {
    conclusion: "success",
    event: "workflow_dispatch",
    head_repository: { full_name: TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY },
    head_sha: PRIVATE_SHA,
    id: RUN_ID,
    name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
    path: `${TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH}@${PRIVATE_REF}`,
    repository: { full_name: TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY },
    run_attempt: 1,
    status: "completed",
    workflow_id: WORKFLOW_ID,
    ...overrides,
  };
}

function proofJobs({ digest = supportedReaderDigest([PRIVATE_SHA, OTHER_READER_SHA]) } = {}) {
  return [
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 1,
      name: buildReaderJobName(PRIVATE_SHA),
      run_id: RUN_ID,
      status: "completed",
    },
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 2,
      name: buildReaderJobName(OTHER_READER_SHA),
      run_id: RUN_ID,
      status: "completed",
    },
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 3,
      name: buildAttestationJobName({ digest, publicSha: PUBLIC_SHA, requestId: REQUEST_ID }),
      run_id: RUN_ID,
      status: "completed",
    },
  ];
}

test("classifier selects every hosted Web and Cloudflare change", () => {
  assert.equal(isTemporalCompatibilityRelevantPath("apps/web/src/lib/hosted-orchestration/status.ts"), true);
  assert.equal(isTemporalCompatibilityRelevantPath("apps/cloudflare/src/index.ts"), true);
});

test("classifier selects Temporal contracts, harnesses, and CI owners", () => {
  for (const filePath of [
    "packages/hosted-execution/src/runtime-control.ts",
    "packages/hosted-local-harness/src/e2e.ts",
    "packages/hosted-orchestrator-temporal/src/workflows.ts",
    "packages/contracts/src/index.ts",
    "scripts/check-hosted-temporal-orchestration-guards.ts",
    "scripts/setup-temporal-cli.sh",
    ".github/workflows/temporal-compatibility.yml",
    "pnpm-lock.yaml",
  ]) {
    assert.equal(isTemporalCompatibilityRelevantPath(filePath), true, filePath);
  }
});

test("classifier leaves unrelated documentation neutral", () => {
  assert.equal(isTemporalCompatibilityRelevantPath("docs/README.md"), false);
  assert.equal(isTemporalCompatibilityRelevantPath("apps/desktop/README.md"), false);
});

test("pull-request inspection binds the open exact head and trust source", () => {
  assert.deepEqual(inspectPullRequest(pullRequest(), {
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), { changedFiles: 1, headSha: PUBLIC_SHA, trusted: true });
});

test("pull-request inspection rejects a stale workflow-run head", () => {
  assert.throws(() => inspectPullRequest(pullRequest({
    head: { repo: { full_name: "cobuildwithus/murph" }, sha: "d".repeat(40) },
  }), {
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), /changed after Repo Hygiene/u);
});

test("pull-request inspection rejects fork and bot authority without rejecting classification", () => {
  assert.equal(inspectPullRequest(pullRequest({
    head: { repo: { full_name: "fork/murph" }, sha: PUBLIC_SHA },
  }), {
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }).trusted, false);
  assert.equal(inspectPullRequest(pullRequest({ user: { type: "Bot" } }), {
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }).trusted, false);
});

test("pre-dispatch head proof rechecks same-repository human authority", () => {
  assert.throws(() => inspectExactPublicHead(pullRequest({
    head: { repo: { full_name: "fork/murph" }, sha: PUBLIC_SHA },
  }), {
    expectedSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), /no longer a same-repository human-authored head/u);
});

test("changed-file pagination requires every declared entry", () => {
  assert.deepEqual(inspectChangedFilePage([
    { filename: "docs/new.md", previous_filename: "apps/web/old.ts" },
  ], { expectedCount: 1, page: 1 }), [
    { filename: "docs/new.md", previousFilename: "apps/web/old.ts" },
  ]);
  assert.throws(
    () => inspectChangedFilePage([], { expectedCount: 1, page: 1 }),
    /pagination is incomplete/u,
  );
});

test("selection treats a renamed relevant owner as relevant", async () => {
  await withFetch(async (url) => {
    if (url.endsWith("/pulls/42")) return jsonResponse(pullRequest());
    return jsonResponse([{ filename: "docs/moved.ts", previous_filename: "apps/web/src/old.ts" }]);
  }, async () => {
    const result = await selectPullRequest({
      expectedHeadSha: PUBLIC_SHA,
      prNumber: 42,
      repository: "cobuildwithus/murph",
      token: "public-token",
    });
    assert.equal(result.selected, true);
  });
});

test("selection fails safe above GitHub's changed-file listing ceiling", async () => {
  let fileLookup = false;
  await withFetch(async (url) => {
    if (url.endsWith("/pulls/42")) return jsonResponse(pullRequest({ changed_files: 3_001 }));
    fileLookup = true;
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const result = await selectPullRequest({
      expectedHeadSha: PUBLIC_SHA,
      prNumber: 42,
      repository: "cobuildwithus/murph",
      token: "public-token",
    });
    assert.equal(result.selected, true);
    assert.equal(fileLookup, false);
  });
});

test("dispatch contract is closed, versioned, and exact-SHA only", () => {
  assert.deepEqual(buildDispatchInputs({ publicSha: PUBLIC_SHA, requestId: REQUEST_ID }), {
    contract_version: "1",
    mode: "temporal_compatibility",
    murph_sha: PUBLIC_SHA,
    request_id: REQUEST_ID,
  });
  assert.throws(
    () => buildDispatchInputs({ publicSha: "main", requestId: REQUEST_ID }),
    /exact lowercase Git SHA/u,
  );
});

test("private tag proof accepts only the reviewed lightweight tag", () => {
  assert.equal(inspectPrivateTag({
    object: { sha: PRIVATE_SHA, type: "commit" },
    ref: `refs/tags/${PRIVATE_REF}`,
  }, { expectedSha: PRIVATE_SHA, ref: PRIVATE_REF }), PRIVATE_SHA);
  assert.throws(() => inspectPrivateTag({
    object: { sha: PRIVATE_SHA, type: "tag" },
    ref: `refs/tags/${PRIVATE_REF}`,
  }, { expectedSha: PRIVATE_SHA, ref: PRIVATE_REF }), /lightweight tag/u);
});

test("private workflow proof binds exact name, path, state, and id", () => {
  assert.equal(inspectPrivateWorkflow({
    id: WORKFLOW_ID,
    name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
    path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
    state: "active",
  }), WORKFLOW_ID);
  assert.throws(() => inspectPrivateWorkflow({
    id: WORKFLOW_ID,
    name: "Spoofed workflow",
    path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
    state: "active",
  }), /identity is invalid/u);
});

test("dispatch receipt accepts only the returned positive run id", () => {
  assert.equal(inspectDispatchReceipt({ workflow_run_id: RUN_ID }), RUN_ID);
  assert.throws(() => inspectDispatchReceipt({}), /did not return workflow_run_id/u);
});

test("private run proof binds repository, workflow, tag SHA, event, and first attempt", () => {
  assert.deepEqual(inspectPrivateRun(privateRun(), {
    privateRef: PRIVATE_REF,
    privateSha: PRIVATE_SHA,
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
  }), { complete: true, conclusion: "success" });
  for (const overrides of [
    { event: "push" },
    { head_sha: PUBLIC_SHA },
    { path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH },
    { run_attempt: 2 },
    { repository: { full_name: "other/private" } },
  ]) {
    assert.throws(() => inspectPrivateRun(privateRun(overrides), {
      privateRef: PRIVATE_REF,
      privateSha: PRIVATE_SHA,
      runId: RUN_ID,
      workflowId: WORKFLOW_ID,
    }), /run identity is invalid/u);
  }
});

test("supported-reader digest is deterministic and rejects duplicates", () => {
  assert.equal(
    supportedReaderDigest([PRIVATE_SHA, OTHER_READER_SHA]),
    supportedReaderDigest([OTHER_READER_SHA, PRIVATE_SHA]),
  );
  assert.throws(
    () => supportedReaderDigest([PRIVATE_SHA, PRIVATE_SHA]),
    /duplicate SHA/u,
  );
});

test("attestation accepts every unique successful reader and its exact digest", () => {
  assert.deepEqual(inspectAttestationJobs(proofJobs(), {
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  }), {
    digest: supportedReaderDigest([PRIVATE_SHA, OTHER_READER_SHA]),
    readerCount: 2,
  });
});

test("attestation rejects an omitted pinned controller reader", () => {
  const jobs = proofJobs().filter((job) => job.name !== buildReaderJobName(PRIVATE_SHA));
  assert.throws(() => inspectAttestationJobs(jobs, {
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  }), /omitted the pinned private controller/u);
});

test("attestation rejects duplicate readers and duplicate job ids", () => {
  const duplicateReader = {
    ...proofJobs()[0],
    id: 4,
  };
  assert.throws(() => inspectAttestationJobs([...proofJobs(), duplicateReader], {
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  }), /duplicate SHA/u);
  assert.throws(() => inspectAttestationJobs([
    ...proofJobs(),
    { ...duplicateReader, id: 1 },
  ], {
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  }), /duplicate id/u);
});

test("attestation rejects malformed, skipped, failed, and mismatched proof jobs", () => {
  const scenarios = [
    [{ ...proofJobs()[0], name: "Temporal compatibility reader main" }, /malformed proof job/u],
    [{ ...proofJobs()[0], conclusion: "skipped" }, /did not complete successfully/u],
    [{ ...proofJobs()[0], conclusion: "failure" }, /did not complete successfully/u],
    [{ ...proofJobs()[0], head_sha: PUBLIC_SHA }, /not bound to the accepted run/u],
  ];
  for (const [replacement, expected] of scenarios) {
    assert.throws(() => inspectAttestationJobs([
      replacement,
      ...proofJobs().slice(1),
    ], {
      privateSha: PRIVATE_SHA,
      publicSha: PUBLIC_SHA,
      requestId: REQUEST_ID,
      runId: RUN_ID,
    }), expected);
  }
});

test("attestation rejects a digest, public SHA, or request-id mismatch", () => {
  assert.throws(() => inspectAttestationJobs(proofJobs({ digest: "d".repeat(64) }), {
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  }), /does not bind the requested proof/u);
  const jobs = proofJobs();
  jobs[2] = {
    ...jobs[2],
    name: buildAttestationJobName({
      digest: supportedReaderDigest([PRIVATE_SHA, OTHER_READER_SHA]),
      publicSha: "d".repeat(40),
      requestId: REQUEST_ID,
    }),
  };
  assert.throws(() => inspectAttestationJobs(jobs, {
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
  }), /does not bind the requested proof/u);
});

test("job pagination fails closed on incomplete or changing totals", () => {
  assert.deepEqual(inspectJobPage({ jobs: proofJobs(), total_count: 3 }, {
    expectedTotal: null,
    page: 1,
  }), { jobs: proofJobs(), total: 3 });
  assert.throws(() => inspectJobPage({ jobs: [], total_count: 3 }, {
    expectedTotal: null,
    page: 1,
  }), /pagination is incomplete/u);
  assert.throws(() => inspectJobPage({ jobs: [], total_count: 4 }, {
    expectedTotal: 3,
    page: 2,
  }), /count changed/u);
});

test("controller dispatches only after tag, workflow, and current-head proof", async () => {
  const calls = [];
  await withCompatibilityEnv(async () => withFetch(async (url, init = {}) => {
    if (url.includes("/git/ref/tags/")) {
      calls.push("tag");
      return jsonResponse({ object: { sha: PRIVATE_SHA, type: "commit" }, ref: `refs/tags/${PRIVATE_REF}` });
    }
    if (url.includes("/actions/workflows/") && !url.endsWith("/dispatches")) {
      calls.push("workflow");
      return jsonResponse({
        id: WORKFLOW_ID,
        name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
        path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
        state: "active",
      });
    }
    if (url.endsWith("/pulls/42")) {
      calls.push("head");
      return jsonResponse(pullRequest());
    }
    if (url.endsWith("/dispatches")) {
      calls.push("dispatch");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        inputs: buildDispatchInputs({ publicSha: PUBLIC_SHA, requestId: REQUEST_ID }),
        ref: PRIVATE_REF,
        return_run_details: true,
      });
      return jsonResponse({ workflow_run_id: RUN_ID });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      calls.push("run");
      return jsonResponse(privateRun());
    }
    if (url.includes(`/actions/runs/${RUN_ID}/jobs`)) {
      calls.push("jobs");
      return jsonResponse({ jobs: proofJobs(), total_count: 3 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const proof = await runTemporalCompatibility({
      privateToken: "private-token",
      publicRepository: "cobuildwithus/murph",
      publicSha: PUBLIC_SHA,
      publicToken: "public-token",
      prNumber: 42,
      requestId: REQUEST_ID,
      sleepFn: async () => undefined,
    });
    assert.equal(proof.readerCount, 2);
    assert.deepEqual(calls, ["tag", "workflow", "head", "dispatch", "run", "jobs"]);
  }));
});

test("controller cancels only its accepted run when status polling becomes uncertain", async () => {
  const controlUrls = [];
  let runReads = 0;
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.includes("/git/ref/tags/")) {
      return jsonResponse({ object: { sha: PRIVATE_SHA, type: "commit" }, ref: `refs/tags/${PRIVATE_REF}` });
    }
    if (url.includes("/actions/workflows/") && !url.endsWith("/dispatches")) {
      return jsonResponse({
        id: WORKFLOW_ID,
        name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
        path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
        state: "active",
      });
    }
    if (url.endsWith("/pulls/42")) return jsonResponse(pullRequest());
    if (url.endsWith("/dispatches")) return jsonResponse({ workflow_run_id: RUN_ID });
    if (url.endsWith(`/actions/runs/${RUN_ID}/cancel`)) {
      controlUrls.push(url);
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      runReads += 1;
      if (runReads === 1) return new Response("unavailable", { status: 503 });
      return jsonResponse(privateRun({ conclusion: "cancelled" }));
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await assert.rejects(() => runTemporalCompatibility({
      privateToken: "private-token",
      publicRepository: "cobuildwithus/murph",
      publicSha: PUBLIC_SHA,
      publicToken: "public-token",
      prNumber: 42,
      requestId: REQUEST_ID,
      sleepFn: async () => undefined,
    }), /run lookup failed with HTTP 503/u);
    assert.deepEqual(controlUrls, [
      `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
    ]);
  }));
});

test("controller times out and cancels only its accepted run", async () => {
  const controlUrls = [];
  const originalNow = Date.now;
  let deadlineReached = false;
  let runReads = 0;
  try {
    Date.now = () => deadlineReached ? 1_000_000_000_000 : 0;
    await withCompatibilityEnv(async () => withFetch(async (url) => {
      if (url.includes("/git/ref/tags/")) {
        return jsonResponse({ object: { sha: PRIVATE_SHA, type: "commit" }, ref: `refs/tags/${PRIVATE_REF}` });
      }
      if (url.includes("/actions/workflows/") && !url.endsWith("/dispatches")) {
        return jsonResponse({
          id: WORKFLOW_ID,
          name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
          path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
          state: "active",
        });
      }
      if (url.endsWith("/pulls/42")) return jsonResponse(pullRequest());
      if (url.endsWith("/dispatches")) return jsonResponse({ workflow_run_id: RUN_ID });
      if (url.endsWith(`/actions/runs/${RUN_ID}/cancel`)) {
        controlUrls.push(url);
        return new Response(null, { status: 202 });
      }
      if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
        runReads += 1;
        return jsonResponse(privateRun(runReads === 1
          ? { conclusion: null, status: "in_progress" }
          : { conclusion: "cancelled", status: "completed" }));
      }
      throw new Error(`unexpected URL ${url}`);
    }, async () => {
      await assert.rejects(() => runTemporalCompatibility({
        privateToken: "private-token",
        publicRepository: "cobuildwithus/murph",
        publicSha: PUBLIC_SHA,
        publicToken: "public-token",
        prNumber: 42,
        requestId: REQUEST_ID,
        sleepFn: async () => {
          deadlineReached = true;
        },
      }), /run timed out/u);
    }));
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(controlUrls, [
    `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
  ]);
  assert.equal(runReads, 2);
});

test("missing dispatch identity never issues a broad or guessed cancellation", async () => {
  const controls = [];
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.includes("/git/ref/tags/")) {
      return jsonResponse({ object: { sha: PRIVATE_SHA, type: "commit" }, ref: `refs/tags/${PRIVATE_REF}` });
    }
    if (url.includes("/actions/workflows/") && !url.endsWith("/dispatches")) {
      return jsonResponse({
        id: WORKFLOW_ID,
        name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
        path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
        state: "active",
      });
    }
    if (url.endsWith("/pulls/42")) return jsonResponse(pullRequest());
    if (url.endsWith("/dispatches")) return jsonResponse({});
    if (url.includes("/cancel")) controls.push(url);
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await assert.rejects(() => runTemporalCompatibility({
      privateToken: "private-token",
      publicRepository: "cobuildwithus/murph",
      publicSha: PUBLIC_SHA,
      publicToken: "public-token",
      prNumber: 42,
      requestId: REQUEST_ID,
    }), /did not return workflow_run_id/u);
    assert.deepEqual(controls, []);
  }));
});

test("accepted-run cancellation force-cancels only after ordinary cancellation stays nonterminal", async () => {
  const controls = [];
  let runReads = 0;
  await withFetch(async (url) => {
    if (url.endsWith(`/actions/runs/${RUN_ID}/cancel`)) {
      controls.push("cancel");
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}/force-cancel`)) {
      controls.push("force-cancel");
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      runReads += 1;
      return jsonResponse(privateRun(runReads <= 8
        ? { conclusion: null, status: "in_progress" }
        : { conclusion: "cancelled", status: "completed" }));
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await cancelAcceptedRun({
      privateRef: PRIVATE_REF,
      privateSha: PRIVATE_SHA,
      runId: RUN_ID,
      sleepFn: async () => undefined,
      token: "private-token",
      workflowId: WORKFLOW_ID,
    });
    assert.deepEqual(controls, ["cancel", "force-cancel"]);
  });
});

test("workflow keeps credentials behind trusted selection and publishes one stable context", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "temporal-compatibility.yml"),
    "utf8",
  );
  assert.match(workflow, /on:\n  workflow_run:/u);
  assert.match(workflow, /environment: temporal-compatibility/u);
  assert.match(workflow, /owner: cobuildwithus\n\s+repositories: murph-cloud/u);
  assert.match(workflow, /permission-actions: write\n\s+permission-contents: read/u);
  assert.match(workflow, /context='Temporal compatibility'/u);
  assert.doesNotMatch(workflow, /ref: \$\{\{ needs\.select-pr\.outputs\.head_sha \}\}/u);
  const credentialedJob = workflow.slice(
    workflow.indexOf("  compatibility:\n"),
    workflow.indexOf("  required:\n"),
  );
  assert.ok(
    credentialedJob.indexOf("Revalidate exact PR head before credentialed setup")
      < credentialedJob.indexOf("Mint private compatibility token"),
  );
  assert.ok(
    credentialedJob.indexOf("ref: ${{ github.event.repository.default_branch }}")
      < credentialedJob.indexOf("Mint private compatibility token"),
  );
});

test("workflow status shell executes every terminal outcome", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "temporal-compatibility.yml"),
    "utf8",
  );
  const script = extractWorkflowStepScript(workflow, "Publish stable commit status");
  const baseEnv = {
    COMPATIBILITY_RESULT: "skipped",
    SELECT_RESULT: "success",
    SELECTED: "true",
    SOURCE_RESULT: "success",
    TRUSTED: "true",
  };
  const scenarios = [
    [{ SELECT_RESULT: "failure" }, "failure", "Temporal compatibility selection failed."],
    [{ SELECTED: "false" }, "success", "No hosted Temporal compatibility owner changed."],
    [{ SOURCE_RESULT: "failure" }, "failure", "Repo Hygiene did not pass for this exact commit."],
    [{ TRUSTED: "false" }, "failure", "Relevant changes require a same-repository human-authored head."],
    [{ COMPATIBILITY_RESULT: "success" }, "success", "Exact public SHA passed every supported private Temporal reader."],
    [{ COMPATIBILITY_RESULT: "failure" }, "failure", "No complete exact-SHA private Temporal compatibility proof was recorded."],
  ];
  const tempDir = await mkdtemp(path.join(tmpdir(), "temporal-compatibility-status-proof-"));
  try {
    await writeFile(path.join(tempDir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$GH_CAPTURE"
`, { mode: 0o755 });
    for (const [index, [overrides, expectedState, expectedDescription]] of scenarios.entries()) {
      const capturePath = path.join(tempDir, `gh-${index}.args`);
      const result = spawnSync("bash", ["-c", script], {
        cwd: REPO_ROOT,
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
          STATUS_SHA: PUBLIC_SHA,
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

test("Repo Hygiene owns the focused controller contract test", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "repo-hygiene.yml"),
    "utf8",
  );
  assert.match(workflow, /node --test scripts\/hosted-orchestration-compatibility\.test\.mjs/u);
});

async function withCompatibilityEnv(fn) {
  const names = {
    TEMPORAL_COMPATIBILITY_PRIVATE_EXPECTED_SHA: PRIVATE_SHA,
    TEMPORAL_COMPATIBILITY_PRIVATE_REF: PRIVATE_REF,
  };
  const original = new Map(Object.keys(names).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, names);
    return await fn();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withFetch(fetchImpl, fn) {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  try {
    globalThis.fetch = (url, init) => fetchImpl(String(url), init);
    console.log = () => undefined;
    return await fn();
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  }
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

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}
