import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH,
  TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY,
  TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
  TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
  TEMPORAL_COMPATIBILITY_RUN_TIMEOUT_MS,
  TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS,
  TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS,
  buildAttestationJobName,
  buildDispatchInputs,
  buildReaderJobName,
  cancelAcceptedRun,
  compatibilityProofDigest,
  inspectAttestationJobs,
  inspectChangedFilePage,
  inspectDispatchReceipt,
  inspectExactPublicHead,
  inspectJobPage,
  inspectPrivateMainRef,
  inspectPrivateRun,
  inspectPrivateWorkflow,
  inspectPullRequest,
  inspectProducerFixtures,
  isTemporalCompatibilityRelevantPath,
  runTemporalCompatibility,
  selectPullRequest,
  supportedReaderDigest,
} from "./hosted-orchestration-compatibility.mjs";

const PUBLIC_SHA = "a".repeat(40);
const PRIVATE_SHA = "b".repeat(40);
const CURRENT_READER_SHA = "c".repeat(40);
const RAMPING_READER_SHA = "d".repeat(40);
const MOVED_PRIVATE_SHA = "e".repeat(40);
const REQUEST_ID = `temporal-${PUBLIC_SHA}-123-1`;
const PRODUCER_FIXTURES = JSON.stringify([{
  blocked: null,
  mailboxLag: [],
  workspace: null,
}]);
const PRODUCER_DIGEST = inspectProducerFixtures(PRODUCER_FIXTURES).digest;
const WORKFLOW_ID = 321;
const RUN_ID = 654;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pullRequest(overrides = {}) {
  return {
    base: {
      ref: "main",
      repo: { full_name: "cobuildwithus/murph" },
    },
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

function privateMainRef(sha = PRIVATE_SHA, overrides = {}) {
  return {
    object: { sha, type: "commit" },
    ref: `refs/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`,
    ...overrides,
  };
}

function privateRun(overrides = {}) {
  return {
    conclusion: "success",
    event: "workflow_dispatch",
    head_repository: { full_name: TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY },
    head_branch: TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH,
    head_sha: PRIVATE_SHA,
    id: RUN_ID,
    name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
    path: `${TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH}@${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`,
    repository: { full_name: TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY },
    run_attempt: 1,
    status: "completed",
    workflow_id: WORKFLOW_ID,
    ...overrides,
  };
}

function proofJobs({ proofDigest = compatibilityProofDigest({
  producerDigest: PRODUCER_DIGEST,
  publicSha: PUBLIC_SHA,
  readersDigest: supportedReaderDigest([
    PRIVATE_SHA,
    CURRENT_READER_SHA,
    RAMPING_READER_SHA,
  ]),
  requestId: REQUEST_ID,
}) } = {}) {
  return [
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 1,
      name: buildReaderJobName(CURRENT_READER_SHA),
      run_id: RUN_ID,
      status: "completed",
    },
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 2,
      name: buildReaderJobName(RAMPING_READER_SHA),
      run_id: RUN_ID,
      status: "completed",
    },
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 3,
      name: buildReaderJobName(PRIVATE_SHA),
      run_id: RUN_ID,
      status: "completed",
    },
    {
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 4,
      name: buildAttestationJobName({ proofDigest }),
      run_id: RUN_ID,
      status: "completed",
    },
  ];
}

function compatibilityArgs(overrides = {}) {
  return {
    expectedBaseRef: "main",
    privateToken: "private-token",
    producerDigest: PRODUCER_DIGEST,
    producerFixtures: PRODUCER_FIXTURES,
    publicRepository: "cobuildwithus/murph",
    publicSha: PUBLIC_SHA,
    publicToken: "public-token",
    prNumber: 42,
    requestId: REQUEST_ID,
    ...overrides,
  };
}

function proofInspectionArgs(overrides = {}) {
  return {
    privateSha: PRIVATE_SHA,
    producerDigest: PRODUCER_DIGEST,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    ...overrides,
  };
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
    "scripts/temporal-compatibility-producer-fixtures.ts",
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
    expectedBaseRef: "main",
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), {
    changedFiles: 1,
    headSha: PUBLIC_SHA,
    targetsDefaultBranch: true,
    trusted: true,
  });
});

