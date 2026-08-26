#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workflowUrl = new URL(
  "../.github/workflows/host-support.yml",
  import.meta.url,
);
const vaultCliBundleRelativePath = path.join(
  "apps",
  "cloudflare",
  ".deploy",
  "runner-bundle",
  "node_modules",
  "@murphai",
  "murph",
  ".bundle",
);
const minimumGrowthAllowanceBytes = 96 * 1024;

function extractJob(source, jobName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return undefined;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-z0-9][a-z0-9-]*:$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function inspectRunnerBundleBudgetWorkflow(source) {
  const issues = [];
  const requireText = (haystack, code, needle, message) => {
    if (!haystack?.includes(needle)) issues.push({ code, message });
  };

  requireText(
    source,
    "missing-ready-only-pull-request-trigger",
    "on:\n  pull_request:\n    types: [opened, reopened, ready_for_review]\n  push:\n    branches:\n      - main\n",
    "The host-support workflow must run for ready pull request candidates and main pushes.",
  );
  if (source.includes("pull_request_target")) {
    issues.push({
      code: "unsafe-pull-request-target",
      message: "Untrusted pull-request code must not run through pull_request_target.",
    });
  }

  const budgetJob = extractJob(
    source,
    "production-runner-bundle-budget-linux",
  );
  if (!budgetJob) {
    issues.push({
      code: "missing-budget-job",
      message: "The production Linux runner-bundle budget job is missing.",
    });
  } else {
    requireText(
      budgetJob,
      "missing-budget-job-name",
      "name: Production runner bundle budget (ubuntu)",
      "The budget job must retain its stable public check name.",
    );
    requireText(
      budgetJob,
      "missing-budget-needs",
      "needs: markdown-docs-scope",
      "The bundle budget must retain its documentation-scope dependency.",
    );
    requireText(
      budgetJob,
      "missing-budget-if",
      "if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.markdown-docs-scope.outputs.markdown_only != 'true') }}",
      "The bundle budget must retain the Markdown-only fast-path contract.",
    );
    requireText(
      budgetJob,
      "wrong-budget-platform",
      "runs-on: ubuntu-24.04",
      "The authoritative runner-bundle budget must run on deployment Linux.",
    );
    requireText(
      budgetJob,
      "missing-linux-platform-proof",
      'test "$(uname -s)" = "Linux"',
      "The job must fail closed if its runner is no longer Linux.",
    );
    requireText(
      budgetJob,
      "missing-amd64-platform-proof",
      'test "$(uname -m)" = "x86_64"',
      "The job must fail closed if its runner is no longer linux/amd64.",
    );
    requireText(
      budgetJob,
      "missing-exact-candidate-ref",
      "ref: ${{ github.sha }}",
      "The checkout must use GitHub's exact event candidate SHA.",
    );
    requireText(
      budgetJob,
      "missing-candidate-path",
      "path: candidate",
      "The exact candidate must use an isolated checkout path.",
    );
    requireText(
      budgetJob,
      "missing-parent-depth",
      "fetch-depth: 2",
      "The candidate checkout must include its first parent for direct proof.",
    );
    requireText(
      budgetJob,
      "missing-candidate-proof",
      'test "$candidate_sha" = "$EXPECTED_CANDIDATE_SHA"',
      "The workflow must prove the checked-out candidate matches GitHub event data.",
    );
    requireText(
      budgetJob,
      "missing-first-parent-proof",
      'base_sha="$(git -C candidate rev-parse HEAD^1)"',
      "The workflow must derive the exact first parent directly from the candidate.",
    );
    requireText(
      budgetJob,
      "missing-base-checkout",
      "ref: ${{ steps.revisions.outputs.base_sha }}",
      "The base checkout must use the candidate's proven first parent.",
    );
    requireText(
      budgetJob,
      "missing-base-path",
      "path: base",
      "The exact first parent must use an isolated sibling checkout path.",
    );
    requireText(
      budgetJob,
      "checkout-persists-credentials",
      "persist-credentials: false",
      "The bundle-budget checkouts must not persist repository credentials.",
    );
    requireText(
      budgetJob,
      "missing-base-frozen-install",
      "working-directory: base\n        run: pnpm install --frozen-lockfile",
      "The base must install from its own frozen lockfile.",
    );
    requireText(
      budgetJob,
      "missing-candidate-frozen-install",
      "working-directory: candidate\n        run: pnpm install --frozen-lockfile",
      "The candidate must install from its own frozen lockfile.",
    );
    requireText(
      budgetJob,
      "missing-base-production-assembly",
      "working-directory: base\n        run: pnpm --dir apps/cloudflare runner:bundle\n",
      "The base must assemble the full production runner artifact.",
    );
    requireText(
      budgetJob,
      "missing-candidate-production-assembly",
      "working-directory: candidate\n        run: pnpm --dir apps/cloudflare runner:bundle\n",
      "The candidate must assemble the full production runner artifact.",
    );
    requireText(
      budgetJob,
      "missing-relative-comparison",
      "node candidate/scripts/check-runner-bundle-budget-ci.mjs compare base candidate",
      "The existing CI owner must compare exact base and candidate bundle output.",
    );

    if (budgetJob.includes("git worktree") || budgetJob.includes("git clone")) {
      issues.push({
        code: "manual-git-isolation",
        message: "Use pinned checkout action paths instead of raw Git worktree or clone isolation.",
      });
    }
    if (budgetJob.includes("runner:bundle:assemble-only")) {
      issues.push({
        code: "non-production-assembly",
        message: "The required gate must not substitute the prepared assemble-only path.",
      });
    }
    if (budgetJob.includes("MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS")) {
      issues.push({
        code: "skipped-pack-preflights",
        message: "The required gate must not skip production package preflights.",
      });
    }
    if (budgetJob.includes("continue-on-error: true")) {
      issues.push({
        code: "advisory-budget-job",
        message: "The production budget must remain fail closed.",
      });
    }
  }

  const aggregateJob = extractJob(source, "release-checks-linux");
  requireText(
    aggregateJob,
    "missing-aggregate-dependency",
    "      - production-runner-bundle-budget-linux",
    "The stable Ubuntu release aggregate must depend on the bundle budget job.",
  );
  requireText(
    aggregateJob,
    "missing-aggregate-result-check",
    '${{ needs.production-runner-bundle-budget-linux.result }}',
    "The release aggregate must inspect the bundle result so full proof requires success and docs proof requires a skip.",
  );

  return issues;
}

