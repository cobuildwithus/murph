import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
const comparisonScriptPath = fileURLToPath(
  new URL("./check-runner-bundle-budget-ci.mjs", import.meta.url),
);
const bundleRelativePath = path.join(
  "apps",
  "cloudflare",
  ".deploy",
  "runner-bundle",
  "node_modules",
  "@murphai",
  "murph",
  ".bundle",
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

async function writeBundleOutputs(repoRoot, outputs) {
  const bundleRoot = path.join(repoRoot, bundleRelativePath);
  await mkdir(bundleRoot, { recursive: true });
  await Promise.all(
    outputs.map(({ bytes, name }) =>
      writeFile(path.join(bundleRoot, name), Buffer.alloc(bytes)),
    ),
  );
}

function runCheckoutComparison(baseRoot, candidateRoot) {
  return spawnSync(
    process.execPath,
    [comparisonScriptPath, "compare", baseRoot, candidateRoot],
    { encoding: "utf8" },
  );
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

test("compares emitted checkout files through the production CLI boundary", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "murph-runner-bundle-budget-"),
  );
  const baseRoot = path.join(fixtureRoot, "base");
  const candidateRoot = path.join(fixtureRoot, "candidate");

  try {
    await writeBundleOutputs(baseRoot, [{ bytes: 100, name: "bin.js" }]);
    await writeBundleOutputs(candidateRoot, [
      { bytes: 100, name: "bin.js" },
      { bytes: 98_304, name: "lazy.js" },
    ]);

    const atThreshold = runCheckoutComparison(baseRoot, candidateRoot);
    assert.equal(atThreshold.status, 0, atThreshold.stderr);
    assert.match(atThreshold.stdout, /delta: \+98304B/u);
    assert.match(atThreshold.stdout, /excess: 0B/u);

    await writeFile(
      path.join(candidateRoot, bundleRelativePath, "lazy.js"),
      Buffer.alloc(98_305),
    );
    const oneByteOver = runCheckoutComparison(baseRoot, candidateRoot);
    assert.equal(oneByteOver.status, 1, oneByteOver.stdout);
    assert.match(oneByteOver.stderr, /excess: 1B/u);
    assert.match(
      oneByteOver.stderr,
      /largest candidate outputs:\n  98305B lazy\.js/u,
    );
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("fails closed when the base checkout has no emitted bundle", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "murph-runner-bundle-budget-"),
  );
  const candidateRoot = path.join(fixtureRoot, "candidate");

  try {
    await writeBundleOutputs(candidateRoot, [{ bytes: 100, name: "bin.js" }]);
    const result = runCheckoutComparison(
      path.join(fixtureRoot, "missing-base"),
      candidateRoot,
    );

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Missing runner bundle measurement at/u);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
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
