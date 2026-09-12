import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOSTED_RELEASE_ADMISSION_MODE,
  HOSTED_RELEASE_SCOPE_FOREGROUND,
  HOSTED_RELEASE_SCOPE_NONE,
  HOSTED_RELEASE_SCOPE_PRODUCTION_CORE,
  TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH,
  TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY,
  TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
  TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
  TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS,
  TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS,
  buildAttestationJobName,
  buildDispatchInputs,
  buildHostedReleaseAttestationJobName,
  buildReaderJobName,
  cancelAcceptedRun,
  compatibilityProofDigest,
  hostedReleaseProofDigest,
  inspectAttestationJobs,
  inspectChangedFilePage,
  inspectDispatchReceipt,
  inspectExactPublicHead,
  inspectJobPage,
  inspectPrivateMainRef,
  inspectPrivateRun,
  inspectPrivateWorkflow,
  inspectPublicBranchRef,
  inspectPublicCandidateAncestry,
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
const TEMPORAL_TARGET_DIGEST = "e".repeat(64);
const OTHER_TEMPORAL_TARGET_DIGEST = "f".repeat(64);
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

function publicMainRef(sha = PUBLIC_SHA, overrides = {}) {
  return {
    object: { sha, type: "commit" },
    ref: "refs/heads/main",
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

function proofJobs({
  expectedTemporalTargetDigest = TEMPORAL_TARGET_DIGEST,
  releaseScope = HOSTED_RELEASE_SCOPE_NONE,
  proofDigest = compatibilityProofDigest({
    producerDigest: PRODUCER_DIGEST,
    publicSha: PUBLIC_SHA,
    readersDigest: supportedReaderDigest([
      PRIVATE_SHA,
      CURRENT_READER_SHA,
      RAMPING_READER_SHA,
    ]),
    requestId: REQUEST_ID,
  }),
} = {}) {
  const jobs = [
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
  if (releaseScope !== HOSTED_RELEASE_SCOPE_NONE) {
    jobs.push({
      conclusion: "success",
      head_sha: PRIVATE_SHA,
      id: 5,
      name: buildHostedReleaseAttestationJobName({
        proofDigest: hostedReleaseProofDigest({
          expectedTemporalTargetDigest,
          releaseScope,
          privateSha: PRIVATE_SHA,
          publicSha: PUBLIC_SHA,
        }),
      }),
      run_id: RUN_ID,
      status: "completed",
    });
  }
  if (releaseScope === HOSTED_RELEASE_SCOPE_PRODUCTION_CORE) {
    const digest = hostedReleaseProofDigest({
      expectedTemporalTargetDigest,
      privateSha: PRIVATE_SHA,
      publicSha: PUBLIC_SHA,
      releaseScope,
    });
    for (const lane of [
      "linq-delivery",
      "linq-scheduled-reminder",
      "hosted-web-browser-smoke",
      "foreground-reply-priority",
      "foreground-checkpoint-ordering",
    ]) {
      jobs.push({
        conclusion: "success",
        head_sha: PRIVATE_SHA,
        id: jobs.length + 1,
        name: `Hosted production core proof / ${lane} / ${digest}`,
        run_id: RUN_ID,
        status: "completed",
      });
    }
  }
  return jobs;
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

test("public deployment ref inspection binds the exact configured branch", () => {
  assert.equal(inspectPublicBranchRef(publicMainRef(), "main"), PUBLIC_SHA);
  assert.throws(
    () => inspectPublicBranchRef(publicMainRef(PUBLIC_SHA, { ref: "refs/heads/other" }), "main"),
    /identity is invalid/u,
  );
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
    release_scope: "none",
    mode: "temporal_compatibility",
    murph_sha: PUBLIC_SHA,
    producer_digest: PRODUCER_DIGEST,
    producer_fixtures: PRODUCER_FIXTURES,
    request_id: REQUEST_ID,
    temporal_target_digest: "",
  });
  assert.deepEqual(buildDispatchInputs({
    expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
    releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    mode: HOSTED_RELEASE_ADMISSION_MODE,
    producerDigest: PRODUCER_DIGEST,
    producerFixtures: PRODUCER_FIXTURES,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
  }), {
    contract_version: "1",
    release_scope: "foreground_priority",
    mode: "release_admission",
    murph_sha: PUBLIC_SHA,
    producer_digest: PRODUCER_DIGEST,
    producer_fixtures: PRODUCER_FIXTURES,
    request_id: REQUEST_ID,
    temporal_target_digest: TEMPORAL_TARGET_DIGEST,
  });
  assert.throws(() => buildDispatchInputs({
    releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    mode: HOSTED_RELEASE_ADMISSION_MODE,
    producerDigest: PRODUCER_DIGEST,
    producerFixtures: PRODUCER_FIXTURES,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
  }), /expected Temporal target digest/u);
  assert.throws(() => buildDispatchInputs({
    releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    producerDigest: PRODUCER_DIGEST,
    producerFixtures: PRODUCER_FIXTURES,
    publicSha: PUBLIC_SHA,
    requestId: REQUEST_ID,
  }), /mode and hosted release scope do not match/u);
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
    name: `${TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME} / temporal_compatibility / ${PUBLIC_SHA} / none`,
  }), {
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
    { name: `${TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME}-spoofed` },
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

test("supported-reader digest matches the SHA-only wire vector and rejects duplicates", () => {
  assert.equal(
    supportedReaderDigest([CURRENT_READER_SHA, RAMPING_READER_SHA]),
    "76c0b5059fc6aef721085df3183c4184f236d4c6f7cac2d006d74ee0b8189b4b",
  );
  assert.equal(
    supportedReaderDigest([CURRENT_READER_SHA, RAMPING_READER_SHA]),
    supportedReaderDigest([RAMPING_READER_SHA, CURRENT_READER_SHA]),
  );
  assert.throws(
    () => supportedReaderDigest([CURRENT_READER_SHA, CURRENT_READER_SHA]),
    /duplicate SHA/u,
  );
});

test("attestation accepts the exact SHA-only private reader proof", () => {
  const readersDigest = supportedReaderDigest([
    PRIVATE_SHA,
    CURRENT_READER_SHA,
    RAMPING_READER_SHA,
  ]);
  assert.deepEqual(inspectAttestationJobs(proofJobs(), {
    ...proofInspectionArgs(),
  }), {
    digest: readersDigest,
    proofDigest: compatibilityProofDigest({
      producerDigest: PRODUCER_DIGEST,
      publicSha: PUBLIC_SHA,
      readersDigest,
      requestId: REQUEST_ID,
    }),
    releaseScope: HOSTED_RELEASE_SCOPE_NONE,
    readerCount: 3,
  });
});

test("hosted release attestation binds scope, exact revisions, and the expected Temporal target", () => {
  assert.equal(hostedReleaseProofDigest({
    expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
    privateSha: PRIVATE_SHA,
    publicSha: PUBLIC_SHA,
    releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
  }), "f5f38e52bff74f3d20cc60c9bc53bcef4341ca6260c84c18aa8bce929207fd0d");
  assert.equal(inspectAttestationJobs(
    proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND }),
    {
      expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
      ...proofInspectionArgs(),
      releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    },
  ).releaseScope, HOSTED_RELEASE_SCOPE_FOREGROUND);
  assert.throws(() => inspectAttestationJobs(
    proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND }),
    {
      expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
      ...proofInspectionArgs({ privateSha: MOVED_PRIVATE_SHA }),
      releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    },
  ), /not bound to the accepted run|does not bind/u);
  assert.throws(() => inspectAttestationJobs(proofJobs(), {
    expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
    ...proofInspectionArgs(),
    releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
  }), /exactly one hosted release attestation/u);
  assert.throws(() => inspectAttestationJobs(
    proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND }),
    {
      expectedTemporalTargetDigest: OTHER_TEMPORAL_TARGET_DIGEST,
      ...proofInspectionArgs(),
      releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    },
  ), /does not bind the requested proof/u);
});

