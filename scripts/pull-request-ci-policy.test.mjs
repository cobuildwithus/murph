import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
