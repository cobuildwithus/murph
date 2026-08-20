#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workflowUrl = new URL(
  "../.github/workflows/host-support.yml",
  import.meta.url,
);

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
    "missing-unfiltered-pull-request-trigger",
    "on:\n  pull_request:\n  push:\n    branches:\n      - main\n",
    "The host-support workflow must run for every pull request and main push.",
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
      "missing-exact-merge-ref",
      "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/merge', github.event.pull_request.number) || github.sha }}",
      "Pull requests must measure the exact head merged onto the current base candidate.",
    );
    requireText(
      budgetJob,
      "missing-merge-parent-history",
      "fetch-depth: 2",
      "The checkout must include both merge parents for exact-head validation.",
    );
    requireText(
      budgetJob,
      "checkout-persists-credentials",
      "persist-credentials: false",
      "The bundle-budget checkout must not persist repository credentials.",
    );
    requireText(
      budgetJob,
      "missing-live-base-read",
      'git ls-remote --exit-code --refs origin "refs/heads/${PR_BASE_REF}"',
      "The job must read the base branch directly from origin instead of a stale local ref.",
    );
    requireText(
      budgetJob,
      "missing-exact-head-parent-proof",
      'candidate_head="$(git rev-parse HEAD^2)"',
      "The merge candidate must prove its second parent is the event's exact PR head.",
    );
    requireText(
      budgetJob,
      "missing-current-base-parent-proof",
      'candidate_base="$(git rev-parse HEAD^1)"',
      "The merge candidate must prove its first parent is the live base branch.",
    );
    requireText(
      budgetJob,
      "missing-head-comparison",
      '[[ "$candidate_head" == "$PR_HEAD_SHA" ]]',
      "The exact PR head comparison is missing.",
    );
    requireText(
      budgetJob,
      "missing-base-comparison",
      '[[ "$candidate_base" == "$current_base" ]]',
      "The current-base comparison is missing.",
    );
    requireText(
      budgetJob,
      "missing-base-output",
      'echo "base_sha=${current_base}" >> "$GITHUB_OUTPUT"',
      "The measured base must be bound to the post-assembly freshness check.",
    );
    requireText(
      budgetJob,
      "missing-post-assembly-base-check",
      '[[ "$current_base" == "$MEASURED_BASE_SHA" ]]',
      "The job must fail when main moves while the bundle is being measured.",
    );
    requireText(
      budgetJob,
      "missing-frozen-install",
      "pnpm install --frozen-lockfile",
      "The deployment closure must be installed from the locked dependency graph.",
    );
    requireText(
      budgetJob,
      "missing-production-assembly",
      "run: pnpm --dir apps/cloudflare runner:bundle\n",
      "The job must assemble the full production runner artifact.",
    );

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
    "The release aggregate must fail when the bundle budget job is skipped or unsuccessful.",
  );

  return issues;
}

export async function checkRunnerBundleBudgetWorkflow() {
  const source = await readFile(workflowUrl, "utf8");
  return inspectRunnerBundleBudgetWorkflow(source);
}

async function main() {
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
  await main();
}