export function resolveRunnerBundleGrowthAllowance(baseBytes) {
  if (!Number.isSafeInteger(baseBytes) || baseBytes < 0) {
    throw new Error("Runner bundle base bytes must be a non-negative safe integer.");
  }
  return Math.max(minimumGrowthAllowanceBytes, Math.floor(baseBytes / 100));
}

function validateRunnerBundleMeasurement(measurement, label) {
  if (
    !measurement ||
    !Number.isSafeInteger(measurement.totalBytes) ||
    measurement.totalBytes < 0 ||
    !Array.isArray(measurement.outputs) ||
    measurement.outputs.length === 0 ||
    measurement.outputs.some(
      (output) =>
        !output ||
        typeof output.path !== "string" ||
        output.path.length === 0 ||
        !Number.isSafeInteger(output.bytes) ||
        output.bytes < 0,
    )
  ) {
    throw new Error(`Missing or malformed ${label} runner bundle measurement.`);
  }

  const measuredTotal = measurement.outputs.reduce(
    (sum, output) => sum + output.bytes,
    0,
  );
  if (measuredTotal !== measurement.totalBytes) {
    throw new Error(`Missing or malformed ${label} runner bundle measurement.`);
  }
  return measurement;
}

export function compareRunnerBundleMeasurements(baseMeasurement, candidateMeasurement) {
  const base = validateRunnerBundleMeasurement(baseMeasurement, "base");
  const candidate = validateRunnerBundleMeasurement(candidateMeasurement, "candidate");
  const allowanceBytes = resolveRunnerBundleGrowthAllowance(base.totalBytes);
  const deltaBytes = candidate.totalBytes - base.totalBytes;
  const excessBytes = Math.max(0, deltaBytes - allowanceBytes);

  return {
    allowanceBytes,
    baseBytes: base.totalBytes,
    candidateBytes: candidate.totalBytes,
    deltaBytes,
    excessBytes,
    passed: excessBytes === 0,
  };
}

export async function measureRunnerBundleOutput(repoRoot) {
  const bundleRoot = path.join(repoRoot, vaultCliBundleRelativePath);
  let entries;
  try {
    entries = await readdir(bundleRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing runner bundle measurement at ${bundleRoot}.`);
    }
    throw error;
  }

  const outputs = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const outputPath = path.join(bundleRoot, entry.name);
    const outputStat = await stat(outputPath);
    outputs.push({ bytes: outputStat.size, path: entry.name });
  }
  outputs.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));

  return validateRunnerBundleMeasurement(
    {
      outputs,
      totalBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
    },
    path.basename(repoRoot),
  );
}

function formatSignedBytes(bytes) {
  return `${bytes >= 0 ? "+" : ""}${bytes}B`;
}

export function formatRunnerBundleGrowthDiagnostics(result, candidateMeasurement) {
  const lines = [
    `base bytes: ${result.baseBytes}B`,
    `candidate bytes: ${result.candidateBytes}B`,
    `delta: ${formatSignedBytes(result.deltaBytes)}`,
    `allowance: ${result.allowanceBytes}B`,
    `excess: ${result.excessBytes}B`,
  ];
  if (!result.passed) {
    lines.push(
      "largest candidate outputs:",
      ...candidateMeasurement.outputs
        .slice(0, 10)
        .map((output) => `  ${output.bytes}B ${output.path}`),
    );
  }
  return lines.join("\n");
}

export async function compareRunnerBundleCheckouts(baseRoot, candidateRoot) {
  const [base, candidate] = await Promise.all([
    measureRunnerBundleOutput(baseRoot),
    measureRunnerBundleOutput(candidateRoot),
  ]);
  const result = compareRunnerBundleMeasurements(base, candidate);
  const diagnostics = formatRunnerBundleGrowthDiagnostics(result, candidate);

  if (!result.passed) {
    throw new Error(`vault-cli total output growth exceeds the relative CI allowance.\n${diagnostics}`);
  }
  process.stdout.write(`Runner bundle total output comparison passed.\n${diagnostics}\n`);
}

export async function checkRunnerBundleBudgetWorkflow() {
  const source = await readFile(workflowUrl, "utf8");
  return inspectRunnerBundleBudgetWorkflow(source);
}

async function main() {
  if (process.argv[2] === "compare") {
    if (!process.argv[3] || !process.argv[4] || process.argv[5]) {
      throw new Error(
        "Usage: check-runner-bundle-budget-ci.mjs compare <base-checkout> <candidate-checkout>",
      );
    }
    await compareRunnerBundleCheckouts(process.argv[3], process.argv[4]);
    return;
  }

  const issues = await checkRunnerBundleBudgetWorkflow();
  if (issues.length === 0) {
    process.stdout.write("Runner bundle budget CI contract is valid.\n");
    return;
  }

  for (const issue of issues) {
    process.stderr.write(`[${issue.code}] ${issue.message}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
