import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

function runStep(source, name, env) {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `Missing workflow step: ${name}`);
  const rest = source.slice(start);
  const next = rest.indexOf("\n      - ", 1);
  const step = next < 0 ? rest : rest.slice(0, next);
  const script = step.split("        run: |\n")[1];
  assert.ok(script, `Missing executable body: ${name}`);
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
