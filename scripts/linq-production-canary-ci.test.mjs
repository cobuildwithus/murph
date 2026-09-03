import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/linq-production-canary.yml",
  import.meta.url,
);
const runnerPath = new URL(
  "../apps/web/scripts/run-production-conversation-canary.ts",
  import.meta.url,
);

test("Linq production canary admits only verified serialized production deployments", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /deployment_status:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /pull_request:|\npush:|\nschedule:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /group: linq-production-canary/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /vercel\[bot\]/u);
  assert.match(workflow, /git merge-base --is-ancestor/u);
  assert.match(workflow, /resolve-vercel-production-alias-sha\.ts/u);
  assert.match(workflow, /verify-vercel-production-deployment\.ts/u);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.deployment\.sha \|\| inputs\.deployed_sha \}\}/u,
  );
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

test("Linq production canary runner proves the welcome and three bounded replies without logging content", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /CANARY_REPLY_BUDGET_MS = 20_000/u);
  assert.match(runner, /const CANARY_TURNS = \[/u);
  assert.equal(
    [...runner.matchAll(/^  ".+",$/gmu)].filter(([line]) =>
      !line.includes("The Linq production canary failed")
    ).length,
    3,
  );
  assert.match(runner, /MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE/u);
  assert.match(runner, /message\.direction !== "inbound"/u);
  assert.match(runner, /message\.platform !== "imessage"/u);
  assert.match(runner, /message\.sender\?\.id !== input\.userId/u);
  assert.match(runner, /space\.id !== input\.spaceId/u);
  assert.match(runner, /const code = error instanceof Error \? error\.name : "unknown";\s+console\.error\(`Linq production canary failed \(\$\{code\}\)\.`\);/u);
  assert.doesNotMatch(runner, /console\.(?:log|info)\([^\n]*(?:reply|prompt|phone)/u);
});
