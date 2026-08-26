import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_ROOT = path.join(REPO_ROOT, ".github", "workflows");
const EXPENSIVE_WORKFLOWS = new Map([
  ["cloudflare-runner-permission-sandbox.yml", ["runner-permission-sandbox"]],
  ["foreground-reply-state-cardinality.yml", ["bounded-work"]],
  ["host-support.yml", [
    "cli-host-matrix",
    "release-build-typecheck-linux",
    "release-package-coverage-linux",
    "release-app-verification-linux",
    "production-runner-bundle-budget-linux",
    "release-fixture-coverage-linux",
    "release-checks-linux",
  ]],
  ["hosted-stripe-billing.yml", ["billing-hermetic", "billing-required"]],
  ["repo-hygiene.yml", ["tracked-artifacts"]],
  ["web-viewport-overflow.yml", ["viewport-overflow"]],
]);
const READY_ONLY_TYPES = ["opened", "reopened", "ready_for_review"];
const MARKDOWN_SCOPE_JOB = "markdown-docs-scope";
const FULL_VERIFICATION_CONDITION = "if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.markdown-docs-scope.outputs.markdown_only != 'true') }}";
const NONCANCELABLE_FULL_VERIFICATION_CONDITION = "if: ${{ always() && (github.event_name != 'pull_request' || needs.markdown-docs-scope.outputs.markdown_only != 'true') }}";
const FULL_STEP_CONDITION = "if: ${{ github.event_name != 'pull_request' || needs.markdown-docs-scope.outputs.markdown_only != 'true' }}";
const CANCELABLE_MARKDOWN_WORKFLOWS = [
  "foreground-reply-state-cardinality.yml",
  "host-support.yml",
  "repo-hygiene.yml",
  "web-viewport-overflow.yml",
];
const REQUIRED_OWNER_JOBS = new Map([
  ["host-support.yml", "release-checks-linux"],
  ["hosted-stripe-billing.yml", "billing-required"],
  ["repo-hygiene.yml", "tracked-artifacts"],
  ["foreground-reply-state-cardinality.yml", "bounded-work"],
  ["web-viewport-overflow.yml", "viewport-overflow"],
]);
const DRAFT_GUARD = [
  "      - name: Reject draft pull request proof",
  "        if: ${{ github.event_name == 'pull_request' && github.event.pull_request.draft }}",
  "        run: |",
  "          echo \"::error::Mark the pull request ready for review to run exact-head CI.\"",
  "          exit 1",
].join("\n");

async function workflow(name) {
  return readFile(path.join(WORKFLOW_ROOT, name), "utf8");
}

function eventBlock(source, eventName) {
  const start = source.indexOf(`  ${eventName}:\n`);
  assert.ok(start >= 0, `${eventName} trigger must exist`);
  const rest = source.slice(start + `  ${eventName}:\n`.length);
  const next = rest.search(/^  [a-zA-Z_][a-zA-Z0-9_-]*:/mu);
  return next < 0 ? rest : rest.slice(0, next);
}

function triggerTypes(source) {
  const block = eventBlock(source, "pull_request");
  const match = block.match(/^    types: \[([^\]]+)\]$/mu);
  assert.ok(match, "pull_request must declare explicit event types");
  return match[1].split(",").map((value) => value.trim());
}

