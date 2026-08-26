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

test("rejects synchronize admission to the deployment budget gate", async () => {
  const source = (await readWorkflow()).replace(
    "types: [opened, reopened, ready_for_review]",
    "types: [opened, synchronize, reopened, ready_for_review]",
  );
  assert.ok(issueCodes(source).includes("missing-ready-only-pull-request-trigger"));
});

test("rejects moving the authoritative byte measurement to macOS", async () => {
  const source = (await readWorkflow()).replace(
    "  production-runner-bundle-budget-linux:\n    name: Production runner bundle budget (ubuntu)\n    needs: markdown-docs-scope\n    if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.markdown-docs-scope.outputs.markdown_only != 'true') }}\n    runs-on: ubuntu-24.04",
    "  production-runner-bundle-budget-linux:\n    name: Production runner bundle budget (ubuntu)\n    needs: markdown-docs-scope\n    if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.markdown-docs-scope.outputs.markdown_only != 'true') }}\n    runs-on: macos-latest",
  );
  assert.ok(issueCodes(source).includes("wrong-budget-platform"));
});

test("rejects measuring only the PR head instead of GitHub's merge candidate", async () => {
  const source = (await readWorkflow()).replace(
    "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/merge', github.event.pull_request.number) || github.sha }}",
    "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
  );
  assert.ok(issueCodes(source).includes("missing-exact-merge-ref"));
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
      "          BUNDLE_RESULT: ${{ needs.production-runner-bundle-budget-linux.result }}\n",
      "",
    );
  const codes = issueCodes(source);
  assert.ok(codes.includes("missing-aggregate-dependency"));
  assert.ok(codes.includes("missing-aggregate-result-check"));
});