test("production core admission requires every composed journey on the accepted revision", () => {
  const options = proofInspectionArgs({
    expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
    releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE,
  });
  const jobs = proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE });
  assert.equal(inspectAttestationJobs(jobs, options).releaseScope, "production_core");
  for (const proof of jobs.filter((job) => job.name.startsWith("Hosted production core"))) {
    for (const conclusion of ["skipped", "failure", "cancelled"]) {
      assert.throws(() => inspectAttestationJobs(
        jobs.map((job) => job.id === proof.id ? { ...job, conclusion } : job),
        options,
      ), /omitted a required lane|did not complete successfully/u);
    }
    assert.throws(() => inspectAttestationJobs(
      jobs.filter((job) => job.id !== proof.id),
      options,
    ), /omitted a required lane/u);
    assert.throws(() => inspectAttestationJobs(
      jobs.map((job) => job.id === proof.id ? { ...job, head_sha: PUBLIC_SHA } : job),
      options,
    ), /not bound to the accepted run/u);
  }
});

test("production core proof rejects duplicate, unknown, malformed, and stale journey receipts", () => {
  const options = proofInspectionArgs({
    expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
    releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE,
  });
  const jobs = proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE });
  const last = jobs.at(-1);
  for (const name of [
    jobs.at(-2).name,
    last.name.replace("foreground-checkpoint-ordering", "unrelated-scenario"),
    last.name.replace(/ [0-9a-f]{64}$/u, ` ${"0".repeat(64)}`),
    "Hosted production core proof / foreground-checkpoint-ordering / invalid",
  ]) {
    assert.throws(() => inspectAttestationJobs([
      ...jobs.slice(0, -1),
      { ...last, name },
    ], options), /duplicate, unknown, or mismatched lane|malformed proof job/u);
  }
  assert.throws(() => inspectAttestationJobs([
    ...proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND }),
    ...jobs.slice(5),
  ], { ...options, releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND }), /Unexpected hosted production core/u);
});