function jobBlock(source, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = source.indexOf(marker, source.indexOf("\njobs:\n"));
  assert.ok(start >= 0, `${jobName} job must exist`);
  const rest = source.slice(start + marker.length);
  const next = rest.search(/^  [a-zA-Z0-9_-]+:/mu);
  return next < 0 ? rest : rest.slice(0, next);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function inspectExpensiveWorkflow(source, name, jobs) {
  assert.deepEqual(triggerTypes(source), READY_ONLY_TYPES, `${name} must be ready-only`);
  assert.doesNotMatch(eventBlock(source, "pull_request"), /\bsynchronize\b/u, `${name} must not run on synchronize`);
  assert.match(source, /^  push:\n    branches:\n      - main$/mu, `${name} must preserve main push CI`);
  assert.doesNotMatch(source, /^  pull_request_target:/mu, `${name} must keep the no-secret PR boundary`);
  for (const jobName of jobs) {
    const job = jobBlock(source, jobName);
    const steps = job.indexOf("    steps:\n");
    assert.ok(steps >= 0, `${name}:${jobName} must own steps`);
    assert.equal(
      job.slice(steps + "    steps:\n".length).startsWith(`${DRAFT_GUARD}\n`),
      true,
      `${name}:${jobName} must fail draft opened/reopened proof before expensive work`,
    );
    assert.doesNotMatch(
      job.slice(0, steps),
      /github\.event\.pull_request\.draft/u,
      `${name}:${jobName} must not publish a skipped required-check success for draft proof`,
    );
  }
}

function inspectTrustedMarkdownScope(source, name) {
  assert.doesNotMatch(eventBlock(source, "pull_request"), /^    paths(?:-ignore)?:/mu, `${name} must not use event path filters`);
  const classifier = jobBlock(source, MARKDOWN_SCOPE_JOB);
  assert.match(classifier, /^    name: Classify [^\n]+ documentation scope$/mu);
  assert.match(classifier, /^    if: \$\{\{ github\.event_name == 'pull_request' \}\}$/mu);
  assert.match(classifier, /^    permissions:\n      contents: read\n      pull-requests: read$/mu, `${name} classifier needs only read authority`);
  assert.match(classifier, /^      markdown_only: \$\{\{ steps\.scope-result\.outputs\.markdown_only \}\}$/mu);
  assert.match(classifier, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(classifier, /sparse-checkout: scripts\/ci-markdown-docs-scope\.mjs/u);
  assert.match(classifier, /sparse-checkout-cone-mode: false/u);
  assert.match(classifier, /test "\$\(git rev-parse HEAD\)" = "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(classifier, /node scripts\/ci-markdown-docs-scope\.mjs/u);
  assert.match(classifier, /CHECKOUT_OUTCOME: \$\{\{ steps\.checkout-base\.outcome \}\}/u);
  assert.match(classifier, /CLASSIFIER_OUTCOME: \$\{\{ steps\.classify\.outcome \}\}/u);
  assert.match(classifier, /CLASSIFIER_MARKDOWN_ONLY: \$\{\{ steps\.classify\.outputs\.markdown_only \}\}/u);
  assert.match(classifier, /if \[\[ "\$CHECKOUT_OUTCOME" == "success" && "\$CLASSIFIER_OUTCOME" == "success" && "\$CLASSIFIER_MARKDOWN_ONLY" == "true" \]\]/u);
  assert.doesNotMatch(classifier, /pull_request\.head\.sha|refs\/pull|pnpm install|setup-node/u, `${name} classifier must not check out or execute candidate code`);

  const requiredOwner = jobBlock(source, REQUIRED_OWNER_JOBS.get(name));
  assert.match(requiredOwner, new RegExp(`^    needs:(?: ${MARKDOWN_SCOPE_JOB}|\\n      - ${MARKDOWN_SCOPE_JOB})$`, "mu"));
  assert.match(requiredOwner, /exact-inventory Markdown documentation proof/u);
}

function inspectCancellationAwareJobs(source, name) {
  assert.match(source, /^  cancel-in-progress: true$/mu, `${name} must cancel superseded runs`);
  for (const jobName of workflowJobNames(source)) {
    const job = jobBlock(source, jobName);
    const steps = job.indexOf("    steps:\n");
    assert.ok(steps >= 0, `${name}:${jobName} must own steps`);
    assert.doesNotMatch(
      job.slice(0, steps),
      /^    if: .*\balways\(\)/mu,
      `${name}:${jobName} must not survive cancellation through always()`,
    );
  }
}

test("expensive pull-request workflows are ready-only and fail closed for draft opens", async () => {
  for (const [name, jobs] of EXPENSIVE_WORKFLOWS) {
    inspectExpensiveWorkflow(await workflow(name), name, jobs);
  }
});

test("each required owner uses an exact-base trusted Markdown classifier", async () => {
  const classifierNames = [];
  for (const name of REQUIRED_OWNER_JOBS.keys()) {
    const source = await workflow(name);
    inspectTrustedMarkdownScope(source, name);
    classifierNames.push(jobBlock(source, MARKDOWN_SCOPE_JOB).match(/^    name: ([^\n]+)$/mu)?.[1]);
  }
  assert.equal(new Set(classifierNames).size, classifierNames.length, "classifier checks must not share duplicate display names");
});

test("cancelable Markdown workflows release superseded jobs", async () => {
  for (const name of CANCELABLE_MARKDOWN_WORKFLOWS) {
    inspectCancellationAwareJobs(await workflow(name), name);
  }

  const host = await workflow("host-support.yml");
  assert.throws(
    () => inspectCancellationAwareJobs(
      host.replace("if: ${{ !cancelled() }}", "if: ${{ always() }}"),
      "host-support.yml",
    ),
    /must not survive cancellation/u,
  );
});

test("runtime-heavy jobs skip only an affirmative trusted Markdown result", async () => {
  const host = await workflow("host-support.yml");
  for (const jobName of [
    "release-build-typecheck-linux",
    "release-package-coverage-linux",
    "release-app-verification-linux",
    "production-runner-bundle-budget-linux",
    "release-fixture-coverage-linux",
  ]) {
    assert.match(jobBlock(host, jobName), new RegExp(`^    ${escapeRegExp(FULL_VERIFICATION_CONDITION)}$`, "mu"));
  }

  const cliHostMatrix = jobBlock(host, "cli-host-matrix");
  assert.match(cliHostMatrix, /^    if: \$\{\{ !cancelled\(\) \}\}$/mu);
  assert.match(
    cliHostMatrix,
    /CLI host matrix \(\$\{\{ matrix\.os \}\}\) satisfied by exact-inventory Markdown documentation proof/u,
  );
  assert.match(
    cliHostMatrix,
    new RegExp(`- uses: actions/checkout@[^\\n]+\\n        ${escapeRegExp(FULL_STEP_CONDITION)}$`, "mu"),
  );
  for (const stepName of [
    "Setup pnpm",
    "Setup Node",
    "Install deps",
    "Build workspace",
    "Prepare built CLI runtime artifacts",
    "Run cross-platform CLI coverage",
  ]) {
    assert.match(
      cliHostMatrix,
      new RegExp(`- name: ${escapeRegExp(stepName)}\\n        ${escapeRegExp(FULL_STEP_CONDITION)}$`, "mu"),
      `CLI host matrix ${stepName} must stay on the full verification path`,
    );
  }

  const billing = await workflow("hosted-stripe-billing.yml");
  assert.match(
    jobBlock(billing, "billing-hermetic"),
    new RegExp(`^    ${escapeRegExp(NONCANCELABLE_FULL_VERIFICATION_CONDITION)}$`, "mu"),
  );

  const repoHygiene = await workflow("repo-hygiene.yml");
  assert.match(jobBlock(repoHygiene, "temporal-compatibility-producer"), /needs\.markdown-docs-scope\.outputs\.markdown_only != 'true'/u);
  for (const [name, heavyNeedle] of [
    ["repo-hygiene.yml", "pnpm install --frozen-lockfile"],
    ["foreground-reply-state-cardinality.yml", "pnpm install --frozen-lockfile"],
    ["web-viewport-overflow.yml", "scripts/install-playwright-chromium.sh"],
  ]) {
    const source = await workflow(name);
    const owner = jobBlock(source, REQUIRED_OWNER_JOBS.get(name));
    const heavyIndex = owner.indexOf(heavyNeedle);
    assert.ok(heavyIndex >= 0, `${name} heavy step must remain present`);
    assert.match(
      owner.slice(
        Math.max(0, heavyIndex - 300),
        heavyIndex + heavyNeedle.length + 300,
      ),
      /if: \$\{\{ github\.event_name != 'pull_request' \|\| needs\.markdown-docs-scope\.outputs\.markdown_only != 'true' \}\}/u,
      `${name} heavy step must retain full main-push and fail-closed PR admission`,
    );
  }
});

test("Host Support runs one exact merge-candidate documentation proof", async () => {
  const source = await workflow("host-support.yml");
  const docsProof = jobBlock(source, "markdown-docs-proof");
  assert.match(docsProof, /^    name: Markdown documentation proof$/mu);
  assert.match(docsProof, /^    needs: markdown-docs-scope$/mu);
  assert.match(
    docsProof,
    /^    if: \$\{\{ !cancelled\(\) && github\.event_name == 'pull_request' && needs\.markdown-docs-scope\.result == 'success' && needs\.markdown-docs-scope\.outputs\.markdown_only == 'true' \}\}$/mu,
  );
  assert.match(docsProof, /^    permissions:\n      contents: read$/mu);
  assert.match(docsProof, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(docsProof, /persist-credentials: false/u);
  assert.match(docsProof, /EXPECTED_MERGE_SHA: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/u);
  assert.match(docsProof, /test "\$CANDIDATE_SHA" = "\$EXPECTED_MERGE_SHA"/u);
  assert.match(docsProof, /test "\$\(git rev-parse HEAD\)" = "\$CANDIDATE_SHA"/u);
  assert.match(docsProof, /git fetch --quiet --no-tags --no-write-fetch-head --depth=1 origin "\$BASE_SHA"/u);
  assert.match(docsProof, /git diff --check "\$BASE_SHA" "\$CANDIDATE_SHA" --/u);
  assert.match(docsProof, /pnpm install --frozen-lockfile/u);
  assert.match(docsProof, /MURPH_DOCS_DRIFT_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(docsProof, /MURPH_DOCS_DRIFT_CANDIDATE_SHA: \$\{\{ github\.sha \}\}/u);
  assert.doesNotMatch(docsProof, /pull_request\.head\.sha/u);
  assert.match(docsProof, /run: pnpm docs:drift/u);
  assert.match(docsProof, /run: pnpm docs:gardening/u);

  const releaseChecks = jobBlock(source, "release-checks-linux");
  assert.match(releaseChecks, /^      - markdown-docs-proof$/mu);
  assert.match(releaseChecks, /DOCS_RESULT: \$\{\{ needs\.markdown-docs-proof\.result \}\}/u);
});

test("documentation proof excludes base-only changes after the PR base moves", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "pr-docs-merge-candidate-proof-"));
  const runGit = (...args) => {
    const result = spawnSync("git", args, {
      cwd: tempDir,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    runGit("init", "--initial-branch=main");
    runGit("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
    runGit("config", "user.name", "github-actions[bot]");
    await writeFile(path.join(tempDir, "README.md"), "fixture\n");
    runGit("add", "README.md");
    runGit("commit", "-m", "initial");

    runGit("switch", "-c", "release-note");
    await mkdir(path.join(tempDir, "docs", "release-notes"), { recursive: true });
    const releaseNote = "docs/release-notes/2026-08-26-ci-fast-path.md";
    await writeFile(path.join(tempDir, releaseNote), "# CI fast path\n");
    runGit("add", releaseNote);
    runGit("commit", "-m", "add release note");
    const headSha = runGit("rev-parse", "HEAD");

    runGit("switch", "main");
    await mkdir(path.join(tempDir, "agent-docs", "operations"), { recursive: true });
    const baseOnlyDoc = "agent-docs/operations/base-only.md";
    await writeFile(path.join(tempDir, baseOnlyDoc), "# Base-only change\n");
    runGit("add", baseOnlyDoc);
    runGit("commit", "-m", "advance base");
    const baseSha = runGit("rev-parse", "HEAD");

    runGit("merge", "--no-ff", "release-note", "-m", "synthetic pull request merge");
    const mergeCandidateSha = runGit("rev-parse", "HEAD");
    const inventory = (candidateSha) => runGit(
      "diff",
      "--name-only",
      baseSha,
      candidateSha,
      "--",
    ).split("\n").filter(Boolean).sort();

    assert.deepEqual(inventory(headSha), [baseOnlyDoc, releaseNote]);
    assert.deepEqual(inventory(mergeCandidateSha), [releaseNote]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("trusted classifier drift fails closed into the full workflow", async () => {
  const name = "host-support.yml";
  const source = await workflow(name);
  for (const mutation of [
    source.replace(
      "ref: ${{ github.event.pull_request.base.sha }}",
      "ref: ${{ github.event.pull_request.head.sha }}",
    ),
    source.replace(
      'if [[ "$CHECKOUT_OUTCOME" == "success" && "$CLASSIFIER_OUTCOME" == "success" && "$CLASSIFIER_MARKDOWN_ONLY" == "true" ]]; then',
      'if [[ "$CLASSIFIER_MARKDOWN_ONLY" == "true" ]]; then',
    ),
    source.replace("node scripts/ci-markdown-docs-scope.mjs", "node scripts/untrusted-classifier.mjs"),
  ]) {
    assert.throws(() => inspectTrustedMarkdownScope(mutation, name));
  }
});

test("Release checks accepts exactly docs-proof or full-shard receipts", async () => {
  const source = await workflow("host-support.yml");
  const base = {
    APP_RESULT: "skipped",
    BUILD_RESULT: "skipped",
    BUNDLE_RESULT: "skipped",
    DOCS_RESULT: "success",
    EVENT_NAME: "pull_request",
    FIXTURE_RESULT: "skipped",
    MARKDOWN_ONLY: "true",
    PACKAGE_RESULT: "skipped",
    SCOPE_RESULT: "success",
  };
  assert.equal(runWorkflowStep(source, "Check release proof mode", base).status, 0);
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...base,
    APP_RESULT: "success",
  }).status, 1);
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...base,
    DOCS_RESULT: "failure",
  }).status, 1);

  const full = {
    ...base,
    APP_RESULT: "success",
    BUILD_RESULT: "success",
    BUNDLE_RESULT: "success",
    DOCS_RESULT: "skipped",
    FIXTURE_RESULT: "success",
    MARKDOWN_ONLY: "false",
    PACKAGE_RESULT: "success",
  };
  assert.equal(runWorkflowStep(source, "Check release proof mode", full).status, 0);
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...full,
    PACKAGE_RESULT: "skipped",
  }).status, 1);
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...full,
    DOCS_RESULT: "success",
  }).status, 1);
});