test("pull-request inspection rejects a stale workflow-run head", () => {
  assert.throws(() => inspectPullRequest(pullRequest({
    head: { repo: { full_name: "cobuildwithus/murph" }, sha: "d".repeat(40) },
  }), {
    expectedBaseRef: "main",
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), /changed after Repo Hygiene/u);
});

test("pull-request inspection rejects fork and bot authority without rejecting classification", () => {
  assert.equal(inspectPullRequest(pullRequest({
    head: { repo: { full_name: "fork/murph" }, sha: PUBLIC_SHA },
  }), {
    expectedBaseRef: "main",
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }).trusted, false);
  assert.equal(inspectPullRequest(pullRequest({ user: { type: "Bot" } }), {
    expectedBaseRef: "main",
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }).trusted, false);
});

test("pull-request inspection isolates the canonical status to the default base", () => {
  assert.equal(inspectPullRequest(pullRequest({
    base: {
      ref: "stack-base",
      repo: { full_name: "cobuildwithus/murph" },
    },
  }), {
    expectedBaseRef: "main",
    expectedHeadSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }).targetsDefaultBranch, false);

  for (const base of [
    undefined,
    { ref: "main" },
    { ref: "main", repo: { full_name: "fork/murph" } },
    { ref: "", repo: { full_name: "cobuildwithus/murph" } },
  ]) {
    assert.throws(() => inspectPullRequest(pullRequest({ base }), {
      expectedBaseRef: "main",
      expectedHeadSha: PUBLIC_SHA,
      prNumber: 42,
      repository: "cobuildwithus/murph",
    }), /base/u);
  }
});

test("pre-dispatch head proof rechecks same-repository human authority", () => {
  assert.throws(() => inspectExactPublicHead(pullRequest({
    head: { repo: { full_name: "fork/murph" }, sha: PUBLIC_SHA },
  }), {
    expectedBaseRef: "main",
    expectedSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), /no longer a same-repository human-authored head/u);
  assert.throws(() => inspectExactPublicHead(pullRequest({
    base: {
      ref: "stack-base",
      repo: { full_name: "cobuildwithus/murph" },
    },
  }), {
    expectedBaseRef: "main",
    expectedSha: PUBLIC_SHA,
    prNumber: 42,
    repository: "cobuildwithus/murph",
  }), /no longer targets the default branch/u);
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
      expectedBaseRef: "main",
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
      expectedBaseRef: "main",
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
  assert.deepEqual(buildDispatchInputs({
    producerDigest: PRODUCER_DIGEST,
    producerFixtures: PRODUCER_FIXTURES,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
  }), {
    contract_version: "1",
    mode: "temporal_compatibility",
    murph_sha: PUBLIC_SHA,
    producer_digest: PRODUCER_DIGEST,
    producer_fixtures: PRODUCER_FIXTURES,
    request_id: REQUEST_ID,
  });
  assert.throws(
    () => buildDispatchInputs({
      producerDigest: PRODUCER_DIGEST,
      producerFixtures: PRODUCER_FIXTURES,
      publicSha: "main",
      requestId: REQUEST_ID,
    }),
    /exact lowercase Git SHA/u,
  );
});

test("producer artifact is bounded and private main resolves to an exact commit", () => {
  assert.deepEqual(inspectProducerFixtures(`  ${PRODUCER_FIXTURES}\n`), {
    digest: PRODUCER_DIGEST,
    serialized: PRODUCER_FIXTURES,
  });
  assert.throws(() => inspectProducerFixtures(JSON.stringify([])), /artifact is invalid/u);
  assert.throws(() => inspectProducerFixtures(`[{"value":"${"x".repeat(33_000)}"}]`), /too large/u);
  assert.equal(inspectPrivateMainRef(privateMainRef()), PRIVATE_SHA);
  for (const invalid of [
    privateMainRef(PRIVATE_SHA, { ref: "refs/heads/release" }),
    privateMainRef(PRIVATE_SHA, { object: { sha: PRIVATE_SHA, type: "tag" } }),
    privateMainRef("not-a-sha"),
  ]) {
    assert.throws(() => inspectPrivateMainRef(invalid), /[Pp]rivate main|exact lowercase Git SHA/u);
  }
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

test("private run proof binds repository, workflow, main SHA, event, and first attempt", () => {
  assert.deepEqual(inspectPrivateRun(privateRun(), {
    privateSha: PRIVATE_SHA,
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
  }), { complete: true, conclusion: "success" });
  assert.deepEqual(inspectPrivateRun(privateRun({
    path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
  }), {
    privateSha: PRIVATE_SHA,
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
  }), { complete: true, conclusion: "success" });
  for (const overrides of [
    { event: "push" },
    { head_branch: "release" },
    { head_sha: PUBLIC_SHA },
    { path: `${TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH}@refs/heads/main` },
    { run_attempt: 2 },
    { repository: { full_name: "other/private" } },
  ]) {
    assert.throws(() => inspectPrivateRun(privateRun(overrides), {
      privateSha: PRIVATE_SHA,
      runId: RUN_ID,
      workflowId: WORKFLOW_ID,
    }), /run identity is invalid/u);
  }
});

test("supported-reader digest is deterministic and rejects duplicates", () => {
  assert.equal(
    supportedReaderDigest([CURRENT_READER_SHA, RAMPING_READER_SHA]),
    supportedReaderDigest([RAMPING_READER_SHA, CURRENT_READER_SHA]),
  );
  assert.throws(
    () => supportedReaderDigest([CURRENT_READER_SHA, CURRENT_READER_SHA]),
    /duplicate SHA/u,
  );
});

test("attestation accepts private-owned Current, Ramping, and dispatched candidate readers", () => {
  assert.deepEqual(inspectAttestationJobs(proofJobs(), {
    ...proofInspectionArgs(),
  }), {
    digest: supportedReaderDigest([
      PRIVATE_SHA,
      CURRENT_READER_SHA,
      RAMPING_READER_SHA,
    ]),
    proofDigest: compatibilityProofDigest({
      producerDigest: PRODUCER_DIGEST,
      publicSha: PUBLIC_SHA,
      readersDigest: supportedReaderDigest([
        PRIVATE_SHA,
        CURRENT_READER_SHA,
        RAMPING_READER_SHA,
      ]),
      requestId: REQUEST_ID,
    }),
    readerCount: 3,
  });
});

test("attestation rejects omission of the dispatched private candidate", () => {
  assert.throws(() => inspectAttestationJobs(
    proofJobs().filter((job) => job.name !== buildReaderJobName(PRIVATE_SHA)),
    { ...proofInspectionArgs() },
  ), /omitted the dispatched private candidate/u);
});

test("attestation rejects duplicate readers and duplicate job ids", () => {
  const duplicateReader = {
    ...proofJobs()[0],
    id: 5,
  };
  assert.throws(() => inspectAttestationJobs([...proofJobs(), duplicateReader], {
    ...proofInspectionArgs(),
  }), /duplicate SHA/u);
  assert.throws(() => inspectAttestationJobs([
    ...proofJobs(),
    { ...duplicateReader, id: 1 },
  ], {
    ...proofInspectionArgs(),
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
      ...proofInspectionArgs(),
    }), expected);
  }
});

test("attestation rejects a producer digest, public SHA, or request-id mismatch", () => {
  assert.throws(() => inspectAttestationJobs(proofJobs({ proofDigest: "d".repeat(64) }), {
    ...proofInspectionArgs(),
  }), /does not bind the requested proof/u);
  assert.throws(() => inspectAttestationJobs(proofJobs(), {
    ...proofInspectionArgs({ producerDigest: "d".repeat(64) }),
  }), /does not bind the requested proof/u);
  assert.throws(() => inspectAttestationJobs(proofJobs(), {
    ...proofInspectionArgs({ publicSha: "d".repeat(40) }),
  }), /does not bind the requested proof/u);
  assert.throws(() => inspectAttestationJobs(proofJobs(), {
    ...proofInspectionArgs({ requestId: "different-request" }),
  }), /does not bind the requested proof/u);
});

test("job proof is one bounded page and fails closed on incomplete totals", () => {
  assert.deepEqual(inspectJobPage({ jobs: proofJobs(), total_count: 4 }), proofJobs());
  assert.throws(
    () => inspectJobPage({ jobs: [], total_count: 4 }),
    /pagination is incomplete/u,
  );
  assert.throws(
    () => inspectJobPage({ jobs: [], total_count: 101 }),
    /malformed/u,
  );
});

test("controller dispatches main only after exact private-head, workflow, and public-head proof", async () => {
  const calls = [];
  await withCompatibilityEnv(async () => withFetch(async (url, init = {}) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      calls.push("main");
      assert.equal(init.headers.authorization, "Bearer private-token");
      return jsonResponse(privateMainRef());
    }
    if (url.includes("/actions/workflows/") && !url.endsWith("/dispatches")) {
      calls.push("workflow");
      assert.equal(init.headers.authorization, "Bearer private-token");
      return jsonResponse({
        id: WORKFLOW_ID,
        name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
        path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
        state: "active",
      });
    }
    if (url.endsWith("/pulls/42")) {
      calls.push("head");
      assert.equal(init.headers.authorization, "Bearer public-token");
      return jsonResponse(pullRequest());
    }
    if (url.endsWith("/dispatches")) {
      calls.push("dispatch");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.authorization, "Bearer private-token");
      assert.deepEqual(JSON.parse(init.body), {
        inputs: buildDispatchInputs({
          producerDigest: PRODUCER_DIGEST,
          producerFixtures: PRODUCER_FIXTURES,
          publicSha: PUBLIC_SHA,
          requestId: REQUEST_ID,
        }),
        ref: TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH,
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
      return jsonResponse({ jobs: proofJobs(), total_count: 4 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const proof = await runTemporalCompatibility(compatibilityArgs({
      sleepFn: async () => undefined,
    }));
    assert.equal(proof.readerCount, 3);
    assert.deepEqual(calls, [
      "main",
      "workflow",
      "head",
      "dispatch",
      "run",
      "jobs",
      "head",
      "main",
    ]);
  }));
});

test("controller finalizes a last-admitted success before the private token safety boundary", async () => {
  let nowMs = 0;
  let dispatchFinishedAt = null;
  let privateMainReads = 0;
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    nowMs += 30_000;
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      privateMainReads += 1;
      return jsonResponse(privateMainRef());
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
    if (url.endsWith("/dispatches")) {
      dispatchFinishedAt = nowMs;
      return jsonResponse({ workflow_run_id: RUN_ID });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      assert.notEqual(dispatchFinishedAt, null);
      nowMs = dispatchFinishedAt + TEMPORAL_COMPATIBILITY_RUN_TIMEOUT_MS;
      return jsonResponse(privateRun());
    }
    if (url.includes(`/actions/runs/${RUN_ID}/jobs`)) {
      return jsonResponse({ jobs: proofJobs(), total_count: 4 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const proof = await runTemporalCompatibility(compatibilityArgs({
      now: () => nowMs,
      sleepFn: async (duration) => {
        nowMs += duration;
      },
    }));
    assert.equal(proof.readerCount, 3);
  }));
  assert.equal(privateMainReads, 2);
  assert.ok(nowMs < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS);
  assert.ok(
    TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - nowMs
      > TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS,
  );
});

test("controller rejects a dispatch race that runs a different private main head", async () => {
  const controls = [];
  let mainReads = 0;
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      mainReads += 1;
      return jsonResponse(privateMainRef());
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
      controls.push(url);
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      return jsonResponse(privateRun({
        conclusion: null,
        head_sha: MOVED_PRIVATE_SHA,
        status: "in_progress",
      }));
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await assert.rejects(
      () => runTemporalCompatibility(compatibilityArgs({ sleepFn: async () => undefined })),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /could not be proven terminal/u);
        assert.ok(error.errors.some((cause) =>
          cause instanceof Error && /run identity is invalid/u.test(cause.message)));
        return true;
      },
    );
    assert.equal(mainReads, 1);
    assert.deepEqual(controls, [
      `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
    ]);
  }));
});

test("controller fails closed when private main moves before success is accepted", async () => {
  let mainReads = 0;
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      mainReads += 1;
      return jsonResponse(privateMainRef(mainReads === 1 ? PRIVATE_SHA : MOVED_PRIVATE_SHA));
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
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) return jsonResponse(privateRun());
    if (url.includes(`/actions/runs/${RUN_ID}/jobs`)) {
      return jsonResponse({ jobs: proofJobs(), total_count: 4 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await assert.rejects(
      () => runTemporalCompatibility(compatibilityArgs({ sleepFn: async () => undefined })),
      /Private main changed during Temporal compatibility proof/u,
    );
    assert.equal(mainReads, 2);
  }));
});

test("controller waits for its accepted exact run to become visible", async () => {
  let runReads = 0;
  const sleepDurations = [];
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      return jsonResponse(privateMainRef());
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
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      runReads += 1;
      return runReads === 1
        ? new Response("not yet visible", { status: 404 })
        : jsonResponse(privateRun());
    }
    if (url.includes(`/actions/runs/${RUN_ID}/jobs`)) {
      return jsonResponse({ jobs: proofJobs(), total_count: 4 });
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    const proof = await runTemporalCompatibility(compatibilityArgs({
      sleepFn: async (duration) => {
        sleepDurations.push(duration);
      },
    }));
    assert.equal(proof.readerCount, 3);
    assert.equal(runReads, 2);
    assert.deepEqual(sleepDurations, [15_000]);
  }));
});

test("controller does not reopen visibility recovery after the run is visible", async () => {
  const controls = [];
  let runReads = 0;
  const sleepDurations = [];
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      return jsonResponse(privateMainRef());
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
      controls.push(url);
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      runReads += 1;
      if (runReads === 1) {
        return jsonResponse(privateRun({ conclusion: null, status: "in_progress" }));
      }
      if (runReads === 2) return new Response("uncertain after visibility", { status: 404 });
      return jsonResponse(privateRun({ conclusion: "cancelled" }));
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await assert.rejects(() => runTemporalCompatibility(compatibilityArgs({
      sleepFn: async (duration) => {
        sleepDurations.push(duration);
      },
    })), /run lookup failed with HTTP 404/u);
    assert.equal(runReads, 3);
    assert.deepEqual(sleepDurations, [15_000]);
    assert.deepEqual(controls, [
      `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
    ]);
  }));
});