test("production core dispatch stays protected-release-only and cannot downgrade to foreground evidence", () => {
  const args = {
    expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
    mode: HOSTED_RELEASE_ADMISSION_MODE,
    producerDigest: PRODUCER_DIGEST,
    producerFixtures: PRODUCER_FIXTURES,
    publicSha: PUBLIC_SHA,
    releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE,
    requestId: REQUEST_ID,
  };
  assert.equal(buildDispatchInputs(args).release_scope, "production_core");
  assert.throws(() => buildDispatchInputs({ ...args, mode: "temporal_compatibility" }), /do not match/u);
  assert.throws(() => inspectAttestationJobs(
    proofJobs({ releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND }),
    proofInspectionArgs({
      expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
      releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE,
    }),
  ), /does not bind the requested proof/u);
});

test("attestation ignores completed skipped jobs from inactive proof lanes", () => {
  const skippedJobs = [
    {
      conclusion: "skipped",
      head_sha: PRIVATE_SHA,
      id: 5,
      name: "Hosted release attestation [proof=${{ needs.hosted-integration-plan.outputs.proof_digest }}]",
      run_id: RUN_ID,
      status: "completed",
    },
    {
      conclusion: "skipped",
      head_sha: PRIVATE_SHA,
      id: 6,
      name: "Temporal compatibility attestation [proof=${{ needs.temporal-compatibility-setup.outputs.proof_digest }}]",
      run_id: RUN_ID,
      status: "completed",
    },
  ];
  const expected = inspectAttestationJobs(proofJobs(), {
    ...proofInspectionArgs(),
  });
  for (const skippedJob of skippedJobs) {
    assert.deepEqual(inspectAttestationJobs([...proofJobs(), skippedJob], {
      ...proofInspectionArgs(),
    }), expected);
  }
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

test("attestation rejects malformed, required-skipped, failed, and mismatched proof jobs", () => {
  const scenarios = [
    [{ ...proofJobs()[0], name: "Temporal compatibility reader main" }, /malformed proof job/u],
    [{ ...proofJobs()[0], conclusion: "skipped" }, /does not bind the requested proof/u],
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

test("temporal-only attestation ignores the skipped hosted-release job placeholder", () => {
  const skippedHostedReleaseJob = {
    conclusion: "skipped",
    head_sha: PRIVATE_SHA,
    id: 5,
    name: "Hosted release attestation [proof=${{ needs.hosted-integration-plan.outputs.proof_digest }}]",
    run_id: RUN_ID,
    status: "completed",
  };
  assert.deepEqual(
    inspectAttestationJobs([...proofJobs(), skippedHostedReleaseJob], proofInspectionArgs()),
    inspectAttestationJobs(proofJobs(), proofInspectionArgs()),
  );
  assert.throws(() => inspectAttestationJobs(
    [...proofJobs(), skippedHostedReleaseJob],
    proofInspectionArgs({
      expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
      releaseScope: HOSTED_RELEASE_SCOPE_FOREGROUND,
    }),
  ), /exactly one hosted release attestation/u);
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

for (const releaseScope of [HOSTED_RELEASE_SCOPE_NONE, HOSTED_RELEASE_SCOPE_PRODUCTION_CORE]) {
  test(`controller completes ${releaseScope} after twenty queued and twenty-five executing minutes`, async () => {
    let dispatchedAt;
    const observedStatuses = new Set();
    await withTimedController({
      releaseScope,
      respond: ({ kind }, clock) => {
        if (kind === "dispatch") dispatchedAt = clock.ms;
        if (kind !== "run") return;
        const elapsed = clock.ms - dispatchedAt;
        const status = elapsed < 20 * 60_000 ? "queued"
          : elapsed < 45 * 60_000 ? "in_progress" : "completed";
        observedStatuses.add(status);
        return jsonResponse(privateRun({
          status,
          conclusion: status === "completed" ? "success" : null,
        }));
      },
    }, async ({ clock, run }) => {
      const proof = await run();
      assert.equal(proof.releaseScope, releaseScope);
      assert.deepEqual([...observedStatuses], ["queued", "in_progress", "completed"]);
      assert.equal(clock.ms - dispatchedAt, 45 * 60_000);
      assert.ok(clock.ms < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS);
      assert.equal(clock.calls.filter(({ kind }) => kind === "jobs").length, 1);
      assert.equal(clock.calls.filter(({ kind }) => kind === "cancel" || kind === "force-cancel").length, 0);
    });
  });
}

for (const lateKind of ["run", "jobs", "public", "ancestry", "private"]) {
  test(`controller rejects ${lateKind} response bodies arriving at the credential boundary`, async () => {
    let deliveredLate = false;
    await withTimedController({
      releaseScope: HOSTED_RELEASE_SCOPE_PRODUCTION_CORE,
      respond: ({ kind, occurrence }, clock, response) => {
        // Exercise the optional protected-main ancestry read during finalization.
        if (kind === "public" && occurrence === 2) response = jsonResponse(publicMainRef(MOVED_PRIVATE_SHA));
        const finalRead = (kind !== "public" && kind !== "private") || occurrence === 2;
        if (kind === lateKind && finalRead) {
          const json = response.json.bind(response);
          response.json = async () => {
            const body = await json();
            clock.ms = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS;
            deliveredLate = true;
            return body;
          };
        }
        return response;
      },
    }, async ({ clock, run }) => {
      await assert.rejects(run);
      assert.equal(deliveredLate, true);
      assert.equal(clock.calls.at(-1).kind, lateKind);
      assert.ok(clock.calls.every(({ at }) => at < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS));
    });
  });
}

for (const releaseScope of [HOSTED_RELEASE_SCOPE_NONE, HOSTED_RELEASE_SCOPE_PRODUCTION_CORE]) {
  test(`controller finalizes a last-admitted ${releaseScope} success within the reserve`, async () => {
    const deadline = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS;
    let observedSuccessAt;
    await withTimedController({
      releaseScope,
      respond: ({ kind, occurrence }, clock) => {
        if (kind === "run") {
          if (clock.ms < deadline - 15_000) {
            return jsonResponse(privateRun({ status: "in_progress", conclusion: null }));
          }
          // A final status read takes just under its remaining 15-second budget.
          clock.ms = deadline - 1;
          observedSuccessAt = clock.ms;
        } else {
          clock.ms += 30_000;
        }
        if (releaseScope !== HOSTED_RELEASE_SCOPE_NONE && kind === "public" && occurrence === 2) {
          return jsonResponse(publicMainRef(MOVED_PRIVATE_SHA));
        }
      },
    }, async ({ clock, run }) => {
      const proof = await run();
      assert.equal(proof.releaseScope, releaseScope);
      assert.equal(observedSuccessAt, deadline - 1);
      const finalReads = clock.calls.filter(({ at }) => at >= observedSuccessAt);
      assert.deepEqual(finalReads.map(({ kind }) => kind), releaseScope === HOSTED_RELEASE_SCOPE_NONE
        ? ["jobs", "public", "private"] : ["jobs", "public", "ancestry", "private"]);
      assert.equal(clock.ms, observedSuccessAt + finalReads.length * 30_000);
      assert.ok(clock.ms < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS);
    });
  });
}

for (const releaseScope of [HOSTED_RELEASE_SCOPE_FOREGROUND, HOSTED_RELEASE_SCOPE_PRODUCTION_CORE]) {
  for (const advanceAt of [0, 1, 2]) {
    test(`deployment controller preserves ${releaseScope} candidate when main advances at read ${advanceAt}`, async () => {
      let privateMainReads = 0;
      let publicMainReads = 0;
      await withCompatibilityEnv(async () => withFetch(async (url, init = {}) => {
        if (
          url.includes(`/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/`)
          && url.endsWith(`/git/ref/heads/${TEMPORAL_COMPATIBILITY_PRIVATE_BRANCH}`)
        ) {
          privateMainReads += 1;
          return jsonResponse(privateMainRef());
        }
        if (url.endsWith("/repos/cobuildwithus/murph/git/ref/heads/main")) {
          publicMainReads += 1;
          return jsonResponse(publicMainRef(advanceAt && publicMainReads >= advanceAt
            ? "e".repeat(40) : PUBLIC_SHA));
        }
        if (url.includes(`/compare/${PUBLIC_SHA}...${"e".repeat(40)}`)) {
          return jsonResponse({ status: "ahead", base_commit: { sha: PUBLIC_SHA },
            merge_base_commit: { sha: PUBLIC_SHA } });
        }
        if (url.includes("/actions/workflows/") && !url.endsWith("/dispatches")) {
          return jsonResponse({
            id: WORKFLOW_ID,
            name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
            path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH,
            state: "active",
          });
        }
        if (url.endsWith("/dispatches")) {
          assert.deepEqual(JSON.parse(init.body), {
            inputs: buildDispatchInputs({
              expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
              releaseScope,
              mode: HOSTED_RELEASE_ADMISSION_MODE,
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
        if (url.endsWith(`/actions/runs/${RUN_ID}`)) return jsonResponse(privateRun());
        if (url.includes(`/actions/runs/${RUN_ID}/jobs`)) {
          return jsonResponse({
            jobs: proofJobs({ releaseScope }),
            total_count: releaseScope === HOSTED_RELEASE_SCOPE_PRODUCTION_CORE ? 10 : 5,
          });
        }
        throw new Error(`unexpected URL ${url}`);
      }, async () => {
        const proof = await runTemporalCompatibility(compatibilityArgs({
          dispatchMode: HOSTED_RELEASE_ADMISSION_MODE,
          expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
          releaseScope,
          prNumber: null,
          sleepFn: async () => undefined,
        }));
        assert.equal(proof.readerCount, 3);
        assert.equal(publicMainReads, 2);
        assert.equal(privateMainReads, 2);
      }));
    });
  }
}

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

for (const settles of [true, false]) {
  test(`controller exhausts the shared budget and ${settles ? "settles" : "fails closed on"} its exact run`, async () => {
    const deadline = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS;
    let forceCancelFinishedAt;
    await withTimedController({
      respond: ({ kind, timeoutMs }, clock) => {
        if (kind === "cancel" || kind === "force-cancel") clock.ms += 30_000;
        if (kind === "force-cancel") forceCancelFinishedAt = clock.ms;
        if (kind === "run") {
          // Use the full request allowance without delivering a response at or
          // after its abort boundary; sleeps consume the rest of each wait.
          clock.ms += timeoutMs - 1;
          const complete = settles && forceCancelFinishedAt !== undefined
            && clock.ms >= forceCancelFinishedAt + 2 * 60_000 - 15_000;
          return jsonResponse(privateRun({
            status: complete ? "completed" : "in_progress",
            conclusion: complete ? "cancelled" : null,
          }));
        }
      },
    }, async ({ clock, run }) => {
      await assert.rejects(run, (error) => {
        assert.equal(error instanceof AggregateError, !settles);
        if (settles) assert.match(error.message, /run timed out/u);
        else assert.match(error.message, /could not be proven terminal/u);
        return true;
      });
      const cancellation = clock.calls.filter(({ kind }) => kind === "cancel" || kind === "force-cancel");
      assert.deepEqual(cancellation.map(({ kind, at }) => [kind, at]), [
        ["cancel", deadline], ["force-cancel", deadline + 30_000 + 2 * 60_000],
      ]);
      assert.ok(cancellation.every(({ url }) => url.includes(`/actions/runs/${RUN_ID}/`)));
      assert.ok(clock.ms <= deadline + 2 * 30_000 + 2 * 2 * 60_000);
      assert.ok(clock.ms < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS);
      assert.equal(clock.calls.filter(({ kind }) => kind === "jobs").length, 0);
    });
  });
}

for (const failure of ["failed run", "failed proof job", "malformed attestation", "incomplete jobs", "changed public head"]) {
  test(`controller still rejects ${failure} after the old timeout ceiling`, async () => {
    await withTimedController({
      respond: async ({ kind, occurrence }, clock, response) => {
        if (kind === "run") {
          if (clock.ms < 45 * 60_000) {
            return jsonResponse(privateRun({ status: "in_progress", conclusion: null }));
          }
          if (failure === "failed run") return jsonResponse(privateRun({ conclusion: "failure" }));
        }
        if (kind === "jobs") {
          const page = await response.json();
          if (failure === "failed proof job") page.jobs[0].conclusion = "failure";
          if (failure === "malformed attestation") page.jobs[3].name = "Temporal compatibility attestation [malformed]";
          if (failure === "incomplete jobs") page.total_count += 1;
          return jsonResponse(page);
        }
        if (kind === "public" && occurrence === 2 && failure === "changed public head") {
          return jsonResponse(pullRequest({
            head: { repo: { full_name: "cobuildwithus/murph" }, sha: MOVED_PRIVATE_SHA },
          }));
        }
      },
    }, async ({ clock, run }) => {
      await assert.rejects(run, (error) => !(error instanceof AggregateError));
      assert.equal(clock.ms, 45 * 60_000);
      // The exact run is already terminal; do not cancel it or dispatch another.
      assert.deepEqual(clock.calls.filter(({ method }) => method === "POST").map(({ kind }) => kind), ["dispatch"]);
    });
  });
}

for (const ordinaryCancelStatus of [202, 503]) {
  test(`controller clips late cancellation and settlement after cancel HTTP ${ordinaryCancelStatus}`, async () => {
    let settling = false;
    await withTimedController({
      respond: ({ kind, timeoutMs }, clock) => {
        if (kind === "cancel") {
          assert.equal(timeoutMs, 10_000);
          settling = true;
          return new Response(null, { status: ordinaryCancelStatus });
        }
        if (kind === "force-cancel") assert.equal(timeoutMs, 10_000);
        if (kind === "run") {
          if (!settling) {
            clock.ms = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - 10_000;
            return new Response(null, { status: 503 });
          }
          assert.equal(timeoutMs, 10_000);
          clock.ms += 9_999;
          return jsonResponse(privateRun({ conclusion: "cancelled" }));
        }
      },
    }, async ({ clock, run }) => {
      await assert.rejects(run, (error) => {
        assert.ok(!(error instanceof AggregateError));
        assert.match(error.message, /run lookup failed with HTTP 503/u);
        return true;
      });
      assert.equal(clock.ms, TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - 1);
      assert.deepEqual(clock.calls.filter(({ method }) => method === "POST").map(({ kind }) => kind),
        ordinaryCancelStatus === 202 ? ["dispatch", "cancel"] : ["dispatch", "cancel", "force-cancel"]);
    });
  });
}

for (const elapsed of [
  TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS - 30_000,
  TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS,
]) {
  test(`controller does not dispatch when preflight consumes ${elapsed}ms`, async () => {
    await withTimedController({
      respond: ({ kind }, clock) => {
        if (kind === "public") clock.ms = elapsed;
      },
    }, async ({ clock, run }) => {
      await assert.rejects(run);
      assert.deepEqual(clock.calls.map(({ kind }) => kind), ["private", "workflow", "public"]);
    });
  });
}

test("controller clips finalization HTTP to the remaining credential budget", async () => {
  await withTimedController({
    respond: ({ kind, occurrence, timeoutMs }, clock) => {
      if (kind === "jobs") clock.ms = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - 5_000;
      if (kind === "public" && occurrence === 2) {
        assert.equal(timeoutMs, 5_000);
        clock.ms += timeoutMs;
      }
    },
  }, async ({ clock, run }) => {
    await assert.rejects(run, /timing budget/u);
    assert.equal(clock.ms, TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS);
    assert.equal(clock.calls.at(-1).kind, "public");
  });
});

test("controller shares the usable deadline with initial exact-run visibility recovery", async () => {
  const deadline = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS - TEMPORAL_COMPATIBILITY_SETTLEMENT_RESERVE_MS;
  let cancelled = false;
  await withTimedController({
    respond: ({ kind }, clock) => {
      if (kind === "public") clock.ms = deadline - 30_001;
      if (kind === "dispatch") clock.ms += 30_000;
      if (kind === "cancel") cancelled = true;
      if (kind === "run" && !cancelled) return new Response(null, { status: 404 });
    },
  }, async ({ clock, run }) => {
    await assert.rejects(run, (error) => !(error instanceof AggregateError));
    assert.deepEqual(clock.calls.filter(({ kind }) => kind === "run" || kind === "cancel")
      .map(({ kind, at, timeoutMs }) => [kind, at, timeoutMs]), [
      ["run", deadline - 1, 1], ["cancel", deadline, 30_000], ["run", deadline, 30_000],
    ]);
  });
});

for (const lateKind of ["cancel", "force-cancel", "settlement"]) {
  test(`controller cannot extend the credential boundary during ${lateKind}`, async () => {
    let cancelling = false;
    let forceCancelled = false;
    await withTimedController({
      respond: ({ kind, timeoutMs }, clock) => {
        if (kind === "cancel") cancelling = true;
        if (kind === "force-cancel") forceCancelled = true;
        if (kind === lateKind) clock.ms = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS;
        if (kind === "run") {
          if (!cancelling) return new Response(null, { status: 503 });
          if (lateKind === "settlement") {
            clock.ms = TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS;
            return jsonResponse(privateRun({ conclusion: "cancelled" }));
          }
          if (!forceCancelled) clock.ms += timeoutMs - 1;
          return jsonResponse(privateRun({ status: "in_progress", conclusion: null }));
        }
      },
    }, async ({ clock, run }) => {
      await assert.rejects(run, AggregateError);
      assert.equal(clock.calls.at(-1).kind, lateKind === "settlement" ? "run" : lateKind);
      assert.ok(clock.calls.every(({ at }) => at < TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS));
    });
  });
}

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
      // Deliver the terminal response just inside the two-minute wait.
      if (forceCancellationSettled) nowMs -= 1;
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
    assert.equal(nowMs, 5 * 60_000 - 1);
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

test("Web production admission runs only for exact public main", async () => {
  const workflow = await readFile(
    path.join(
      REPO_ROOT,
      ".github",
      "workflows",
      "temporal-web-deployment-admission.yml",
    ),
    "utf8",
  );
  const admissionJob = workflow.slice(workflow.indexOf("jobs:\n  admission:"));
  const checkoutIndex = admissionJob.indexOf("name: Check out exact public main revision");
  const setupIndex = admissionJob.indexOf("name: Setup Node");
  const fixtureIndex = admissionJob.indexOf("name: Execute exact production wire projection");
  const tokenIndex = admissionJob.indexOf("name: Mint private compatibility token");
  const proofIndex = admissionJob.indexOf(
    "name: Prove exact public main against private Temporal and hosted runtime",
  );

  assert.match(workflow, /on:\n  push:\n    branches:\n      - main/u);
  assert.match(workflow, /name: Temporal Web production admission/u);
  assert.match(workflow, /environment: temporal-compatibility/u);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /hosted-orchestration-compatibility\.mjs run-main/u);
  assert.match(
    workflow,
    /TEMPORAL_PRODUCTION_TARGET_DIGEST: \$\{\{ vars\.TEMPORAL_PRODUCTION_TARGET_DIGEST \}\}/u,
  );
  assert.match(workflow, /--sha "\$\{GITHUB_SHA\}"/u);
  assert.match(workflow, /permission-actions: write/u);
  assert.match(workflow, /repositories: murph-cloud/u);
  const timeoutMinutes = Number(/timeout-minutes: (\d+)/u.exec(admissionJob)?.[1]);
  assert.ok(Number.isSafeInteger(timeoutMinutes));
  assert.ok(
    timeoutMinutes * 60_000
      > 15 * 60_000 + TEMPORAL_COMPATIBILITY_TOKEN_BUDGET_MS,
  );
  assert.doesNotMatch(workflow, /pull_request:/u);
  assert.doesNotMatch(admissionJob, /\n    needs:/u);
  assert.doesNotMatch(workflow, /\n  producer:|upload-artifact|download-artifact/u);
  assert.ok(checkoutIndex >= 0);
  assert.ok(setupIndex > checkoutIndex);
  assert.ok(fixtureIndex > setupIndex);
  assert.ok(tokenIndex > fixtureIndex);
  assert.ok(proofIndex > tokenIndex);
  assert.match(
    admissionJob,
    /--output "\$\{RUNNER_TEMP\}\/temporal-compatibility-producer-fixtures\.json"/u,
  );
  assert.match(
    admissionJob,
    /--fixtures "\$\{RUNNER_TEMP\}\/temporal-compatibility-producer-fixtures\.json"/u,
  );
});

test("Repo Hygiene owns the focused controller contract test", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "repo-hygiene.yml"),
    "utf8",
  );
  assert.match(workflow, /node --test scripts\/hosted-orchestration-compatibility\.test\.mjs/u);
});

// Fake only HTTP and time; all admission, polling, proof and settlement run in
// the real controller. Record the actual AbortSignal timeout of every request.
async function withTimedController({
  releaseScope = HOSTED_RELEASE_SCOPE_NONE,
  respond = () => undefined,
}, fn) {
  const clock = { ms: 0, calls: [] };
  const timeouts = new WeakMap();
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    const signal = originalTimeout(ms);
    timeouts.set(signal, ms);
    return signal;
  };
  try {
    await withFetch(async (url, init) => {
      let kind;
      let response;
      if (url.includes(`/repos/${TEMPORAL_COMPATIBILITY_PRIVATE_REPOSITORY}/git/ref/`)) {
        kind = "private";
        response = jsonResponse(privateMainRef());
      } else if (url.endsWith("/pulls/42") || url.endsWith("/git/ref/heads/main")) {
        kind = "public";
        response = jsonResponse(url.endsWith("/pulls/42") ? pullRequest() : publicMainRef());
      } else if (url.includes("/compare/")) {
        kind = "ancestry";
        response = jsonResponse({ status: "ahead", base_commit: { sha: PUBLIC_SHA },
          merge_base_commit: { sha: PUBLIC_SHA } });
      } else if (url.endsWith("/dispatches")) {
        kind = "dispatch";
        response = jsonResponse({ workflow_run_id: RUN_ID });
      } else if (url.includes("/actions/workflows/")) {
        kind = "workflow";
        response = jsonResponse({ id: WORKFLOW_ID, name: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_NAME,
          path: TEMPORAL_COMPATIBILITY_PRIVATE_WORKFLOW_PATH, state: "active" });
      } else if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
        kind = "run";
        response = jsonResponse(privateRun());
      } else if (url.includes(`/actions/runs/${RUN_ID}/jobs?`)) {
        kind = "jobs";
        const jobs = proofJobs({ releaseScope });
        response = jsonResponse({ jobs, total_count: jobs.length });
      } else if (url.endsWith(`/actions/runs/${RUN_ID}/cancel`)
        || url.endsWith(`/actions/runs/${RUN_ID}/force-cancel`)) {
        kind = url.endsWith("/force-cancel") ? "force-cancel" : "cancel";
        response = new Response(null, { status: 202 });
      } else {
        throw new Error(`unexpected URL ${url}`);
      }
      const call = { kind, url, at: clock.ms, method: init.method ?? "GET",
        timeoutMs: timeouts.get(init.signal),
        occurrence: 1 + clock.calls.filter((entry) => entry.kind === kind).length };
      assert.ok(call.timeoutMs > 0 && call.timeoutMs <= 30_000);
      clock.calls.push(call);
      return await respond(call, clock, response) ?? response;
    }, () => fn({
      clock,
      run: (overrides = {}) => runTemporalCompatibility(compatibilityArgs({
        dispatchMode: releaseScope === HOSTED_RELEASE_SCOPE_NONE ? "temporal_compatibility" : HOSTED_RELEASE_ADMISSION_MODE,
        expectedTemporalTargetDigest: TEMPORAL_TARGET_DIGEST,
        releaseScope,
        prNumber: releaseScope === HOSTED_RELEASE_SCOPE_NONE ? 42 : null,
        now: () => clock.ms,
        sleepFn: async (ms) => { clock.ms += ms; },
        ...overrides,
      })),
    }));
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
}

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

test("deployment candidate ancestry rejects foreign, rewritten and malformed history", () => {
  const valid = { status: "ahead", base_commit: { sha: PUBLIC_SHA },
    merge_base_commit: { sha: PUBLIC_SHA } };
  inspectPublicCandidateAncestry(valid, PUBLIC_SHA);
  for (const invalid of [null, {}, { ...valid, status: "behind" },
    { ...valid, status: "diverged" }, { ...valid, status: "identical" },
    { ...valid, base_commit: { sha: "e".repeat(40) } },
    { ...valid, merge_base_commit: { sha: "e".repeat(40) } }]) {
    assert.throws(() => inspectPublicCandidateAncestry(invalid, PUBLIC_SHA), /protected branch history/u);
  }
});