test("required Stripe boundary accepts docs-only skipped and full proof modes", async () => {
  const source = await workflow("hosted-stripe-billing.yml");
  const base = {
    EVENT_NAME: "pull_request",
    HERMETIC_RESULT: "skipped",
    LIVE_RESULT: "skipped",
    MARKDOWN_ONLY: "true",
    SCOPE_RESULT: "success",
  };
  assert.equal(runWorkflowStep(source, "Enforce hermetic proof and event-scoped live result", base).status, 0);
  assert.equal(runWorkflowStep(source, "Enforce hermetic proof and event-scoped live result", {
    ...base,
    HERMETIC_RESULT: "success",
  }).status, 1);

  assert.equal(runWorkflowStep(source, "Enforce hermetic proof and event-scoped live result", {
    ...base,
    HERMETIC_RESULT: "success",
    MARKDOWN_ONLY: "false",
  }).status, 0);
  assert.equal(runWorkflowStep(source, "Enforce hermetic proof and event-scoped live result", {
    ...base,
    EVENT_NAME: "push",
    HERMETIC_RESULT: "success",
    LIVE_RESULT: "success",
    MARKDOWN_ONLY: "",
    SCOPE_RESULT: "skipped",
  }).status, 0);
});

test("restoring synchronize to an expensive workflow is detected", async () => {
  const name = "repo-hygiene.yml";
  const source = await workflow(name);
  const mutation = source.replace(
    "types: [opened, reopened, ready_for_review]",
    "types: [opened, synchronize, reopened, ready_for_review]",
  );
  assert.throws(
    () => inspectExpensiveWorkflow(mutation, name, EXPENSIVE_WORKFLOWS.get(name)),
    /ready-only|synchronize/u,
  );
});

