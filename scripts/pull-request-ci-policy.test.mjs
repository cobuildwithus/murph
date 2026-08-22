import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("expensive pull-request workflows are ready-only and fail closed for draft opens", async () => {
  for (const [name, jobs] of EXPENSIVE_WORKFLOWS) {
    inspectExpensiveWorkflow(await workflow(name), name, jobs);
  }
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
  assert.match(source, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
  assert.doesNotMatch(source, /actions\/checkout|pull_request_target|permissions:\n/u);
});

function inspectDraftReset(source) {
  assert.match(source, /^  workflow_run:\n    workflows: \["Pull Request Head Change"\]\n    types: \[completed\]$/mu);
  assert.match(source, /^permissions:\n  pull-requests: write$/mu);
  assert.doesNotMatch(source, /contents: write|actions\/checkout|pull_request_target/u);
  assert.match(source, /EXPECTED_HEAD_SHA: \$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.head\.sha \}\}/u);
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

test("repository-created pull requests remain draft-first", async () => {
  const frog = await readFile(path.join(REPO_ROOT, "scripts", "frog-autofix.ts"), "utf8");
  const createCalls = [...frog.matchAll(/"pr",\n\s+"create",(?<args>[\s\S]*?)\n\s+\],/gu)];
  assert.ok(createCalls.length >= 2, "expected both repository-owned Frog PR creation paths");
  for (const call of createCalls) assert.match(call.groups.args, /"--draft"/u);
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
