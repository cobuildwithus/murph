import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflow = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

function runStep(source, name, env) {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `Missing workflow step: ${name}`);
  const rest = source.slice(start);
  const next = rest.indexOf("\n      - ", 1);
  const step = next < 0 ? rest : rest.slice(0, next);
  const body = step.split("        run: |\n")[1];
  assert.ok(body, `Missing executable body: ${name}`);
  // A job's last step is followed by the next job, not another step.
  const lines = body.split("\n");
  const end = lines.findIndex((line) => line !== "" && !line.startsWith("          "));
  const script = lines.slice(0, end < 0 ? lines.length : end).join("\n");
  return spawnSync("bash", ["-c", script.replace(/^ {10}/gmu, "")], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("release admission requires every actual shard to succeed", async () => {
  const source = await workflow("host-support.yml");
  const results = Object.fromEntries([
    "PLAN_RESULT", "BUILD_RESULT", "PACKAGE_RESULT", "WEB_BUILD_RESULT",
    "WEB_TEST_RESULT", "WEB_POSTGRES_RESULT", "CLOUDFLARE_RESULT",
    "BROWSER_SMOKE_RESULT", "FIXTURE_RESULT", "BUNDLE_RESULT",
  ].map((name) => [name, "success"]));
  const name = "Require every release shard to succeed";
  assert.equal(runStep(source, name, results).status, 0);
  for (const result of Object.keys(results)) {
    for (const status of ["failure", "skipped", "cancelled", ""]) {
      assert.equal(runStep(source, name, { ...results, [result]: status }).status, 1,
        `${result}=${status} must prevent release admission`);
    }
  }
});

test("a file-split package shard runs its own slice and nothing runs a split it cannot honor", async () => {
  const source = await workflow("host-support.yml");
  const name = "Run package coverage shard";
  // The step's inputs must come from the plan's matrix entry, not a constant.
  assert.ok(source.includes("          PACKAGE_SHARD: ${{ matrix.package_shard }}\n"));
  assert.ok(source.includes("          VITEST_SHARD: ${{ matrix.vitest_shard }}\n"));
  const bin = await mkdtemp(path.join(tmpdir(), "murph-package-shard-"));
  try {
    // Record the test command instead of running it; the plan lookup is real.
    await writeFile(path.join(bin, "pnpm"), "#!/bin/sh\nprintf '%s\\n' \"$*\"\n");
    await chmod(path.join(bin, "pnpm"), 0o755);
    const run = (packageShard, vitestShard) => runStep(source, name, {
      PATH: `${bin}:${process.env.PATH}`,
      PACKAGE_SHARD: packageShard,
      VITEST_SHARD: vitestShard,
    });
    for (const [packageShard, vitestShard] of [
      ["cli", "1/2"], ["assistant-engine", "2/3"], ["assistant-runtime", "2/2"],
    ]) {
      const split = run(packageShard, vitestShard);
      assert.equal(split.status, 0, split.stderr);
      assert.match(split.stdout, new RegExp(`coverage --shard ${vitestShard}\n$`, "u"),
        `${packageShard} must pass its slice to Vitest`);
      const whole = run(packageShard, "");
      assert.equal(whole.status, 0, whole.stderr);
      assert.doesNotMatch(whole.stdout, /--shard/u);
    }
    const group = run("platform-a", "");
    assert.equal(group.status, 0, group.stderr);
    assert.doesNotMatch(group.stdout, /--shard/u);
    // A slice on a shard whose command cannot take it would silently run
    // every file on every runner, or none; the step must refuse instead.
    assert.equal(run("platform-a", "1/2").status, 1);
    assert.equal(run("no-such-shard", "").status, 1);
  } finally {
    await rm(bin, { force: true, recursive: true });
  }
});

test("every PostgreSQL shard index the workflow starts selects against the same count", async () => {
  // The runner picks files by index modulo count, so a matrix that starts
  // fewer indexes than the count it passes would leave files that never run.
  const source = await workflow("host-support.yml");
  const job = source.split("  release-web-postgres-linux:\n")[1].split(/^  [a-z]/mu)[0];
  const indexes = JSON.parse(/^ {8}shard: (\[[0-9, ]+\])$/mu.exec(job)[1]);
  const count = Number(/--shard \$\{\{ matrix\.shard \}\}\/([0-9]+)$/mu.exec(job)[1]);
  assert.deepEqual(indexes, Array.from({ length: count }, (_, index) => index + 1));
  assert.match(job, new RegExp(`^ {6}max-parallel: ${count}$`, "mu"));
  assert.match(job, new RegExp(`\\(\\$\\{\\{ matrix\\.shard \\}\\}/${count}\\)$`, "mu"));
});

test("billing admission requires live proof only for scheduled runs", async () => {
  const source = await workflow("hosted-stripe-billing.yml");
  for (const [event, hermetic, live, expected] of [
    ["pull_request", "success", "skipped", 0],
    ["pull_request", "success", "success", 1],
    ["pull_request", "skipped", "skipped", 1],
    ["push", "success", "skipped", 0],
    ["push", "failure", "skipped", 1],
    ["schedule", "success", "success", 0],
    ["schedule", "success", "skipped", 1],
    ["schedule", "success", "failure", 1],
    ["unknown", "success", "success", 1],
  ]) {
    const result = runStep(source, "Enforce hermetic proof and event-scoped live result", {
      EVENT_NAME: event, HERMETIC_RESULT: hermetic, LIVE_RESULT: live,
    });
    assert.equal(result.status, expected, `${event}/${hermetic}/${live}: ${result.stderr}`);
  }
});

test("public candidate workflows keep untrusted PR execution separate from privileged events", async () => {
  for (const name of [
    "host-support.yml", "hosted-stripe-billing.yml", "repo-hygiene.yml",
    "foreground-reply-state-cardinality.yml", "web-viewport-overflow.yml",
  ]) {
    const source = await workflow(name);
    assert.doesNotMatch(source, /^  pull_request_target:/mu, name);
    assert.doesNotMatch(source, /^    paths(?:-ignore)?:/mu, `${name} must not skip required check creation`);
    assert.match(source, /github\.event\.pull_request\.draft/u, `${name} must reject draft proof`);
    assert.match(source, /persist-credentials: false/u, `${name} must not persist checkout credentials`);
  }
  const billing = await workflow("hosted-stripe-billing.yml");
  const live = billing.split("  live-stripe-browser:\n")[1].split(/^  [a-z]/mu)[0];
  assert.match(live, /if: .*github\.event_name == 'schedule'/u,
    "The secret-bearing Stripe lane must remain schedule-only");
});