test("draft admission cannot be weakened into skip or success", async () => {
  const name = "repo-hygiene.yml";
  const source = await workflow(name);
  for (const mutation of [
    source.replace("          exit 1", "          exit 0"),
    source.replace(DRAFT_GUARD, ""),
    source.replace(
      "    steps:\n      - name: Reject draft pull request proof",
      "    if: ${{ !github.event.pull_request.draft }}\n    steps:\n      - name: Reject draft pull request proof",
    ),
  ]) {
    assert.throws(
      () => inspectExpensiveWorkflow(mutation, name, EXPENSIVE_WORKFLOWS.get(name)),
      /draft|skipped|required-check/u,
    );
  }
});

test("only documented lightweight PR workflows retain synchronize", async () => {
  const names = (await readdir(WORKFLOW_ROOT)).filter((name) => name.endsWith(".yml"));
  const pullRequestWorkflows = [];
  for (const name of names) {
    const source = await workflow(name);
    if (/^  pull_request:/mu.test(source)) pullRequestWorkflows.push(name);
  }
  assert.deepEqual(
    pullRequestWorkflows.sort(),
    [...EXPENSIVE_WORKFLOWS.keys(), "pr-evidence.yml", "pr-head-change.yml"].sort(),
  );
  assert.deepEqual(triggerTypes(await workflow("pr-evidence.yml")), ["opened", "synchronize", "reopened", "edited"]);
  assert.deepEqual(triggerTypes(await workflow("pr-head-change.yml")), ["synchronize"]);
});

