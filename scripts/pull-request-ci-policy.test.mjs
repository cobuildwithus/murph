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
    "release-verification-plan-linux",
    "release-build-typecheck-linux",
    "release-package-coverage-linux",
    "release-web-build-linux",
    "release-web-tests-linux",
    "release-web-postgres-linux",
    "release-cloudflare-verification-linux",
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

function jobNeeds(job, jobName) {
  const inline = job.match(/^    needs: ([a-zA-Z0-9_-]+)$/mu);
  if (inline) {
    return [inline[1]];
  }

  const list = job.match(/^    needs:\n((?:      - [a-zA-Z0-9_-]+\n)+)/mu);
  assert.ok(list, `${jobName} must declare readable needs`);
  return [...list[1].matchAll(/^      - ([a-zA-Z0-9_-]+)$/gmu)]
    .map((match) => match[1]);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function assertExactCandidateCheckout(job, jobName) {
  assert.match(
    job,
    /uses: actions\/checkout@[^\n]+\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/u,
    `${jobName} must check out the exact event candidate without credentials`,
  );
}

function inspectHostSupportReleaseGraph(source) {
  const plan = jobBlock(source, "release-verification-plan-linux");
  assert.deepEqual(jobNeeds(plan, "release-verification-plan-linux"), [
    "markdown-docs-scope",
  ]);
  assert.match(
    plan,
    new RegExp(`^    ${escapeRegExp(FULL_VERIFICATION_CONDITION)}$`, "mu"),
  );
  assert.match(
    plan,
    /^      package_matrix: \$\{\{ steps\.verification_plan\.outputs\.package_matrix \}\}$/mu,
  );
  assert.match(
    plan,
    /^      hosted_web_test_matrix: \$\{\{ steps\.verification_plan\.outputs\.hosted_web_test_matrix \}\}$/mu,
  );
  assertExactCandidateCheckout(plan, "release-verification-plan-linux");
  assert.match(plan, /node-version-file: \.nvmrc/u);
  assert.match(
    plan,
    /node scripts\/release-verification-plan\.mjs --github-output "\$GITHUB_OUTPUT"/u,
  );
  assert.doesNotMatch(plan, /pnpm install/u, "the matrix plan must stay dependency-free");

  const build = jobBlock(source, "release-build-typecheck-linux");
  const packageCoverage = jobBlock(source, "release-package-coverage-linux");
  assert.deepEqual(jobNeeds(packageCoverage, "release-package-coverage-linux"), [
    "markdown-docs-scope",
    "release-verification-plan-linux",
  ]);
  assert.match(packageCoverage, /^      fail-fast: false$/mu);
  assert.match(
    packageCoverage,
    /^      matrix: \$\{\{ fromJSON\(needs\.release-verification-plan-linux\.outputs\.package_matrix\) \}\}$/mu,
  );
  assert.doesNotMatch(packageCoverage, /matrix\.packages/u);
  assertExactCandidateCheckout(packageCoverage, "release-package-coverage-linux");
  assert.match(packageCoverage, /run: pnpm install --frozen-lockfile/u);
  assert.match(packageCoverage, /run: pnpm health-commons:generate/u);
  assert.match(
    packageCoverage,
    /package_dirs="\$\(node scripts\/release-verification-plan\.mjs --package-dirs "\$\{\{ matrix\.shard \}\}"\)"/u,
  );
  assert.match(packageCoverage, /if \[\[ -z "\$package_dirs" \]\]/u);
  assert.match(
    packageCoverage,
    /if: \$\{\{ matrix\.shard == 'cli' \}\}\n        run: pnpm --dir packages\/cli exec tsx scripts\/verify-runtime-artifacts\.ts/u,
  );
  assert.equal(
    countOccurrences(packageCoverage, "if: ${{ matrix.shard == 'cli' }}"),
    1,
    "only the singleton CLI shard may run the package-shape proof",
  );
  assert.match(
    packageCoverage,
    /if: \$\{\{ matrix\.shard == 'cli' \|\| matrix\.shard == 'assistant-engine' \}\}\n        run: pnpm build:test-runtime:prepared/u,
  );
  assert.equal(
    countOccurrences(packageCoverage, "if: ${{ matrix.shard == 'cli' || matrix.shard == 'assistant-engine' }}"),
    1,
    "CLI and assistant-engine shards must prepare their built runtime artifacts",
  );
  assert.doesNotMatch(packageCoverage, /verify:package-boundary/u);

  for (const command of [
    "pnpm --dir packages/messaging-ingress verify:package-boundary:prepared",
    "pnpm --dir packages/inboxd verify:package-boundary:prepared",
    "pnpm --dir packages/hosted-local-harness verify:package-boundary:prepared",
  ]) {
    assert.equal(countOccurrences(source, command), 1, `${command} must have one owner`);
    assert.match(build, new RegExp(escapeRegExp(command), "u"));
  }

  const webBuild = jobBlock(source, "release-web-build-linux");
  const webTests = jobBlock(source, "release-web-tests-linux");
  const webPostgres = jobBlock(source, "release-web-postgres-linux");
  const cloudflare = jobBlock(source, "release-cloudflare-verification-linux");
  for (const [jobName, job] of [
    ["release-web-build-linux", webBuild],
    ["release-web-tests-linux", webTests],
    ["release-web-postgres-linux", webPostgres],
    ["release-cloudflare-verification-linux", cloudflare],
  ]) {
    assert.match(job, /^    runs-on: ubuntu-24\.04$/mu);
    assert.match(job, /^    timeout-minutes: 45$/mu);
    assertExactCandidateCheckout(job, jobName);
    assert.match(job, /run: pnpm install --frozen-lockfile/u);
  }

  assert.deepEqual(jobNeeds(webBuild, "release-web-build-linux"), [
    "markdown-docs-scope",
  ]);
  assert.match(webBuild, /^      MURPH_HOSTED_WEB_VERIFY_LANE: build$/mu);
  assert.doesNotMatch(webBuild, /MURPH_HOSTED_WEB_WEBPACK_CACHE/u);
  assert.match(webBuild, /^      MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK: "1"$/mu);
  assert.match(webBuild, /^      MURPH_VERIFY_STEP_PARALLEL: "1"$/mu);
  assert.match(webBuild, /^        run: pnpm --dir apps\/web verify$/mu);
  assert.doesNotMatch(webBuild, /services:\n/u);

  assert.deepEqual(jobNeeds(webTests, "release-web-tests-linux"), [
    "markdown-docs-scope",
    "release-verification-plan-linux",
  ]);
  assert.match(webTests, /^      fail-fast: false$/mu);
  assert.match(
    webTests,
    /^      matrix: \$\{\{ fromJSON\(needs\.release-verification-plan-linux\.outputs\.hosted_web_test_matrix\) \}\}$/mu,
  );
  assert.match(webTests, /^        image: postgres:17$/mu);
  assert.match(webTests, /^      MURPH_HOSTED_WEB_TEST_SHARD: \$\{\{ matrix\.shard \}\}$/mu);
  assert.match(webTests, /^      MURPH_HOSTED_WEB_VERIFY_LANE: test-shard$/mu);
  assert.match(webTests, /^      MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK: "1"$/mu);
  assert.match(
    webTests,
    /^      MURPH_SUPPLEMENT_SEARCH_TEST_DB_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/murph_search_test$/mu,
  );
  assert.match(
    webTests,
    /^      MURPH_CONSENT_TEST_DB_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/murph_consent_test$/mu,
  );
  assert.match(
    webTests,
    /^        run: DATABASE_URL="\$MURPH_CONSENT_TEST_DB_URL" pnpm --dir apps\/web exec prisma db push$/mu,
  );
  assert.match(webTests, /^        run: pnpm --dir apps\/web verify$/mu);

  assert.deepEqual(jobNeeds(webPostgres, "release-web-postgres-linux"), [
    "markdown-docs-scope",
  ]);
  assert.match(webPostgres, /^      fail-fast: false$/mu);
  assert.match(webPostgres, /^      max-parallel: 4$/mu);
  assert.match(webPostgres, /^      matrix:\n        shard: \[1, 2, 3, 4\]$/mu);
  assert.match(webPostgres, /^        image: postgres:17$/mu);
  assert.match(webPostgres, /^          POSTGRES_DB: murph_test_gate$/mu);
  assert.match(webPostgres, /--health-cmd "pg_isready -U postgres -d murph_test_gate"/u);
  assert.match(webPostgres, /^          - 5432:5432$/mu);
  assert.match(
    webPostgres,
    /^      DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/murph_test_gate$/mu,
  );
  const postgresCommands = [
    "pnpm --dir apps/web prisma:generate",
    "pnpm --dir apps/web prisma:migrate:deploy",
    "node scripts/run-postgres-tests.mjs --shard ${{ matrix.shard }}/4",
  ];
  let previousCommandIndex = webPostgres.indexOf("run: pnpm install --frozen-lockfile");
  for (const command of postgresCommands) {
    assert.match(webPostgres, new RegExp(`^        run: ${escapeRegExp(command)}$`, "mu"));
    const commandIndex = webPostgres.indexOf(`run: ${command}`);
    assert.ok(commandIndex > previousCommandIndex, "PostgreSQL proof must generate clients and apply migrations before execution");
    previousCommandIndex = commandIndex;
  }
  assert.doesNotMatch(webPostgres, /prisma db push|continue-on-error|secrets\./u);

  assert.deepEqual(jobNeeds(cloudflare, "release-cloudflare-verification-linux"), [
    "markdown-docs-scope",
  ]);
  assert.match(cloudflare, /^      MURPH_CLOUDFLARE_VERIFY_SKIP_TYPECHECK: "1"$/mu);
  assert.match(cloudflare, /^      MURPH_VERIFY_STEP_PARALLEL: "1"$/mu);
  assert.match(
    cloudflare,
    /^        run: pnpm --dir apps\/cloudflare verify:codex-upstream-source$/mu,
  );
  assert.match(cloudflare, /^        run: pnpm --dir apps\/cloudflare verify$/mu);
  assert.doesNotMatch(cloudflare, /services:\n/u);

  assert.equal(countOccurrences(source, "        run: pnpm --dir apps/web verify\n"), 2);
  assert.equal(countOccurrences(source, "        run: pnpm --dir apps/cloudflare verify\n"), 1);
  assert.doesNotMatch(source, /pnpm test:apps|MURPH_APP_VERIFY_PARALLEL/u);
  for (const jobName of workflowJobNames(source)) {
    const job = jobBlock(source, jobName);
    assert.equal(
      job.includes("pnpm --dir apps/web verify")
        && job.includes("pnpm --dir apps/cloudflare verify"),
      false,
      `${jobName} must not overlap Web and Cloudflare verification on one runner`,
    );
  }

  const releaseChecks = jobBlock(source, "release-checks-linux");
  assert.deepEqual(jobNeeds(releaseChecks, "release-checks-linux"), [
    "markdown-docs-scope",
    "release-verification-plan-linux",
    "markdown-docs-proof",
    "release-build-typecheck-linux",
    "release-package-coverage-linux",
    "release-web-build-linux",
    "release-web-tests-linux",
    "release-web-postgres-linux",
    "release-cloudflare-verification-linux",
    "release-fixture-coverage-linux",
    "production-runner-bundle-budget-linux",
  ]);
  assert.match(releaseChecks, /PLAN_RESULT: \$\{\{ needs\.release-verification-plan-linux\.result \}\}/u);
  assert.match(releaseChecks, /WEB_BUILD_RESULT: \$\{\{ needs\.release-web-build-linux\.result \}\}/u);
  assert.match(releaseChecks, /WEB_TEST_RESULT: \$\{\{ needs\.release-web-tests-linux\.result \}\}/u);
  assert.match(releaseChecks, /WEB_POSTGRES_RESULT: \$\{\{ needs\.release-web-postgres-linux\.result \}\}/u);
  assert.match(releaseChecks, /CLOUDFLARE_RESULT: \$\{\{ needs\.release-cloudflare-verification-linux\.result \}\}/u);
  for (const resultName of [
    "PLAN_RESULT",
    "BUILD_RESULT",
    "PACKAGE_RESULT",
    "WEB_BUILD_RESULT",
    "WEB_TEST_RESULT",
    "WEB_POSTGRES_RESULT",
    "CLOUDFLARE_RESULT",
    "FIXTURE_RESULT",
    "BUNDLE_RESULT",
  ]) {
    assert.ok(
      countOccurrences(releaseChecks, `"$${resultName}"`) >= 2,
      `${resultName} must be aggregated in docs and full modes`,
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
    "release-web-build-linux",
    "release-web-tests-linux",
    "release-web-postgres-linux",
    "release-cloudflare-verification-linux",
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

test("Host Support consumes one exhaustive plan and isolates app owners", async () => {
  const host = await workflow("host-support.yml");
  inspectHostSupportReleaseGraph(host);
});

function inspectForegroundPriorityGate(source) {
  const build = jobBlock(source, "release-build-typecheck-linux");
  const step = build.match(
    /      - name: Gate foreground priority across runtime transitions\n(?<body>(?:(?!      - (?:name|uses):)[\s\S])*)/u,
  )?.groups?.body;
  assert.ok(step, "The required build must run the foreground transition contract.");
  assert.doesNotMatch(step, /^        (?:if|continue-on-error):/mu,
    "The transition contract cannot be skipped or allowed to fail.");
  assert.match(step, /^        timeout-minutes: 5$/mu);
  assert.match(step,
    /run: >-\n          pnpm --dir packages\/assistant-runtime test\n          test\/hosted-runtime-promoted-foreground-priority\.test\.ts\n/u);
  assert.ok(build.indexOf("Gate foreground priority") < build.indexOf("name: Clean workspace build"),
    "Detect priority inversions before the broad build.");
}

test("required release proof rejects a missing or softened foreground transition gate", async () => {
  const host = await workflow("host-support.yml");
  inspectForegroundPriorityGate(host);
  for (const replacement of [
    "Removed foreground transition gate",
    "Gate foreground priority across runtime transitions\n        if: false",
    "Gate foreground priority across runtime transitions\n        continue-on-error: true",
  ]) {
    assert.throws(() => inspectForegroundPriorityGate(host.replace(
      "Gate foreground priority across runtime transitions", replacement,
    )));
  }
});

test("Host Support graph drift cannot skip, duplicate, overlap, or de-aggregate an owner", async () => {
  const host = await workflow("host-support.yml");
  const mutations = [
    host.replace(
      "if: ${{ matrix.shard == 'cli' || matrix.shard == 'assistant-engine' }}",
      "if: ${{ matrix.shard == 'cli' }}",
    ),
    host.replace(
      "run: pnpm build:test-runtime:prepared",
      "run: swapped-runtime-command",
    ).replace(
      "run: pnpm --dir packages/cli exec tsx scripts/verify-runtime-artifacts.ts",
      "run: pnpm build:test-runtime:prepared",
    ).replace(
      "run: swapped-runtime-command",
      "run: pnpm --dir packages/cli exec tsx scripts/verify-runtime-artifacts.ts",
    ),
    host.replace(
      "needs.release-verification-plan-linux.outputs.package_matrix",
      "needs.release-verification-plan-linux.outputs.hosted_web_test_matrix",
    ),
    host.replace(
      "      fail-fast: false\n      # The validated release plan",
      "      fail-fast: true\n      # The validated release plan",
    ),
    host.replace(
      "pnpm --dir packages/inboxd verify:package-boundary:prepared",
      "pnpm --dir packages/messaging-ingress verify:package-boundary:prepared",
    ),
    host.replace(
      "        run: pnpm --dir apps/cloudflare verify\n",
      "        run: pnpm --dir apps/web verify\n",
    ),
    host.replace(
      "      - name: Run hosted-Web build, lint, and smoke verification\n        run: pnpm --dir apps/web verify",
      "      - name: Run hosted-Web build, lint, and smoke verification\n        run: |\n          pnpm --dir apps/web verify\n          pnpm --dir apps/cloudflare verify",
    ),
    host.replace(
      "      MURPH_HOSTED_WEB_VERIFY_LANE: test-shard",
      "      MURPH_HOSTED_WEB_VERIFY_LANE: all",
    ),
    host.replace(
      "      fail-fast: false\n      matrix: ${{ fromJSON(needs.release-verification-plan-linux.outputs.hosted_web_test_matrix) }}",
      "      fail-fast: true\n      matrix: ${{ fromJSON(needs.release-verification-plan-linux.outputs.hosted_web_test_matrix) }}",
    ),
    host.replace("      MURPH_CONSENT_TEST_DB_URL:", "      UNUSED_CONSENT_TEST_DB_URL:"),
    host.replace('DATABASE_URL="$MURPH_CONSENT_TEST_DB_URL" pnpm --dir apps/web exec prisma db push', "echo skipped consent database"),
    host.replace("      - release-web-tests-linux\n", ""),
  ];

  for (const mutation of mutations) {
    assert.notEqual(mutation, host, "every graph mutation must alter the workflow fixture");
    assert.throws(() => inspectHostSupportReleaseGraph(mutation));
  }
});

test("Host Support rejects missing PostgreSQL proof or a disconnected result", async () => {
  const host = await workflow("host-support.yml");
  const postgresJob = jobBlock(host, "release-web-postgres-linux");
  for (const mutation of [
    host.replace(`  release-web-postgres-linux:\n${postgresJob}`, ""),
    host.replace("      - release-web-postgres-linux\n", ""),
    host.replace("needs.release-web-postgres-linux.result", "needs.release-web-tests-linux.result"),
    host.replaceAll(' "$WEB_POSTGRES_RESULT"', ""),
    host.replace("node scripts/run-postgres-tests.mjs --shard ${{ matrix.shard }}/4", "echo skipped PostgreSQL proof"),
    host.replace("pnpm --dir apps/web prisma:migrate:deploy", "pnpm --dir apps/web exec prisma db push"),
  ]) {
    assert.notEqual(mutation, host, "every PostgreSQL mutation must alter the workflow fixture");
    assert.throws(() => inspectHostSupportReleaseGraph(mutation));
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
  const releaseResultNames = [
    "PLAN_RESULT",
    "BUILD_RESULT",
    "PACKAGE_RESULT",
    "WEB_BUILD_RESULT",
    "WEB_TEST_RESULT",
    "WEB_POSTGRES_RESULT",
    "CLOUDFLARE_RESULT",
    "FIXTURE_RESULT",
    "BUNDLE_RESULT",
  ];
  const docsProof = {
    BUILD_RESULT: "skipped",
    BUNDLE_RESULT: "skipped",
    CLOUDFLARE_RESULT: "skipped",
    DOCS_RESULT: "success",
    EVENT_NAME: "pull_request",
    FIXTURE_RESULT: "skipped",
    MARKDOWN_ONLY: "true",
    PACKAGE_RESULT: "skipped",
    PLAN_RESULT: "skipped",
    SCOPE_RESULT: "success",
    WEB_BUILD_RESULT: "skipped",
    WEB_TEST_RESULT: "skipped",
    WEB_POSTGRES_RESULT: "skipped",
  };
  assert.equal(runWorkflowStep(source, "Check release proof mode", docsProof).status, 0);
  for (const resultName of releaseResultNames) {
    assert.equal(runWorkflowStep(source, "Check release proof mode", {
      ...docsProof,
      [resultName]: "success",
    }).status, 1, `docs mode must reject non-skipped ${resultName}`);
  }
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...docsProof,
    DOCS_RESULT: "failure",
  }).status, 1);
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...docsProof,
    PLAN_RESULT: "failure",
  }).status, 1);

  const full = Object.fromEntries(
    Object.entries(docsProof).map(([name, value]) => [
      name,
      releaseResultNames.includes(name) ? "success" : value,
    ]),
  );
  full.DOCS_RESULT = "skipped";
  full.MARKDOWN_ONLY = "false";
  assert.equal(runWorkflowStep(source, "Check release proof mode", full).status, 0);
  for (const resultName of releaseResultNames) {
    assert.equal(runWorkflowStep(source, "Check release proof mode", {
      ...full,
      [resultName]: "skipped",
    }).status, 1, `full mode must reject non-success ${resultName}`);
  }
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...full,
    DOCS_RESULT: "success",
  }).status, 1);
  assert.equal(runWorkflowStep(source, "Check release proof mode", {
    ...full,
    PLAN_RESULT: "failure",
  }).status, 1);
  for (const result of ["failure", "cancelled", ""]) {
    assert.equal(runWorkflowStep(source, "Check release proof mode", {
      ...docsProof,
      WEB_POSTGRES_RESULT: result,
    }).status, 1, `docs mode must reject PostgreSQL result ${JSON.stringify(result)}`);
    assert.equal(runWorkflowStep(source, "Check release proof mode", {
      ...full,
      WEB_POSTGRES_RESULT: result,
    }).status, 1, `full mode must reject PostgreSQL result ${JSON.stringify(result)}`);
  }
});

