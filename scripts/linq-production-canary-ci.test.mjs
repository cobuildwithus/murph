import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/linq-production-canary.yml",
  import.meta.url,
);
const runnerPath = new URL(
  "../apps/web/scripts/run-production-conversation-canary.ts",
  import.meta.url,
);

test("Linq production canary admits one verified serialized production journey per hour", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /schedule:\n\s+- cron: "17 \* \* \* \*"/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /pull_request:|\npush:|deployment_status:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /group: linq-production-canary/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /git merge-base --is-ancestor/u);
  assert.match(workflow, /resolve-vercel-production-alias-sha\.ts/u);
  assert.match(workflow, /verify-current-vercel-production-deployment\.ts/u);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.sha \}\}/u,
  );
  assert.doesNotMatch(workflow, /deployment_url|HOSTED_WEB_VERCEL_DEPLOYMENT_URL/u);
  assert.match(workflow, /persist-credentials: false/u);
});

test("Linq production canary keeps destructive and provider credentials in the live journey only", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const liveStep = workflow.slice(
    workflow.indexOf("- name: Run production iMessage journey"),
  );
  const beforeLiveStep = workflow.slice(
    0,
    workflow.indexOf("- name: Run production iMessage journey"),
  );

  for (const secret of [
    "MURPH_LINQ_PRODUCTION_CANARY_RESET_SECRET",
    "MURPH_LINQ_PRODUCTION_CANARY_TARGET_PHONE_NUMBER",
    "MURPH_LINQ_PRODUCTION_CANARY_SPECTRUM_PROJECT_ID",
    "MURPH_LINQ_PRODUCTION_CANARY_SPECTRUM_PROJECT_SECRET",
  ]) {
    assert.match(liveStep, new RegExp(`secrets\\.${secret}`, "u"));
    assert.doesNotMatch(beforeLiveStep, new RegExp(`secrets\\.${secret}`, "u"));
  }
  assert.match(
    liveStep,
    /pnpm --filter @murphai\/hosted-web linq:production-canary/u,
  );
});

test("Linq production canary runner proves the welcome and bounded business replies without logging content", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /CANARY_REPLY_BUDGET_MS = 20_000/u);
  assert.match(runner, /CANARY_REPLY_WAIT_MS = 90_000/u);
  assert.match(runner, /const CANARY_TURNS = \[/u);
  assert.match(runner, /MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE/u);
  assert.match(runner, /message\.direction !== "inbound"/u);
  assert.match(runner, /message\.platform !== "imessage"/u);
  assert.match(runner, /message\.sender\?\.id !== input\.userId/u);
  assert.match(runner, /space\.id !== input\.spaceId/u);
  assert.match(runner, /const code = error instanceof Error \? error\.name : "unknown";\s+console\.error\(`Linq production canary failed \(\$\{code\}\)\.`\);/u);
  assert.doesNotMatch(runner, /console\.(?:log|info)\([^\n]*(?:reply|prompt|phone)/u);
});


test("scheduled Linq proof uses the actual deployed revision and fails closed on unverified selection", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const start = workflow.indexOf("      - name: Verify current exact Vercel production deployment");
  const step = workflow.slice(start, workflow.indexOf("      - name: Run production iMessage journey", start));
  const script = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length)
    .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  assert.doesNotMatch(workflow, /should_run=false|Skipping the Linq canary/u);
  const root = await mkdtemp(path.join(tmpdir(), "linq-deployed-proof-"));
  const deployedSha = "a".repeat(40);
  try {
    await writeFile(path.join(root, "pnpm"), `#!/usr/bin/env bash
set -euo pipefail
case "\${*: -1}" in
  scripts/resolve-vercel-production-alias-sha.ts) printf '%s' "\${ALIAS_SHA}" ;;
  scripts/verify-current-vercel-production-deployment.ts)
    [[ "\${DEPLOYED_SHA}" == "\${ALIAS_SHA}" ]] || exit 5
    printf '%s' "\${VERIFIED_SHA}" ;;
  *) exit 6 ;;
esac
`, { mode: 0o755 });
    await writeFile(path.join(root, "git"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == merge-base && "$2" == --is-ancestor && "$3" == "\${ALIAS_SHA}" && "$4" == origin/main ]] || exit 6
exit "\${ANCESTRY_STATUS:-0}"
`, { mode: 0o755 });
    const scenarios = [
      { expected: 0, requested: "", alias: deployedSha, verified: deployedSha },
      { expected: 0, requested: deployedSha, alias: deployedSha, verified: deployedSha },
      { expected: 1, requested: "b".repeat(40), alias: deployedSha, verified: deployedSha },
      { expected: 1, requested: "", alias: "malformed", verified: deployedSha },
      { expected: 1, requested: "", alias: deployedSha, verified: "b".repeat(40) },
      { expected: 1, requested: "", alias: deployedSha, verified: deployedSha, ancestry: "1" },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const output = path.join(root, `proof-${index}`);
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8", env: {
        PATH: `${root}:${process.env.PATH}`, ALIAS_SHA: scenario.alias, VERIFIED_SHA: scenario.verified,
        ANCESTRY_STATUS: scenario.ancestry ?? "0", REQUESTED_DEPLOYED_SHA: scenario.requested,
        HOSTED_WEB_VERCEL_TOKEN: "synthetic-verifier", HOSTED_WEB_VERCEL_PROJECT_ID: "synthetic-project",
        HOSTED_WEB_PRODUCTION_BASE_URL: "https://www.withmurph.ai", GITHUB_OUTPUT: output,
      } });
      assert.equal(result.status, scenario.expected, result.stderr);
      if (scenario.expected === 0) assert.equal((await readFile(output, "utf8")).trim(), `deployed_sha=${deployedSha}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