test("synchronize observer is read-only and never checks out candidate code", async () => {
  const source = await workflow("pr-head-change.yml");
  assert.match(source, /^permissions: \{\}$/mu);
  assert.deepEqual(workflowJobNames(source), ["head-change"]);
  assert.match(source, /^    if: \$\{\{ github\.event\.pull_request\.draft == false \}\}$/mu);
  assert.match(source, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
  assert.doesNotMatch(source, /actions\/checkout|pull_request_target|permissions:\n/u);
});

function inspectDraftReset(source) {
  assert.match(source, /^  workflow_run:\n    workflows: \["Pull Request Head Change"\]\n    types: \[completed\]$/mu);
  assert.match(source, /^permissions: \{\}$/mu);
  assert.match(
    source,
    /^    environment:\n      name: frog-reconciliation\n      deployment: false$/mu,
  );
  assert.doesNotMatch(source, /actions\/checkout|pull_request_target/u);
  assert.doesNotMatch(jobBlock(source, "return-to-draft"), /^    permissions:/mu);
  const appTokenInputs =
    /^        uses: actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3\.2\.0\n        with:\n(?<inputs>(?:          [^\n]+\n)+)/mu
      .exec(source)?.groups?.inputs;
  assert.deepEqual(
    appTokenInputs?.trim().split("\n").map((line) => line.trim()),
    [
      "client-id: ${{ vars.FROG_APP_CLIENT_ID }}",
      "private-key: ${{ secrets.FROG_APP_PRIVATE_KEY }}",
      "permission-contents: write",
      "permission-pull-requests: write",
    ],
  );
  assert.deepEqual(
    source.match(/\$\{\{[^}]*\bsecrets\.[^}]*\}\}/gu),
    ["${{ secrets.FROG_APP_PRIVATE_KEY }}"],
  );
  assert.match(source, /GH_TOKEN: \$\{\{ steps\.frog-app-token\.outputs\.token \}\}/u);
  assert.doesNotMatch(source, /github\.token|secrets\.GITHUB_TOKEN/u);
  assert.match(
    source,
    /^    if: \$\{\{ github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.event == 'pull_request' \}\}$/mu,
  );
  assert.match(source, /EXPECTED_HEAD_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
  assert.match(source, /HEAD_BRANCH: \$\{\{ github\.event\.workflow_run\.head_branch \}\}/u);
  assert.match(source, /HEAD_REPOSITORY: \$\{\{ github\.event\.workflow_run\.head_repository\.full_name \}\}/u);
  assert.doesNotMatch(source, /workflow_run\.pull_requests\[0\]/u);
  assert.doesNotMatch(source, /commits\/\$\{EXPECTED_HEAD_SHA\}\/pulls/u);
  assert.match(source, /HEAD_OWNER="\$\{HEAD_REPOSITORY%%\/\*\}"/u);
  assert.match(source, /gh api --method GET --paginate --slurp/u);
  assert.match(source, /repos\/\$\{GITHUB_REPOSITORY\}\/pulls/u);
  assert.match(source, /-f state=open/u);
  assert.match(source, /-f head="\$\{HEAD_OWNER\}:\$\{HEAD_BRANCH\}"/u);
  assert.match(source, /candidate_count/u);
  assert.match(source, /candidate_count\}" != 1/u);
  assert.match(source, /\.base\.repo\.full_name == \$base_repository/u);
  assert.match(source, /\.head\.repo\.full_name == \$head_repository/u);
  assert.match(source, /\.head\.ref == \$head_branch/u);
  assert.match(source, /\.head\.sha == \$head_sha/u);
  assert.match(source, /\.state == "open"/u);
  assert.match(source, /current_head_sha="\$\(jq -r '\.head\.sha \/\/ empty'/u);
  assert.match(source, /if \[\[ "\$\{current_head_sha\}" != "\$\{EXPECTED_HEAD_SHA\}" \]\]; then/u);
  assert.match(source, /convertPullRequestToDraft/u);
  assert.match(source, /converted_draft.*isDraft/u);
  assert.match(source, /converted_draft\}" == true/u);
}

test("trusted controller resets only the exact synchronized head to draft", async () => {
  inspectDraftReset(await workflow("pr-head-draft-reset.yml"));
});

test("weakening exact-head draft reset is detected", async () => {
  const source = await workflow("pr-head-draft-reset.yml");
  const mutation = source.replace(
    'if [[ "${current_head_sha}" != "${EXPECTED_HEAD_SHA}" ]]; then',
    'if [[ -z "${current_head_sha}" ]]; then',
  );
  assert.throws(() => inspectDraftReset(mutation), /current_head_sha/u);
});

test("draft reset rejects workflow-token fallback and App authority drift", async () => {
  const source = await workflow("pr-head-draft-reset.yml");
  assert.throws(
    () => inspectDraftReset(source.replace(
      "GH_TOKEN: ${{ steps.frog-app-token.outputs.token }}",
      "GH_TOKEN: ${{ github.token }}",
    )),
    /github\.token/u,
  );
  assert.throws(
    () => inspectDraftReset(source.replace(
      "          permission-contents: write\n",
      "",
    )),
  );
  assert.throws(
    () => inspectDraftReset(source.replace(
      "          permission-pull-requests: write",
      "          permission-issues: write\n          permission-pull-requests: write",
    )),
  );
  assert.throws(
    () => inspectDraftReset(source.replace(
      "          HEAD_REPOSITORY: ${{ github.event.workflow_run.head_repository.full_name }}",
      "          HEAD_REPOSITORY: ${{ github.event.workflow_run.head_repository.full_name }}\n          UNRELATED_SECRET: ${{ secrets.OTHER_SECRET }}",
    )),
  );
});

test("draft reset executes only for an event-time ready receipt and current eligible PR", async () => {
  const currentReadyPullRequest = {
    draft: false,
    head: { sha: "a".repeat(40) },
    node_id: "PR_node",
    state: "open",
  };
  assert.equal(await runDraftResetScenario({
    currentPullRequest: currentReadyPullRequest,
    synchronizedWhileDraft: true,
  }), 0, "a delayed draft-time synchronize receipt must not undo a newer Ready action");
  assert.equal(await runDraftResetScenario({
    currentPullRequest: currentReadyPullRequest,
    synchronizedWhileDraft: false,
  }), 1, "a ready-time synchronize receipt must reset the same current head exactly once");

  for (const currentPullRequest of [
    {
      ...currentReadyPullRequest,
      head: { sha: "b".repeat(40) },
    },
    {
      ...currentReadyPullRequest,
      state: "closed",
    },
    {
      ...currentReadyPullRequest,
      draft: true,
    },
  ]) {
    assert.equal(await runDraftResetScenario({
      currentPullRequest,
      synchronizedWhileDraft: false,
    }), 0);
  }
  assert.equal(await runDraftResetScenario({
    confirmMutation: false,
    currentPullRequest: currentReadyPullRequest,
    synchronizedWhileDraft: false,
  }), 1, "an unconfirmed GraphQL mutation must fail after exactly one write attempt");
});

test("draft reset resolves fork-default, fork-feature, and same-repository heads without workflow-run PR associations", async () => {
  const currentReadyPullRequest = {
    draft: false,
    head: { sha: "a".repeat(40) },
    node_id: "PR_node",
    state: "open",
  };
  for (const { headBranch, headRepository } of [
    { headBranch: "feature", headRepository: "cobuildwithus/murph" },
    { headBranch: "feature", headRepository: "contributor/murph" },
    { headBranch: "main", headRepository: "contributor/murph" },
  ]) {
    assert.equal(await runDraftResetScenario({
      currentPullRequest: currentReadyPullRequest,
      headBranch,
      headRepository,
      synchronizedWhileDraft: false,
    }), 1, `${headRepository}:${headBranch} must resolve to exactly one draft conversion`);
  }
});

test("draft reset rejects missing, ambiguous, or mismatched head candidates before mutation", async () => {
  const sha = "a".repeat(40);
  const headRepository = "contributor/murph";
  const candidate = listedPullRequest({ headRepository, sha });
  const currentPullRequest = {
    draft: false,
    head: { sha },
    node_id: "PR_node",
    state: "open",
  };
  for (const listedPullRequests of [
    [],
    [candidate, { ...candidate, number: 43 }],
    [{ ...candidate, base: { repo: { full_name: "outside/repository" } } }],
    [{ ...candidate, head: { ...candidate.head, repo: { full_name: "outside/fork" } } }],
    [{ ...candidate, head: { ...candidate.head, ref: "other-branch" } }],
    [{ ...candidate, head: { ...candidate.head, sha: "b".repeat(40) } }],
    [{ ...candidate, state: "closed" }],
  ]) {
    assert.equal(await runDraftResetScenario({
      currentPullRequest,
      expectSuccess: false,
      headRepository,
      listedPullRequests,
      synchronizedWhileDraft: false,
    }), 0);
  }
});

test("operator docs preserve the ready-only exact-head lifecycle", async () => {
  const documents = await Promise.all([
    readFile(path.join(REPO_ROOT, "agent-docs", "operations", "verification-and-runtime.md"), "utf8"),
    readFile(path.join(REPO_ROOT, "agent-docs", "references", "testing-ci-map.md"), "utf8"),
  ]);
  for (const document of documents) {
    assert.match(document, /draft-first|start as drafts/u);
    assert.match(document, /ready_for_review|ready for review/u);
    assert.match(document, /synchronize[\s\S]{0,240}draft/u);
    assert.match(document, /exact head|exact-head/u);
    assert.match(document, /infrastructure-only|infrastructure failure/u);
    assert.match(document, /--failure-code xcodebuild_failed/u);
  }
});

function workflowJobNames(source) {
  const jobsStart = source.indexOf("\njobs:\n");
  assert.ok(jobsStart >= 0, "workflow jobs block must exist");
  return [...source.slice(jobsStart + "\njobs:\n".length).matchAll(/^  ([a-zA-Z0-9_-]+):$/gmu)]
    .map((match) => match[1]);
}

function extractWorkflowStepScript(source, stepName) {
  const stepStart = source.indexOf(`      - name: ${stepName}\n`);
  assert.ok(stepStart >= 0, `${stepName} step must exist`);
  const runMarker = "        run: |\n";
  const scriptStart = source.indexOf(runMarker, stepStart);
  assert.ok(scriptStart >= 0, `${stepName} script must exist`);
  const scriptLines = [];
  for (const line of source.slice(scriptStart + runMarker.length).split("\n")) {
    if (line.length === 0) {
      scriptLines.push("");
      continue;
    }
    if (!line.startsWith("          ")) break;
    scriptLines.push(line.slice(10));
  }
  assert.ok(scriptLines.length > 0, `${stepName} script must be readable`);
  return scriptLines.join("\n");
}

function runWorkflowStep(source, stepName, env) {
  return spawnSync("bash", ["-c", extractWorkflowStepScript(source, stepName)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

async function runDraftResetScenario({
  confirmMutation = true,
  currentPullRequest,
  expectSuccess = confirmMutation,
  headBranch = "feature",
  headRepository = "cobuildwithus/murph",
  listedPullRequests,
  synchronizedWhileDraft,
}) {
  const observer = await workflow("pr-head-change.yml");
  assert.deepEqual(workflowJobNames(observer), ["head-change"]);
  assert.match(observer, /^    if: \$\{\{ github\.event\.pull_request\.draft == false \}\}$/mu);
  const observerConclusion = synchronizedWhileDraft ? "skipped" : "success";

  const controller = await workflow("pr-head-draft-reset.yml");
  inspectDraftReset(controller);
  if (observerConclusion !== "success") return 0;

  const candidates = listedPullRequests ?? [listedPullRequest({
    headBranch,
    headRepository,
    sha: "a".repeat(40),
  })];

  const tempDir = await mkdtemp(path.join(tmpdir(), "pr-draft-reset-proof-"));
  const capturePath = path.join(tempDir, "graphql.calls");
  try {
    await writeFile(path.join(tempDir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == api ]]
case "$*" in
  *graphql*)
    printf '%s\n' mutation >> "\${GH_MUTATION_CAPTURE}"
    printf '%s\n' "\${GH_MUTATION_JSON}"
    ;;
  *repos/*/pulls/*)
    printf '%s\n' "\${GH_PR_JSON}"
    ;;
  *repos/*/pulls*)
    [[ "$*" == *"--method GET"* ]]
    [[ "$*" == *"state=open"* ]]
    [[ "$*" == *"head=\${GH_EXPECTED_HEAD_QUERY}"* ]]
    printf '%s\n' "\${GH_LISTED_PULLS_JSON}"
    ;;
  *)
    exit 2
    ;;
esac
`, { mode: 0o755 });
    const script = extractWorkflowStepScript(
      controller,
      "Convert the exact synchronized head to draft",
    );
    const result = spawnSync("bash", ["-c", script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        EXPECTED_HEAD_SHA: "a".repeat(40),
        GH_EXPECTED_HEAD_QUERY: `${headRepository.split("/", 1)[0]}:${headBranch}`,
        GH_LISTED_PULLS_JSON: JSON.stringify([candidates]),
        GH_MUTATION_CAPTURE: capturePath,
        GH_MUTATION_JSON: JSON.stringify({
          data: {
            convertPullRequestToDraft: {
              pullRequest: { id: "PR_node", isDraft: confirmMutation },
            },
          },
        }),
        GH_PR_JSON: JSON.stringify(currentPullRequest),
        GH_TOKEN: "synthetic-token",
        GITHUB_REPOSITORY: "cobuildwithus/murph",
        HEAD_BRANCH: headBranch,
        HEAD_REPOSITORY: headRepository,
        PATH: `${tempDir}:${process.env.PATH ?? ""}`,
      },
    });
    if (expectSuccess) {
      assert.equal(result.status, 0, result.stderr);
    } else {
      assert.notEqual(result.status, 0, "the controller must fail closed");
    }
    const capture = await readFile(capturePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    return capture.trim().length === 0 ? 0 : capture.trim().split("\n").length;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function listedPullRequest({
  headBranch = "feature",
  headRepository = "cobuildwithus/murph",
  sha = "a".repeat(40),
} = {}) {
  return {
    base: { repo: { full_name: "cobuildwithus/murph" } },
    head: {
      ref: headBranch,
      repo: { full_name: headRepository },
      sha,
    },
    number: 42,
    state: "open",
  };
}