test("required Stripe boundary accepts docs-only skipped and full proof modes", async () => {
  const source = await workflow("hosted-stripe-billing.yml");
  const live = jobBlock(source, "live-stripe-browser");
  assert.match(live, /^    runs-on: ubuntu-24.04$/mu);
  assert.match(live, /^        image: postgres:17$/mu);
  assert.match(live, /^          POSTGRES_DB: murph_hosted_stripe_billing$/mu);
  assert.match(live, /--health-cmd "pg_isready -U postgres -d murph_hosted_stripe_billing"/u);
  assert.match(live, /^          - 5432:5432$/mu);
  assert.doesNotMatch(live, /^\s+credentials:|docker login/mu);
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
    LIVE_RESULT: "skipped",
    MARKDOWN_ONLY: "",
    SCOPE_RESULT: "skipped",
  }).status, 0);
  assert.equal(runWorkflowStep(source, "Enforce hermetic proof and event-scoped live result", {
    ...base,
    EVENT_NAME: "schedule",
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
    [...EXPENSIVE_WORKFLOWS.keys(), "compiler-benchmark.yml", "pr-evidence.yml"].sort(),
  );
  assert.deepEqual(triggerTypes(await workflow("pr-evidence.yml")), ["opened", "synchronize", "reopened", "edited"]);
  const benchmark = await workflow("compiler-benchmark.yml");
  assert.deepEqual(triggerTypes(benchmark), READY_ONLY_TYPES);
  assert.match(benchmark, /^  workflow_dispatch:$/mu);
  assert.match(benchmark, /^permissions:\n  contents: read$/mu);
  assert.doesNotMatch(benchmark, /pull_request_target|secrets\.|^\s+environment:/mu);
  // This diagnostic is not required release proof. Drafts can skip it without
  // changing any required owner's fail-closed draft admission above.
  assert.match(
    jobBlock(benchmark, "paired"),
    /^    if: \$\{\{ github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.draft \}\}$/mu,
  );
});

