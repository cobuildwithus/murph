#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scenarios = ["boot", "seed", "new"];
const metrics = { cpuMs: { ratio: 1.25, floor: 100 }, wallMs: { ratio: 1.4, floor: 250 } };
const benchPath = "packages/core/bench";
const bundlePath = "apps/cloudflare/.deploy/runner-bundle";

export function parseLatencyRun(output) {
  const rows = output.trim().split("\n").map((line) => JSON.parse(line));
  const result = Object.create(null);
  for (const row of rows) {
    assert.ok(row && typeof row === "object" && !Array.isArray(row), "Malformed record");
    // The real runtime also emits structured lifecycle logs, including on close.
    if (!Object.hasOwn(row, "scenario")) continue;
    assert.equal(typeof row.scenario, "string", "Malformed scenario");
    assert.ok(!Object.hasOwn(result, row.scenario), "Duplicate scenario");
    result[row.scenario] = row;
  }
  for (const scenario of scenarios) {
    for (const metric of Object.keys(metrics)) {
      assert.ok(Number.isFinite(result[scenario]?.[metric]) && result[scenario][metric] > 0,
        `Missing or invalid ${scenario}.${metric}`);
    }
  }
  assert.equal(result["canonical-readback"]?.passed, true, "Missing canonical readback");
  for (const scenario of ["new", "disjoint", "replay", "correction"]) {
    assert.match(result[scenario]?.semanticSha256 ?? "", /^[a-f0-9]{64}$/u);
  }
  return result;
}

export function compareLatencyRuns(base, candidate) {
  assert.equal(base.length, 3, "Exactly three base samples required");
  assert.equal(candidate.length, 3, "Exactly three candidate samples required");
  const all = [...base, ...candidate].map((run) => parseLatencyRun(run));
  for (const scenario of ["new", "disjoint", "replay", "correction"]) {
    assert.equal(new Set(all.map((run) => run[scenario].semanticSha256)).size, 1,
      `${scenario} semantics changed`);
  }
  const median = (runs, scenario, metric) => runs.map((run) => run[scenario][metric]).sort((a, b) => a - b)[1];
  return scenarios.flatMap((scenario) => Object.entries(metrics).map(([metric, budget]) => {
    const baseMs = median(all.slice(0, 3), scenario, metric);
    const candidateMs = median(all.slice(3), scenario, metric);
    const limitMs = Math.max(baseMs * budget.ratio, baseMs + budget.floor);
    return { scenario, metric, baseMs, candidateMs, limitMs, passed: candidateMs <= limitMs };
  }));
}

function command(executable, args, options = {}) {
  const output = execFileSync(executable, args, {
    encoding: "utf8", timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024, ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

export function runContainer(image, directory, script, run = command) {
  // Only this create receipt grants cleanup ownership; never select by name.
  const id = run("docker", ["create", "--platform", "linux/amd64", "--network", "none",
    "--cpus", "1", "--memory", "6g", "--memory-swap", "6g", "--pids-limit", "128",
    "--mount", `type=bind,src=${directory},dst=/bench,readonly`,
    "--env", "MURPH_BENCH_EVENTS=8000", "--env", "MURPH_BENCH_TIME_ZONES=UTC,America/Chicago",
    "--entrypoint", "node", image, `/bench/${script}`]);
  assert.match(id, /^[a-f0-9]{64}$/u, "Docker create did not return a container ID");
  try {
    const output = run("docker", ["start", "--attach", id], { timeout: 120_000 });
    assert.equal(run("docker", ["inspect", "--format", "{{.State.ExitCode}}", id]), "0",
      "Benchmark container failed");
    return output;
  } finally {
    run("docker", ["rm", "--force", id], { timeout: 30_000 });
  }
}

export async function inspectLatencyWorkflow(source) {
  const job = source.split("  production-runner-bundle-budget-linux:\n")[1]?.split(/^  [a-z].*:\n/mu)[0];
  assert.ok(job?.includes("          node candidate/scripts/check-container-latency-ci.mjs base candidate"),
    "Required production bundle job must execute the one-vCPU latency gate");
  assert.ok(job.includes("node --test candidate/scripts/check-container-latency-ci.test.mjs"),
    "Required production bundle job must test the latency comparator");
  assert.ok(!job.includes("continue-on-error: true"), "Latency gate cannot be advisory");
}

async function main(baseArgument, candidateArgument) {
  assert.ok(baseArgument && candidateArgument, "Usage: check-container-latency-ci.mjs base candidate");
  const roots = [path.resolve(baseArgument), path.resolve(candidateArgument)];
  assert.notEqual(roots[0], roots[1], "Base and candidate must be distinct checkouts");
  const candidate = roots[1];
  await inspectLatencyWorkflow(await readFile(path.join(candidate, ".github/workflows/host-support.yml"), "utf8"));
  const require = createRequire(path.join(candidate, "apps/cloudflare/package.json"));
  const { buildSync } = require("esbuild");
  const contents = await readFile(path.join(candidate, benchPath, "device-import.ts"), "utf8");
  const artifacts = path.join(candidate, ".artifacts");
  await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(path.join(artifacts, "container-latency-"));
  const images = [];
  try {
    for (const [index, root] of roots.entries()) {
      const directory = path.join(scratch, String(index));
      await mkdir(directory);
      buildSync({ stdin: { contents, resolveDir: path.join(root, benchPath), loader: "ts" },
        bundle: true, platform: "node", format: "esm", target: "node24",
        tsconfig: path.join(root, "tsconfig.base.json"), outfile: path.join(directory, "import.mjs"),
        banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
      await copyFile(path.join(candidate, "scripts/container-latency-boot.mjs"), path.join(directory, "boot.mjs"));
      command("pnpm", ["--dir", path.join(root, "apps/cloudflare"), "runner:docker:base"], { stdio: "inherit" });
      const image = `murph-latency-${randomUUID()}`;
      command("docker", ["build", "--platform", "linux/amd64", "--tag", image,
        "--file", path.join(root, "Dockerfile.cloudflare-hosted-runner"),
        "--build-arg", "HOSTED_RUNNER_BUNDLE_DIR=.", path.join(root, bundlePath)], { stdio: "inherit" });
      images.push(image);
    }
    const samples = [[], []];
    for (let round = 0; round < 3; round += 1) {
      for (const index of round % 2 === 0 ? [0, 1] : [1, 0]) {
        const directory = path.join(scratch, String(index));
        const boot = runContainer(images[index], directory, "boot.mjs");
        const imports = runContainer(images[index], directory, "import.mjs");
        samples[index].push(`${boot}\n${imports}`);
      }
    }
    const comparisons = compareLatencyRuns(...samples);
    console.log(JSON.stringify({ samples: samples.map((runs) => runs.map(parseLatencyRun)), comparisons }, null, 2));
    assert.ok(comparisons.every((result) => result.passed), "One-vCPU latency regression; inspect scenario budgets above");
  } finally {
    const cleanupErrors = [];
    for (const image of images) {
      try { command("docker", ["image", "rm", image], { timeout: 30_000 }); }
      catch (error) { cleanupErrors.push(error); }
    }
    await rm(scratch, { recursive: true, force: true });
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Owned benchmark image cleanup failed");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(...process.argv.slice(2));
}