test("controller bounds exact-run visibility recovery before cancellation", async () => {
  const controls = [];
  let runReads = 0;
  const sleepDurations = [];
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      return jsonResponse(privateMainRef());
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
      controls.push(url);
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      runReads += 1;
      return runReads <= 5
        ? new Response("not yet visible", { status: 404 })
        : jsonResponse(privateRun({ conclusion: "cancelled" }));
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await assert.rejects(() => runTemporalCompatibility(compatibilityArgs({
      sleepFn: async (duration) => {
        sleepDurations.push(duration);
      },
    })), /run lookup failed with HTTP 404/u);
    assert.equal(runReads, 6);
    assert.deepEqual(sleepDurations, [15_000, 15_000, 15_000, 15_000]);
    assert.deepEqual(controls, [
      `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
    ]);
  }));
});

test("controller cancels only its accepted run when status polling becomes uncertain", async () => {
  const controlUrls = [];
  let runReads = 0;
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      return jsonResponse(privateMainRef());
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
    await assert.rejects(() => runTemporalCompatibility(compatibilityArgs({
      sleepFn: async () => undefined,
    })), /run lookup failed with HTTP 503/u);
    assert.deepEqual(controlUrls, [
      `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
    ]);
  }));
});

test("controller times out and cancels only its accepted run", async () => {
  const controlUrls = [];
  let nowMs = 0;
  let forceCancelFinishedAt = null;
  let runReads = 0;
  await withCompatibilityEnv(async () => withFetch(async (url) => {
      nowMs += 30_000;
      if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
        return jsonResponse(privateMainRef());
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
      if (url.endsWith(`/actions/runs/${RUN_ID}/force-cancel`)) {
        controlUrls.push(url);
        forceCancelFinishedAt = nowMs;
        return new Response(null, { status: 202 });
      }
      if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
        runReads += 1;
        const forceCancellationSettled = forceCancelFinishedAt !== null
          && nowMs - forceCancelFinishedAt >= 2 * 60_000;
        return jsonResponse(privateRun(forceCancellationSettled
          ? { conclusion: "cancelled", status: "completed" }
          : { conclusion: null, status: "in_progress" }));
      }
      throw new Error(`unexpected URL ${url}`);
    }, async () => {
      await assert.rejects(() => runTemporalCompatibility(compatibilityArgs({
        now: () => nowMs,
        sleepFn: async (duration) => {
          nowMs += duration;
        },
      })), /run timed out/u);
    }));
  assert.deepEqual(controlUrls, [
    `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/cancel`,
    `https://api.github.com/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/actions/runs/${RUN_ID}/force-cancel`,
  ]);
  assert.ok(runReads > 2);
  assert.ok(nowMs < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS);
});