test("exact-candidate complexity regression guard remains required", async () => {
  const host = await workflow("host-support.yml");
  const build = jobBlock(host, "release-build-typecheck-linux");
  assert.match(
    build,
    /uses: actions\/checkout@[^\n]+\n        with:\n          fetch-depth: 2\n          persist-credentials: false/u,
  );
  assert.match(
    build,
    /- name: Guard cyclomatic complexity regressions\n        if: \$\{\{ github\.event_name == 'pull_request' \}\}\n        env:\n          MURPH_COMPLEXITY_BASE_SHA: \$\{\{ github\.sha \}\}\^1\n          MURPH_COMPLEXITY_HEAD_SHA: \$\{\{ github\.sha \}\}\n        run: pnpm complexity:diff/u,
  );
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

test("required main proof survives later merges while PR proof still supersedes", async () => {
  for (const name of REQUIRED_OWNER_JOBS.keys()) {
    const source = await workflow(name);
    assert.match(source, /group: .*github\.event\.pull_request\.number \|\| github\.sha/u,
      `${name} must bind main proof to the candidate SHA`);
  }
  const stripe = await workflow("hosted-stripe-billing.yml");
  assert.match(jobBlock(stripe, "live-stripe-browser"), /queue: max/u,
    "shared sandbox serialization must not discard pending candidate proof");
  const admission = await workflow("temporal-web-deployment-admission.yml");
  assert.match(admission, /group: temporal-web-deployment-admission/u);
  assert.match(admission, /cancel-in-progress: false/u);
  assert.doesNotMatch(admission, /queue: max/u, "retain only the latest pending candidate");
});
