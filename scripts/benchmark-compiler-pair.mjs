#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { median } from "./benchmark-typescript.mjs";

// Run in a disposable, installed checkout: each sample replaces build outputs.
const output = ".tmp/compiler-benchmark";
mkdirSync(output, { recursive: true });
const samples = [];
const artifacts = new Map();
const env = {
  ...process.env,
  MURPH_TSC_PACKAGE_CHECKERS: "4",
  MURPH_TSC_WEB_CHECKERS: "4",
  MURPH_TSC_BUILDERS: "4",
  MURPH_TYPECHECK_WORKSPACE_CONCURRENCY: "2",
  MURPH_TSC_BUILD_CHECKERS: "4",
};

function run(label, command, overrides = {}) {
  const start = performance.now();
  const result = spawnSync(command[0], command.slice(1), {
    env: { ...env, ...overrides }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = (performance.now() - start) / 1000;
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`
    .replaceAll(process.cwd(), "<REPO>").replaceAll(homedir(), "<HOME_DIR>");
  writeFileSync(`${output}/${label}.log`, log);
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed (${result.signal ?? result.status}); see ${output}/${label}.log`);
  }
  console.log(`${label}: ${seconds.toFixed(3)}s`);
  return seconds;
}

function clearCheckState() {
  for (const file of globSync([
    "tsconfig.tools.tsbuildinfo",
    "packages/*/*typecheck*.tsbuildinfo",
    "apps/cloudflare/typecheck.tsbuildinfo",
    "apps/web/.next/cache/tsconfig.tsbuildinfo",
  ])) rmSync(file);
}

function fingerprintJavaScript() {
  return Object.fromEntries(globSync(["packages/*/dist/**/*.js", "packages/*/dist/**/*.js.map"])
    .sort().map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
}

// Generate prerequisites outside timing. Keep emission on TS7 during paired
// checks so those samples isolate the already-adopted source-check change.
run("prepare", ["pnpm", "typecheck"], {
  MURPH_TYPECHECK_COMPILER: "typescript", MURPH_BUILD_COMPILER: "typescript",
});
run("prepare-next-types", ["pnpm", "--dir", "apps/web", "exec", "next", "typegen"]);
for (let round = 1; round <= 3; round++) {
  for (const compiler of round % 2 ? ["typescript", "tsrs"] : ["tsrs", "typescript"]) {
    const checkEnv = { MURPH_TYPECHECK_COMPILER: compiler, MURPH_BUILD_COMPILER: "typescript" };
    clearCheckState();
    for (const state of ["cold", "warm"]) {
      const seconds = run(`check-${compiler}-${state}-${round}`, ["pnpm", "typecheck"], checkEnv);
      samples.push({ surface: "check", compiler, state, round, seconds });
    }
    rmSync("apps/web/.next/cache/tsconfig.next.tsbuildinfo", { force: true });
    const routeCommand = compiler === "typescript"
      ? ["node", "--max-old-space-size=6144", "apps/web/node_modules/typescript/bin/tsc"]
      : ["node", "scripts/run-typescript.mjs", "web"];
    for (const state of ["cold", "warm"]) {
      const seconds = run(`routes-${compiler}-${state}-${round}`, [
        ...routeCommand, "-p", "apps/web/tsconfig.next.json", "--pretty", "false",
      ], checkEnv);
      samples.push({ surface: "routes", compiler, state, round, seconds });
    }
    const buildEnv = { MURPH_BUILD_COMPILER: compiler };
    for (const state of ["cold", "warm"]) {
      const command = state === "cold"
        ? ["pnpm", "build:workspace:clean"]
        : ["pnpm", "build:workspace:incremental"];
      const seconds = run(`build-${compiler}-${state}-${round}`, command, buildEnv);
      samples.push({ surface: "build", compiler, state, round, seconds });
      if (state === "cold") artifacts.set(compiler, fingerprintJavaScript());
    }
  }
  if (JSON.stringify(artifacts.get("typescript")) !== JSON.stringify(artifacts.get("tsrs"))) {
    throw new Error(`JavaScript or source-map output differs in round ${round}; investigate before adopting emission.`);
  }
}

const summary = ["| Surface | State | Baseline median | tsrs median | Reduction |", "| --- | --- | ---: | ---: | ---: |"];
for (const surface of ["check", "routes", "build"]) {
  for (const state of ["cold", "warm"]) {
    const elapsed = compiler => median(samples.filter(sample =>
      sample.surface === surface && sample.state === state && sample.compiler === compiler,
    ).map(sample => sample.seconds));
    const baseline = elapsed("typescript");
    const candidate = elapsed("tsrs");
    summary.push(`| ${surface} | ${state} | ${baseline.toFixed(3)}s | ${candidate.toFixed(3)}s | ${(100 * (1 - candidate / baseline)).toFixed(1)}% |`);
  }
}
const report = `${summary.join("\n")}\n\nThree alternating paired rounds on one runner and source revision. Baseline is TS7 for source checks/builds and app-local TS5 for Next-generated routes. Cold checks clear only their check build info; warm checks retain it. Cold builds clean outputs; warm builds use the normal incremental entrypoint. Source-check samples retain TS7 emission. All JavaScript and source maps match in every round. Timings exclude installation and are not total pipeline or billing savings.\n`;
writeFileSync(path.join(output, "results.json"), JSON.stringify({
  sha: process.env.GITHUB_SHA ?? null, platform: process.platform, arch: process.arch,
  node: process.version, budgets: {
    packageCheckers: 4, webCheckers: 4, builders: 4, buildCheckers: 4, packageConcurrency: 2,
  }, samples,
}, null, 2));
writeFileSync(path.join(output, "summary.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