test("missing dispatch identity never issues a broad or guessed cancellation", async () => {
  const controls = [];
  await withCompatibilityEnv(async () => withFetch(async (url) => {
    if (url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)) {
      return jsonResponse(privateMainRef());
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
    await assert.rejects(
      () => runTemporalCompatibility(compatibilityArgs()),
      /did not return workflow_run_id/u,
    );
    assert.deepEqual(controls, []);
  }));
});

test("accepted-run cancellation force-cancels only after ordinary cancellation stays nonterminal", async () => {
  const controls = [];
  let nowMs = 0;
  let forceCancelFinishedAt = null;
  await withFetch(async (url) => {
    nowMs += 30_000;
    if (url.endsWith(`/actions/runs/${RUN_ID}/cancel`)) {
      controls.push("cancel");
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}/force-cancel`)) {
      controls.push("force-cancel");
      forceCancelFinishedAt = nowMs;
      return new Response(null, { status: 202 });
    }
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      const forceCancellationSettled = forceCancelFinishedAt !== null
        && nowMs - forceCancelFinishedAt >= 2 * 60_000;
      return jsonResponse(privateRun(forceCancellationSettled
        ? { conclusion: "cancelled", status: "completed" }
        : { conclusion: null, status: "in_progress" }));
    }
    throw new Error(`unexpected URL ${url}`);
  }, async () => {
    await cancelAcceptedRun({
      privateSha: PRIVATE_SHA,
      now: () => nowMs,
      runId: RUN_ID,
      sleepFn: async (duration) => {
        nowMs += duration;
      },
      token: "private-token",
      workflowId: WORKFLOW_ID,
    });
    assert.deepEqual(controls, ["cancel", "force-cancel"]);
    assert.equal(forceCancelFinishedAt, 3 * 60_000);
    assert.equal(nowMs, 5 * 60_000);
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
  assert.match(
    workflow,
    /EXPECTED_BASE_REF: \$\{\{ github\.event\.repository\.default_branch \}\}/u,
  );
  assert.equal(
    workflow.match(/EXPECTED_BASE_REF: \$\{\{ github\.event\.repository\.default_branch \}\}/gu)?.length,
    2,
  );
  assert.match(
    workflow,
    /targets_default_branch: \$\{\{ steps\.select\.outputs\.targets_default_branch \}\}/u,
  );
  assert.match(
    workflow,
    /- name: Mark stable status pending\n\s+if: \$\{\{ steps\.select\.outputs\.targets_default_branch == 'true' \}\}/u,
  );
  assert.match(
    workflow,
    /compatibility:\n[\s\S]*?if: \$\{\{ github\.event\.workflow_run\.conclusion == 'success' && needs\.select-pr\.outputs\.targets_default_branch == 'true' && needs\.select-pr\.outputs\.selected == 'true' && needs\.select-pr\.outputs\.trusted == 'true' \}\}/u,
  );
  assert.match(
    workflow,
    /required:\n[\s\S]*?if: \$\{\{ always\(\) && github\.event\.workflow_run\.event == 'pull_request' && github\.event\.workflow_run\.pull_requests\[0\] != null && needs\.select-pr\.outputs\.targets_default_branch == 'true' \}\}/u,
  );
  assert.match(workflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/u);
  assert.match(workflow, /temporal-compatibility-producer-\$\{\{ needs\.select-pr\.outputs\.head_sha \}\}/u);
  assert.doesNotMatch(workflow, /TEMPORAL_COMPATIBILITY_PRIVATE_EXPECTED_SHA/u);
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
  return fn();
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
