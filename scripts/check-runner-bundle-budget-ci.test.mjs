import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  inspectRunnerBundleBudgetWorkflow,
} from "./check-runner-bundle-budget-ci.mjs";

const workflowUrl = new URL(
  "../.github/workflows/host-support.yml",
  import.meta.url,
);

async function readWorkflow() {
  return readFile(workflowUrl, "utf8");
}

function issueCodes(source) {
  return inspectRunnerBundleBudgetWorkflow(source).map((issue) => issue.code);
}

test("accepts the checked-in deployment-faithful budget gate", async () => {
  assert.deepEqual(issueCodes(await readWorkflow()), []);
});

test("rejects moving the authoritative byte measurement to macOS", async () => {
  const source = (await readWorkflow()).replace(
    "  production-runner-bundle-budget-linux:\n    name: Production runner bundle budget (ubuntu)\n    runs-on: ubuntu-24.04",
    "  production-runner-bundle-budget-linux:\n    name: Production runner bundle budget (ubuntu)\n    runs-on: macos-latest",
  );
  assert.ok(issueCodes(source).includes("wrong-budget-platform"));
});

test("rejects measuring only the PR head instead of its current-base candidate", async () => {
  const source = (await readWorkflow()).replace(
    "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/merge', github.event.pull_request.number) || github.sha }}",
    "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
  );
  assert.ok(issueCodes(source).includes("missing-exact-merge-ref"));
});

test("rejects a stale local main comparison", async () => {
  const source = (await readWorkflow()).replaceAll(
    'git ls-remote --exit-code --refs origin "refs/heads/${PR_BASE_REF}"',
    'git rev-parse "refs/remotes/origin/${PR_BASE_REF}"',
  );
  assert.ok(issueCodes(source).includes("missing-live-base-read"));
});

test("rejects dropping the post-assembly base freshness check", async () => {
  const source = (await readWorkflow()).replace(
    '[[ "$current_base" == "$MEASURED_BASE_SHA" ]]',
    '[[ -n "$current_base" ]]',
  );
  assert.ok(issueCodes(source).includes("missing-post-assembly-base-check"));
});

test("rejects a prepared-only bundle substitute", async () => {
  const source = (await readWorkflow()).replace(
    "run: pnpm --dir apps/cloudflare runner:bundle\n",
    "run: pnpm --dir apps/cloudflare runner:bundle:assemble-only\n",
  );
  assert.ok(issueCodes(source).includes("missing-production-assembly"));
  assert.ok(issueCodes(source).includes("non-production-assembly"));
});

test("rejects detaching the budget from the stable required aggregate", async () => {
  const source = (await readWorkflow())
    .replace("      - production-runner-bundle-budget-linux\n", "")
    .replace(
      '          if [[ "${{ needs.production-runner-bundle-budget-linux.result }}" != "success" ]]; then\n            echo "Production runner bundle budget failed or did not complete."\n            exit 1\n          fi\n',
      "",
    );
  const codes = issueCodes(source);
  assert.ok(codes.includes("missing-aggregate-dependency"));
  assert.ok(codes.includes("missing-aggregate-result-check"));
});
