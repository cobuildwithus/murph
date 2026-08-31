import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { getGeneratedHealthCommonsWebGoalIndex } from "@murphai/health-commons/runtime";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";

import { registerGoalCommands } from "../src/commands/health-goal-save.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import {
  createTempVaultContext,
  type InProcessCliJsonResult,
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>;
    required?: string[];
  };
  options: {
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface GoalSaveResult {
  vault: string;
  goalId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

interface GoalShowResult {
  entity: {
    data: {
      title: string;
      status: string;
      commonsGoalRef?: {
        key: string;
        pageRevisionId: string;
        workflowSpecRevisionId: string;
      };
    };
  };
}

interface GoalListResult {
  count: number;
  items: Array<{
    id: string;
  }>;
}

interface RawCliResult {
  exitCode: number | null;
  output: string;
}

const commonsGoal = getGeneratedHealthCommonsWebGoalIndex().goals.find(
  (goal) => goal.key === "goal_template:sleep-better",
);
if (!commonsGoal) {
  throw new Error("Expected the packaged sleep-better Goal guide.");
}
const commonsPageRevisionId = commonsGoal.revision.pageRevisionId;
const commonsWorkflowRevisionId = commonsGoal.revision.workflowSpecRevisionId;

function changeRevision(revision: string): string {
  return `${revision.slice(0, -1)}${revision.endsWith("0") ? "1" : "0"}`;
}

function createGoalCli() {
  const cli = Cli.create("vault-cli", {
    description: "goal typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createIntegratedVaultServices();
  registerGoalCommands(cli, services);

  return cli;
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<RawCliResult> {
  const output: string[] = [];
  let exitCode: number | null = null;

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code;
    },
    stdout(chunk) {
      output.push(chunk);
    },
  });

  return {
    exitCode,
    output: output.join("").trim(),
  };
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  const result = await runRawInProcessCli(cli, [
    ...commandArgs,
    "--schema",
    "--format",
    "json",
  ]);
  assert.equal(result.exitCode, null);

  return JSON.parse(result.output) as CommandSchemaEnvelope;
}

async function readMissingCommandSchemaExitCode(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<number | null> {
  const result = await runRawInProcessCli(cli, [
    ...commandArgs,
    "--schema",
    "--format",
    "json",
  ]);

  return result.exitCode;
}

async function assertCommandSchemaMissing(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<void> {
  assert.equal(await readMissingCommandSchemaExitCode(cli, commandArgs), 1);
}

async function assertJsonImportSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<void> {
  const schema = await readCommandSchema(cli, commandArgs);
  assert.equal("input" in schema.options.properties, true);
  assert.equal(schema.options.required?.includes("input") ?? false, true);
  assert.deepEqual(schema.args.required ?? [], []);
}

async function readGoalSaveHelp(cli: Cli.Cli): Promise<string> {
  const result = await runRawInProcessCli(cli, ["goal", "save", "--help"]);
  assert.equal(result.exitCode, null);

  return result.output;
}

async function readAuditSnapshot(vaultRoot: string): Promise<string[]> {
  const auditRoot = path.join(vaultRoot, "audit");
  const entries = await readdir(auditRoot, { recursive: true });
  const files = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    files.map((relativePath) =>
      readFile(path.join(auditRoot, relativePath), "utf8")
    ),
  );
}

function requireSavedPath(result: GoalSaveResult): string {
  if (!result.path) {
    throw new Error("Expected goal save result to include a relative path.");
  }

  return result.path;
}

test("goal save schema exposes typed fields while goal import-json remains the JSON fallback", async () => {
  const cli = createGoalCli();

  const goalSave = await readCommandSchema(cli, ["goal", "save"]);
  assert.deepEqual(goalSave.args.required ?? [], []);
  assert.equal("title" in goalSave.args.properties, true);
  assert.equal("input" in goalSave.options.properties, false);
  assert.equal(goalSave.options.required?.includes("input") ?? false, false);

  for (const field of [
    "id",
    "slug",
    "status",
    "horizon",
    "priority",
    "startAt",
    "targetAt",
    "parentGoalId",
    "relatedGoalId",
    "relatedExperimentId",
    "commonsGoalKey",
    "commonsPageRevisionId",
    "commonsWorkflowRevisionId",
    "domain",
  ]) {
    assert.equal(field in goalSave.options.properties, true, field);
  }

  await assertJsonImportSchema(cli, ["goal", "import-json"]);
  await assertCommandSchemaMissing(cli, ["goal", "upsert"]);

  const help = await readGoalSaveHelp(cli);
  assert.match(help, /goal import-json/u);
  assert.doesNotMatch(help, /goal upsert/u);
});

test("goal save persists typed fields and repeated relationships", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-save-",
  );

  try {
    const cli = createGoalCli();

    await initializeVault({ vaultRoot });

    const parentGoal = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Improve sleep quality",
      "--slug",
      "improve-sleep-quality",
      "--vault",
      vaultRoot,
    ]);
    const relatedGoal = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Lift consistently",
      "--slug",
      "lift-consistently",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(parentGoal.exitCode, null);
    assert.equal(relatedGoal.exitCode, null);

    const savedChild = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Recover better",
      "--slug",
      "recover-better",
      "--status",
      "active",
      "--horizon",
      "medium_term",
      "--priority",
      "3",
      "--start-at",
      "2026-04-01",
      "--target-at",
      "2026-06-01",
      "--parent-goal-id",
      requireData(parentGoal.envelope).goalId,
      "--related-goal-id",
      requireData(relatedGoal.envelope).goalId,
      "--related-experiment-id",
      "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
      "--commons-goal-key",
      "goal_template:sleep-better",
      "--commons-page-revision-id",
      commonsPageRevisionId,
      "--commons-workflow-revision-id",
      commonsWorkflowRevisionId,
      "--domain",
      "sleep",
      "--domain",
      "recovery",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(savedChild.exitCode, null);

    const saved = requireData(savedChild.envelope);
    assert.equal(saved.created, true);
    assert.equal(saved.lookupId, saved.goalId);

    const shownChild = await runInProcessJsonCli<GoalShowResult>(cli, [
      "goal",
      "show",
      saved.goalId,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shownChild.exitCode, null, JSON.stringify(shownChild.envelope));
    assert.deepEqual(
      requireData(shownChild.envelope).entity.data.commonsGoalRef,
      {
        key: "goal_template:sleep-better",
        pageRevisionId: commonsPageRevisionId,
        workflowSpecRevisionId: commonsWorkflowRevisionId,
      },
    );

    const markdown = await readFile(
      path.join(vaultRoot, requireSavedPath(saved)),
      "utf8",
    );
    const document = parseFrontmatterDocument(markdown);
    assert.equal(document.attributes.title, "Recover better");
    assert.equal(document.attributes.status, "active");
    assert.equal(document.attributes.horizon, "medium_term");
    assert.equal(document.attributes.priority, 3);
    assert.deepEqual(document.attributes.window, {
      startAt: "2026-04-01",
      targetAt: "2026-06-01",
    });
    assert.equal(
      document.attributes.parentGoalId,
      requireData(parentGoal.envelope).goalId,
    );
    assert.deepEqual(document.attributes.relatedGoalIds, [
      requireData(relatedGoal.envelope).goalId,
    ]);
    assert.deepEqual(document.attributes.relatedExperimentIds, [
      "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.deepEqual(document.attributes.commonsGoalRef, {
      key: "goal_template:sleep-better",
      pageRevisionId: commonsPageRevisionId,
      workflowSpecRevisionId: commonsWorkflowRevisionId,
    });
    assert.deepEqual(document.attributes.domains, ["recovery", "sleep"]);

    const updated = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Recover fully",
      "--id",
      saved.goalId,
      "--priority",
      "4",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(updated.exitCode, null);
    assert.equal(requireData(updated.envelope).created, false);

    const updatedMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(requireData(updated.envelope))),
      "utf8",
    );
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown);
    assert.equal(updatedDocument.attributes.title, "Recover fully");
    assert.equal(updatedDocument.attributes.priority, 4);
    assert.deepEqual(updatedDocument.attributes.domains, ["recovery", "sleep"]);
    assert.equal(
      updatedDocument.attributes.parentGoalId,
      requireData(parentGoal.envelope).goalId,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("goal save rejects comma-delimited repeatable fields", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-save-repeatable-",
  );

  try {
    const cli = createGoalCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Sleep longer",
      "--domain",
      "sleep,recovery",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /--domain/u);
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("goal save requires a complete Health Commons lineage tuple", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-lineage-",
  );

  try {
    const cli = createGoalCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Sleep better",
      "--commons-goal-key",
      "goal_template:sleep-better",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /must be provided together/u);
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("goal save rejects missing and stale Health Commons lineage before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-lineage-cas-",
  );

  try {
    const cli = createGoalCli();
    await initializeVault({ vaultRoot });

    const missing = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Missing public goal",
      "--commons-goal-key",
      "goal_template:missing-public-goal",
      "--commons-page-revision-id",
      commonsPageRevisionId,
      "--commons-workflow-revision-id",
      commonsWorkflowRevisionId,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.envelope.ok, false);
    if (!missing.envelope.ok) {
      assert.equal(missing.envelope.error.code, "commons_goal_not_found");
      assert.match(missing.envelope.error.message ?? "", /Show the goal again/u);
    }

    for (const [pageRevisionId, workflowRevisionId] of [
      [changeRevision(commonsPageRevisionId), commonsWorkflowRevisionId],
      [commonsPageRevisionId, changeRevision(commonsWorkflowRevisionId)],
    ]) {
      const staleResult: InProcessCliJsonResult<GoalSaveResult> =
        await runInProcessJsonCli<GoalSaveResult>(cli, [
          "goal",
          "save",
          "Sleep better",
          "--commons-goal-key",
          commonsGoal.key,
          "--commons-page-revision-id",
          pageRevisionId,
          "--commons-workflow-revision-id",
          workflowRevisionId,
          "--vault",
          vaultRoot,
        ]);
      assert.equal(staleResult.exitCode, 1);
      assert.equal(staleResult.envelope.ok, false);
      if (!staleResult.envelope.ok) {
        assert.equal(staleResult.envelope.error.code, "invalid_option");
        assert.match(
          staleResult.envelope.error.message ?? "",
          /changed after this setup was prepared/u,
        );
      }
    }

    const listed = await runInProcessJsonCli<GoalListResult>(cli, [
      "goal",
      "list",
      "--limit",
      "200",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(listed.exitCode, null);
    assert.equal(requireData(listed.envelope).count, 0);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("goal import-json cannot create public Goal lineage", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-import-lineage-",
  );

  try {
    const cli = createGoalCli();
    await initializeVault({ vaultRoot });
    const auditBefore = await readAuditSnapshot(vaultRoot);
    const payloadPath = path.join(parentRoot, "goal-with-public-lineage.json");
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Forged public goal",
        commonsGoalRef: {
          key: commonsGoal.key,
          pageRevisionId: commonsPageRevisionId,
          workflowSpecRevisionId: commonsWorkflowRevisionId,
        },
      }),
      "utf8",
    );

    const imported = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(imported.exitCode, 1);
    assert.equal(imported.envelope.ok, false);
    if (!imported.envelope.ok) {
      assert.equal(imported.envelope.error.code, "invalid_payload");
    }

    const listed = await runInProcessJsonCli<GoalListResult>(cli, [
      "goal",
      "list",
      "--limit",
      "200",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(listed.exitCode, null);
    assert.equal(requireData(listed.envelope).count, 0);
    assert.deepEqual(await readAuditSnapshot(vaultRoot), auditBefore);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("goal save pauses and resumes by id without overwriting the latest title", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-lifecycle-",
  );

  try {
    const cli = createGoalCli();
    await initializeVault({ vaultRoot });

    const missingTitle = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(missingTitle.exitCode, 1);
    assert.equal(missingTitle.envelope.ok, false);
    if (!missingTitle.envelope.ok) {
      assert.equal(missingTitle.envelope.error.code, "invalid_option");
      assert.match(missingTitle.envelope.error.message ?? "", /title is required/u);
    }
    const emptyList = await runInProcessJsonCli<GoalListResult>(cli, [
      "goal",
      "list",
      "--limit",
      "200",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(emptyList.exitCode, null);
    assert.equal(requireData(emptyList.envelope).count, 0);

    const created = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Improve my deep sleep",
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(created.exitCode, null);
    const goalId = requireData(created.envelope).goalId;

    const renamed = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Improve sleep depth",
      "--id",
      goalId,
      "--vault",
      vaultRoot,
    ]);
    assert.equal(renamed.exitCode, null);

    for (const status of ["paused", "active"] as const) {
      const saved = await runInProcessJsonCli<GoalSaveResult>(cli, [
        "goal",
        "save",
        "--id",
        goalId,
        "--status",
        status,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(saved.exitCode, null);
      assert.equal(requireData(saved.envelope).created, false);
      assert.equal(requireData(saved.envelope).goalId, goalId);

      const shown = await runInProcessJsonCli<GoalShowResult>(cli, [
        "goal",
        "show",
        goalId,
        "--vault",
        vaultRoot,
      ]);
      assert.equal(shown.exitCode, null, JSON.stringify(shown.envelope));
      assert.equal(requireData(shown.envelope).entity.data.status, status);
      assert.equal(
        requireData(shown.envelope).entity.data.title,
        "Improve sleep depth",
      );
    }

    const listed = await runInProcessJsonCli<GoalListResult>(cli, [
      "goal",
      "list",
      "--limit",
      "200",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(listed.exitCode, null);
    assert.equal(requireData(listed.envelope).count, 1);
    assert.deepEqual(
      requireData(listed.envelope).items.map(({ id }) => id),
      [goalId],
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
