import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareRunnerBundleMeasurements,
  formatRunnerBundleGrowthDiagnostics,
  inspectRunnerBundleBudgetWorkflow,
  resolveRunnerBundleGrowthAllowance,
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

function measurement(totalBytes, path = "bin.js") {
  return { outputs: [{ bytes: totalBytes, path }], totalBytes };
}

test("accepts the checked-in deployment-faithful relative budget gate", async () => {
  assert.deepEqual(issueCodes(await readWorkflow()), []);
});

test("keeps the exact relative-growth threshold inclusive and fails one byte over", () => {
  assert.equal(resolveRunnerBundleGrowthAllowance(1_000_000), 96 * 1024);
  assert.equal(resolveRunnerBundleGrowthAllowance(20_000_099), 200_000);

  const base = measurement(1_000_000, "base.js");
  const allowance = resolveRunnerBundleGrowthAllowance(base.totalBytes);
  const atThreshold = compareRunnerBundleMeasurements(
    base,
    measurement(base.totalBytes + allowance),
  );
  const oneByteOver = compareRunnerBundleMeasurements(
    base,
    measurement(base.totalBytes + allowance + 1),
  );

  assert.equal(atThreshold.passed, true);
  assert.equal(atThreshold.excessBytes, 0);
  assert.equal(oneByteOver.passed, false);
  assert.equal(oneByteOver.excessBytes, 1);
  assert.equal(
    formatRunnerBundleGrowthDiagnostics(
      oneByteOver,
      measurement(oneByteOver.candidateBytes, "largest.js"),
    ),
    [
      "base bytes: 1000000B",
      "candidate bytes: 1098305B",
      "delta: +98305B",
      "allowance: 98304B",
      "excess: 1B",
      "largest candidate outputs:",
      "  1098305B largest.js",
    ].join("\n"),
  );
});

test("rejects missing or malformed bundle measurements", () => {
  assert.throws(
    () => compareRunnerBundleMeasurements(undefined, measurement(100)),
    /Missing or malformed base runner bundle measurement/u,
  );
  assert.throws(
    () =>
      compareRunnerBundleMeasurements(
        { outputs: [{ bytes: 99, path: "bin.js" }], totalBytes: 100 },
        measurement(100),
      ),
    /Missing or malformed base runner bundle measurement/u,
  );
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
    "    runs-on: ubuntu-24.04\n    env:\n      MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY: \"4\"",
    "    runs-on: macos-latest\n    env:\n      MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY: \"4\"",
  );
  assert.ok(issueCodes(source).includes("wrong-budget-platform"));
});

test("requires isolated exact candidate/base wiring and the shared comparison owner", async () => {
  const source = (await readWorkflow())
    .replace("          path: candidate\n", "")
    .replace("          path: base\n", "")
    .replace(
      "        run: node candidate/scripts/check-runner-bundle-budget-ci.mjs compare base candidate\n",
      "",
    );
  const codes = issueCodes(source);
  assert.ok(codes.includes("missing-candidate-path"));
  assert.ok(codes.includes("missing-base-path"));
  assert.ok(codes.includes("missing-relative-comparison"));
});

test("rejects measuring only the PR head instead of GitHub's merge candidate", async () => {
  const source = (await readWorkflow()).replace(
    "path: candidate\n          ref: ${{ github.sha }}",
    "path: candidate\n          ref: ${{ github.event.pull_request.head.sha || github.sha }}",
  );
  assert.ok(issueCodes(source).includes("missing-exact-candidate-ref"));
});

test("rejects a prepared-only bundle substitute", async () => {
  const source = (await readWorkflow()).replace(
    "run: pnpm --dir apps/cloudflare runner:bundle\n",
    "run: pnpm --dir apps/cloudflare runner:bundle:assemble-only\n",
  );
  assert.ok(issueCodes(source).includes("missing-base-production-assembly"));
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
