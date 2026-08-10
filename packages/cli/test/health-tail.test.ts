import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createVaultCli } from "../src/vault-cli.js";
import { localParallelCliTest as test } from "./local-parallel-test.js";
import { requireData, runCli, runInProcessJsonCli } from "./cli-test-helpers.js";

test("intake show and intake list route assessment reads through the noun-specific commands", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await mkdir(path.join(vaultRoot, "ledger/assessments/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: "asmt_cli_01",
        assessmentType: "full-intake",
        recordedAt: "2026-03-12T13:00:00Z",
        source: "import",
        rawPath: "raw/assessments/2026/03/asmt_cli_01/source.json",
        title: "CLI intake fixture",
        responses: {
          sleep: {
            averageHours: 6,
          },
        },
      })}\n`,
      "utf8",
    );

    const showResult = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "intake",
      "show",
      "asmt_cli_01",
      "--vault",
      vaultRoot,
    ]);
    const listResult = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      }>;
    }>([
      "intake",
      "list",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(showResult.ok, true);
    assert.equal(requireData(showResult).entity.id, "asmt_cli_01");
    assert.equal(requireData(showResult).entity.kind, "assessment");
    assert.equal(requireData(showResult).entity.data.assessmentType, "full-intake");
    assert.equal(listResult.ok, true);
    assert.equal(requireData(listResult).count, 1);
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.id),
      ["asmt_cli_01"],
    );
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.kind),
      ["assessment"],
    );
    assert.equal(requireData(listResult).items[0]?.data.assessmentType, "full-intake");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}, 120_000);

test("intake list applies date bounds and echoes renamed filter keys", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await mkdir(path.join(vaultRoot, "ledger/assessments/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
      [
        JSON.stringify({
          schemaVersion: "murph.assessment-response.v1",
          id: "asmt_cli_out_of_range",
          assessmentType: "full-intake",
          recordedAt: "2026-03-10T13:00:00Z",
          source: "import",
          rawPath: "raw/assessments/2026/03/asmt_cli_out_of_range/source.json",
          title: "Outside the requested range",
          responses: {
            sleep: {
              averageHours: 5,
            },
          },
        }),
        JSON.stringify({
          schemaVersion: "murph.assessment-response.v1",
          id: "asmt_cli_in_range",
          assessmentType: "full-intake",
          recordedAt: "2026-03-12T13:00:00Z",
          source: "import",
          rawPath: "raw/assessments/2026/03/asmt_cli_in_range/source.json",
          title: "Inside the requested range",
          responses: {
            sleep: {
              averageHours: 7,
            },
          },
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const listResult = await runCli<{
      count: number;
      filters: Record<string, unknown>;
      items: Array<{
        id: string;
      }>;
    }>([
      "intake",
      "list",
      "--from",
      "2026-03-12",
      "--to",
      "2026-03-12",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(listResult.ok, true);
    assert.equal(requireData(listResult).filters.from, "2026-03-12");
    assert.equal(requireData(listResult).filters.to, "2026-03-12");
    assert.equal("dateFrom" in requireData(listResult).filters, false);
    assert.equal("dateTo" in requireData(listResult).filters, false);
    assert.equal(requireData(listResult).count, 1);
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.id),
      ["asmt_cli_in_range"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("intake list rejects the removed assessment status filter", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));

  try {
    await runCli(["init", "--vault", vaultRoot]);

    const result = await runCli([
      "intake",
      "list",
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.ok, false);
    assert.match(
      result.error.message ?? "",
      /status|unknown option|unexpected option/i,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("goal descriptor wiring keeps noun-specific and generic reads aligned", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "goal.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Sleep longer",
        status: "active",
        horizon: "long_term",
        domains: ["sleep"],
      }),
      "utf8",
    );

    const upsertResult = await runCli<{
      goalId: string;
    }>([
      "goal",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalId = requireData(upsertResult).goalId;

    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      };
    }>([
      "goal",
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "goal",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
      };
    }>([
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);
    const genericList = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "list",
      "--kind",
      "goal",
      "--vault",
      vaultRoot,
    ]);
    const genericUnfilteredList = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "list",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(nounList.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(genericList.ok, true);
    assert.equal(genericUnfilteredList.ok, true);
    assert.equal(requireData(genericShow).entity.id, goalId);
    assert.equal(requireData(genericShow).entity.kind, "goal");
    assert.equal(requireData(nounShow).entity.id, goalId);
    assert.equal(requireData(nounShow).entity.kind, "goal");
    assert.equal(requireData(nounShow).entity.data.status, "active");
    assert.deepEqual(requireData(nounShow).entity.data.domains, ["sleep"]);
    assert.equal(requireData(nounShow).entity.links.length, 0);
    assert.equal(requireData(nounList).count, 1);
    assert.deepEqual(
      requireData(nounList).items.map((item) => item.id),
      [goalId],
    );
    assert.equal(requireData(nounList).items[0]?.data.status, "active");
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.id),
      [goalId],
    );
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.kind),
      ["goal"],
    );
    assert.deepEqual(
      requireData(genericUnfilteredList).items.map((item) => item.id),
      [goalId],
    );
    assert.deepEqual(
      requireData(genericUnfilteredList).items.map((item) => item.kind),
      ["goal"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("goal show projects shared Goal relations through the noun-specific CLI surface", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const parentPayloadPath = path.join(vaultRoot, "goal-parent.json");
  const relatedPayloadPath = path.join(vaultRoot, "goal-related.json");
  const childPayloadPath = path.join(vaultRoot, "goal-child.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      parentPayloadPath,
      JSON.stringify({
        title: "Sleep longer",
      }),
      "utf8",
    );
    await writeFile(
      relatedPayloadPath,
      JSON.stringify({
        title: "Lift consistently",
      }),
      "utf8",
    );

    const parentUpsert = await runCli<{
      goalId: string;
    }>([
      "goal",
      "import-json",
      "--input",
      `@${parentPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const relatedUpsert = await runCli<{
      goalId: string;
    }>([
      "goal",
      "import-json",
      "--input",
      `@${relatedPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    await writeFile(
      childPayloadPath,
      JSON.stringify({
        title: "Recover better",
        parentGoalId: requireData(parentUpsert).goalId,
        relatedGoalIds: [requireData(relatedUpsert).goalId],
        relatedExperimentIds: ["exp_01JNY0B2W4VG5C2A0G9S8M7R6S"],
        domains: ["sleep"],
      }),
      "utf8",
    );

    const childUpsert = await runCli<{
      goalId: string;
    }>([
      "goal",
      "import-json",
      "--input",
      `@${childPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalId = requireData(childUpsert).goalId;

    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      };
    }>([
      "goal",
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        links: Array<{ id: string }>;
      };
    }>([
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(nounShow.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(nounShow).entity.id, goalId);
    assert.equal(requireData(nounShow).entity.kind, "goal");
    assert.equal(requireData(nounShow).entity.data.parentGoalId, requireData(parentUpsert).goalId);
    assert.deepEqual(requireData(nounShow).entity.data.relatedGoalIds, [requireData(relatedUpsert).goalId]);
    assert.deepEqual(requireData(nounShow).entity.data.relatedExperimentIds, [
      "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.deepEqual(requireData(nounShow).entity.data.domains, ["sleep"]);
    assert.deepEqual(
      requireData(nounShow).entity.links.map((link) => link.id).sort(),
      [
        "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
        requireData(parentUpsert).goalId,
        requireData(relatedUpsert).goalId,
      ].sort(),
    );
    assert.deepEqual(
      requireData(genericShow).entity.links.map((link) => link.id).sort(),
      requireData(nounShow).entity.links.map((link) => link.id).sort(),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("goal import-json rejects reserved vault-root overrides from JSON payloads", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const redirectVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "goal-override.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await runCli(["init", "--vault", redirectVaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        vaultRoot: redirectVaultRoot,
        title: "Redirect writes outside the chosen vault",
        status: "active",
        horizon: "long_term",
      }),
      "utf8",
    );

    const upsertResult = await runCli([
      "goal",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const redirectList = await runCli<{
      items: Array<{ id: string }>;
    }>([
      "goal",
      "list",
      "--vault",
      redirectVaultRoot,
    ]);

    assert.equal(upsertResult.ok, false);
    assert.equal(upsertResult.error?.code, "invalid_payload");
    assert.equal(redirectList.ok, true);
    assert.deepEqual(requireData(redirectList).items, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
    await rm(redirectVaultRoot, { recursive: true, force: true });
  }
});

test("goal import-json preserves omitted fields on patch updates", async () => {
  const cli = createVaultCli();
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const createPayloadPath = path.join(vaultRoot, "goal-create.json");
  const patchPriorityPayloadPath = path.join(vaultRoot, "goal-patch-priority.json");
  const patchTitlePayloadPath = path.join(vaultRoot, "goal-patch-title.json");

  try {
    await runInProcessJsonCli(cli, ["init", "--vault", vaultRoot]);
    await writeFile(
      createPayloadPath,
      JSON.stringify({
        title: "Sleep longer",
        status: "completed",
        horizon: "short_term",
      }),
      "utf8",
    );

    const { envelope: created } = await runInProcessJsonCli<{
      goalId: string;
    }>(cli, [
      "goal",
      "import-json",
      "--input",
      `@${createPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalId = requireData(created).goalId;

    await writeFile(
      patchPriorityPayloadPath,
      JSON.stringify({
        goalId,
        priority: 2,
      }),
      "utf8",
    );

    const { envelope: patchPriority } = await runInProcessJsonCli(cli, [
      "goal",
      "import-json",
      "--input",
      `@${patchPriorityPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    await writeFile(
      patchTitlePayloadPath,
      JSON.stringify({
        goalId,
        title: "Sleep deeper",
      }),
      "utf8",
    );

    const { envelope: patchTitle } = await runInProcessJsonCli(cli, [
      "goal",
      "import-json",
      "--input",
      `@${patchTitlePayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const { envelope: shown } = await runInProcessJsonCli<{
      entity: {
        id: string;
        data: Record<string, unknown>;
      };
    }>(cli, [
      "goal",
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(created.ok, true);
    assert.equal(patchPriority.ok, true);
    assert.equal(patchTitle.ok, true);
    assert.equal(shown.ok, true);
    assert.equal(requireData(shown).entity.id, goalId);
    assert.equal(requireData(shown).entity.data.title, "Sleep deeper");
    assert.equal(requireData(shown).entity.data.status, "completed");
    assert.equal(requireData(shown).entity.data.horizon, "short_term");
    assert.equal(requireData(shown).entity.data.priority, 2);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("goal import-json preserves the nutrition proposal window, sibling targets, and paused replacement", async () => {
  const cli = createVaultCli();
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const createPayloadPath = path.join(vaultRoot, "nutrition-goal-create.json");
  const editPayloadPath = path.join(vaultRoot, "nutrition-goal-edit.json");
  const removePayloadPath = path.join(vaultRoot, "nutrition-goal-remove.json");
  const restorePayloadPath = path.join(vaultRoot, "nutrition-goal-restore.json");
  const proposalStartAt = "2026-08-09";
  const target = (
    targetId: string,
    metricKey: string,
    unit: string,
    value: number,
  ) => ({
    targetId,
    kind: "metric",
    metricKey,
    comparator: "between",
    value,
    highValue: value,
    unit,
    evaluation: { kind: "selected-value" },
  });
  const originalTargets = [
    target("murph-default-dietary-calories", "dietary-calories", "kcal", 2_400),
    target("murph-default-protein-grams", "protein-grams", "g", 150),
    target("murph-default-carbs-grams", "carbs-grams", "g", 270),
    target("murph-default-fat-grams", "fat-grams", "g", 80),
    target("murph-default-fiber-grams", "fiber-grams", "g", 35),
  ];

  try {
    await runInProcessJsonCli(cli, ["init", "--vault", vaultRoot]);
    await writeFile(
      createPayloadPath,
      JSON.stringify({
        title: "Daily nutrition targets",
        slug: "murph-daily-nutrition-starting-targets",
        status: "paused",
        horizon: "ongoing",
        domains: ["nutrition"],
        window: { startAt: proposalStartAt },
        metricTargets: originalTargets,
      }),
      "utf8",
    );
    const { envelope: created } = await runInProcessJsonCli<{
      goalId: string;
    }>(cli, [
      "goal",
      "import-json",
      "--input",
      `@${createPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalId = requireData(created).goalId;
    const editedTargets = originalTargets.map((entry) =>
      entry.metricKey === "protein-grams"
        ? { ...entry, value: 155, highValue: 155 }
        : entry,
    );

    await writeFile(
      editPayloadPath,
      JSON.stringify({ goalId, status: "paused", metricTargets: editedTargets }),
      "utf8",
    );
    const { envelope: edited } = await runInProcessJsonCli(cli, [
      "goal",
      "import-json",
      "--input",
      `@${editPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const { envelope: shownAfterEdit } = await runInProcessJsonCli<{
      entity: {
        data: {
          status: string;
          windowStartAt: string | null;
          metricTargets: typeof editedTargets;
        };
      };
    }>(cli, ["goal", "show", goalId, "--vault", vaultRoot]);

    assert.equal(edited.ok, true);
    assert.equal(requireData(shownAfterEdit).entity.data.status, "paused");
    assert.equal(
      requireData(shownAfterEdit).entity.data.windowStartAt,
      proposalStartAt,
    );
    assert.deepEqual(
      requireData(shownAfterEdit).entity.data.metricTargets,
      editedTargets,
    );

    const { envelope: activated } = await runInProcessJsonCli(cli, [
      "goal",
      "save",
      "Daily nutrition targets",
      "--id",
      goalId,
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(activated.ok, true);
    const { envelope: shownAfterActivation } = await runInProcessJsonCli<{
      entity: {
        data: {
          status: string;
          windowStartAt: string | null;
          metricTargets: typeof editedTargets;
        };
      };
    }>(cli, ["goal", "show", goalId, "--vault", vaultRoot]);
    assert.equal(requireData(shownAfterActivation).entity.data.status, "active");
    assert.equal(
      requireData(shownAfterActivation).entity.data.windowStartAt,
      proposalStartAt,
    );

    const retainedTargets = editedTargets.filter(
      (entry) => entry.metricKey !== "protein-grams",
    );
    await writeFile(
      removePayloadPath,
      JSON.stringify({ goalId, metricTargets: retainedTargets }),
      "utf8",
    );
    const { envelope: removed } = await runInProcessJsonCli(cli, [
      "goal",
      "import-json",
      "--input",
      `@${removePayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const { envelope: shownAfterRemoval } = await runInProcessJsonCli<{
      entity: { data: { status: string; metricTargets: typeof retainedTargets } };
    }>(cli, ["goal", "show", goalId, "--vault", vaultRoot]);

    assert.equal(removed.ok, true);
    assert.equal(requireData(shownAfterRemoval).entity.data.status, "active");
    assert.deepEqual(
      requireData(shownAfterRemoval).entity.data.metricTargets,
      retainedTargets,
    );

    const restoredTargets = editedTargets.map((entry) =>
      entry.metricKey === "protein-grams"
        ? { ...entry, value: 160, highValue: 160 }
        : entry,
    );
    await writeFile(
      restorePayloadPath,
      JSON.stringify({
        goalId,
        status: "paused",
        metricTargets: restoredTargets,
      }),
      "utf8",
    );
    const { envelope: restored } = await runInProcessJsonCli(cli, [
      "goal",
      "import-json",
      "--input",
      `@${restorePayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const { envelope: shownAfterRestore } = await runInProcessJsonCli<{
      entity: {
        data: {
          status: string;
          windowStartAt: string | null;
          metricTargets: typeof restoredTargets;
        };
      };
    }>(cli, ["goal", "show", goalId, "--vault", vaultRoot]);

    assert.equal(restored.ok, true);
    assert.equal(requireData(shownAfterRestore).entity.data.status, "paused");
    assert.equal(
      requireData(shownAfterRestore).entity.data.windowStartAt,
      proposalStartAt,
    );
    assert.deepEqual(
      requireData(shownAfterRestore).entity.data.metricTargets,
      restoredTargets,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("goal import-json validates payloads through the shared goal schema", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "goal-invalid.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Sleep longer",
        parentGoalId: "not-a-goal-id",
      }),
      "utf8",
    );

    const upsertResult = await runCli([
      "goal",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, false);
    assert.equal(upsertResult.error?.code, "invalid_payload");
    assert.match(upsertResult.error?.message ?? "", /goal payload failed validation/i);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("condition and allergy commands keep noun-specific and generic reads aligned", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const conditionPayloadPath = path.join(vaultRoot, "condition.json");
  const allergyPayloadPath = path.join(vaultRoot, "allergy.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      conditionPayloadPath,
      JSON.stringify({
        title: "Seasonal allergies",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        assertedOn: "2026-03-12",
      }),
      "utf8",
    );
    await writeFile(
      allergyPayloadPath,
      JSON.stringify({
        title: "Peanut allergy",
        substance: "Peanut",
        status: "active",
        reaction: "Hives",
      }),
      "utf8",
    );

    const conditionUpsert = await runCli<{
      conditionId: string;
    }>([
      "condition",
      "import-json",
      "--input",
      `@${conditionPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const allergyUpsert = await runCli<{
      allergyId: string;
    }>([
      "allergy",
      "import-json",
      "--input",
      `@${allergyPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    const conditionId = requireData(conditionUpsert).conditionId;
    const allergyId = requireData(allergyUpsert).allergyId;

    const conditionShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "condition",
      "show",
      conditionId,
      "--vault",
      vaultRoot,
    ]);
    const allergyShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "allergy",
      "show",
      allergyId,
      "--vault",
      vaultRoot,
    ]);
    const genericConditionList = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "list",
      "--kind",
      "condition",
      "--vault",
      vaultRoot,
    ]);
    const genericAllergyList = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "list",
      "--kind",
      "allergy",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(conditionUpsert.ok, true);
    assert.equal(allergyUpsert.ok, true);
    assert.equal(conditionShow.ok, true);
    assert.equal(allergyShow.ok, true);
    assert.equal(requireData(conditionShow).entity.id, conditionId);
    assert.equal(requireData(conditionShow).entity.kind, "condition");
    assert.equal(requireData(conditionShow).entity.data.clinicalStatus, "active");
    assert.equal(requireData(allergyShow).entity.id, allergyId);
    assert.equal(requireData(allergyShow).entity.kind, "allergy");
    assert.equal(requireData(allergyShow).entity.data.substance, "Peanut");
    assert.deepEqual(
      requireData(genericConditionList).items.map((item) => item.id),
      [conditionId],
    );
    assert.deepEqual(
      requireData(genericConditionList).items.map((item) => item.kind),
      ["condition"],
    );
    assert.deepEqual(
      requireData(genericAllergyList).items.map((item) => item.id),
      [allergyId],
    );
    assert.deepEqual(
      requireData(genericAllergyList).items.map((item) => item.kind),
      ["allergy"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("condition and allergy import-json validate payloads through the shared schemas", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const conditionPayloadPath = path.join(vaultRoot, "condition-invalid.json");
  const conditionMissingTitlePath = path.join(vaultRoot, "condition-missing-title.json");
  const allergyPayloadPath = path.join(vaultRoot, "allergy-invalid.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      conditionPayloadPath,
      JSON.stringify({
        title: "Migraine",
        relatedGoalIds: ["not-a-goal-id"],
      }),
      "utf8",
    );
    await writeFile(
      allergyPayloadPath,
      JSON.stringify({
        title: "Peanut allergy",
        substance: "Peanut",
        relatedConditionIds: ["not-a-condition-id"],
      }),
      "utf8",
    );
    await writeFile(
      conditionMissingTitlePath,
      JSON.stringify({
        clinicalStatus: "active",
      }),
      "utf8",
    );

    const conditionUpsertResult = await runCli([
      "condition",
      "import-json",
      "--input",
      `@${conditionPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const conditionMissingTitleResult = await runCli([
      "condition",
      "import-json",
      "--input",
      `@${conditionMissingTitlePath}`,
      "--vault",
      vaultRoot,
    ]);
    const allergyUpsertResult = await runCli([
      "allergy",
      "import-json",
      "--input",
      `@${allergyPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(conditionUpsertResult.ok, false);
    assert.equal(conditionUpsertResult.error?.code, "invalid_payload");
    assert.match(conditionUpsertResult.error?.message ?? "", /condition payload failed validation/i);
    assert.equal(conditionMissingTitleResult.ok, false);
    assert.equal(conditionMissingTitleResult.error?.code, "invalid_payload");
    assert.match(conditionMissingTitleResult.error?.message ?? "", /condition payload failed validation/i);
    assert.equal(allergyUpsertResult.ok, false);
    assert.equal(allergyUpsertResult.error?.code, "invalid_payload");
    assert.match(allergyUpsertResult.error?.message ?? "", /allergy payload failed validation/i);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("condition, allergy, and family patch upserts preserve omitted create-only fields", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const conditionCreatePath = path.join(vaultRoot, "condition-create.json");
  const conditionPatchPath = path.join(vaultRoot, "condition-patch.json");
  const allergyCreatePath = path.join(vaultRoot, "allergy-create.json");
  const allergyPatchPath = path.join(vaultRoot, "allergy-patch.json");
  const familyCreatePath = path.join(vaultRoot, "family-create.json");
  const familyPatchPath = path.join(vaultRoot, "family-patch.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);

    await writeFile(
      conditionCreatePath,
      JSON.stringify({
        title: "Migraine",
        clinicalStatus: "active",
      }),
      "utf8",
    );
    const conditionCreated = await runCli<{
      conditionId: string;
    }>([
      "condition",
      "import-json",
      "--input",
      `@${conditionCreatePath}`,
      "--vault",
      vaultRoot,
    ]);
    const conditionId = requireData(conditionCreated).conditionId;

    await writeFile(
      conditionPatchPath,
      JSON.stringify({
        conditionId,
        note: "Patch update preserved the title.",
      }),
      "utf8",
    );
    const conditionPatched = await runCli([
      "condition",
      "import-json",
      "--input",
      `@${conditionPatchPath}`,
      "--vault",
      vaultRoot,
    ]);
    const conditionShown = await runCli<{
      entity: {
        data: Record<string, unknown>;
      };
    }>([
      "condition",
      "show",
      conditionId,
      "--vault",
      vaultRoot,
    ]);

    await writeFile(
      allergyCreatePath,
      JSON.stringify({
        title: "Peanut allergy",
        substance: "Peanut",
      }),
      "utf8",
    );
    const allergyCreated = await runCli<{
      allergyId: string;
    }>([
      "allergy",
      "import-json",
      "--input",
      `@${allergyCreatePath}`,
      "--vault",
      vaultRoot,
    ]);
    const allergyId = requireData(allergyCreated).allergyId;

    await writeFile(
      allergyPatchPath,
      JSON.stringify({
        allergyId,
        note: "Patch update preserved the substance.",
      }),
      "utf8",
    );
    const allergyPatched = await runCli([
      "allergy",
      "import-json",
      "--input",
      `@${allergyPatchPath}`,
      "--vault",
      vaultRoot,
    ]);
    const allergyShown = await runCli<{
      entity: {
        data: Record<string, unknown>;
      };
    }>([
      "allergy",
      "show",
      allergyId,
      "--vault",
      vaultRoot,
    ]);

    await writeFile(
      familyCreatePath,
      JSON.stringify({
        title: "Mother",
        relationship: "mother",
      }),
      "utf8",
    );
    const familyCreated = await runCli<{
      familyMemberId: string;
    }>([
      "family",
      "import-json",
      "--input",
      `@${familyCreatePath}`,
      "--vault",
      vaultRoot,
    ]);
    const familyMemberId = requireData(familyCreated).familyMemberId;

    await writeFile(
      familyPatchPath,
      JSON.stringify({
        familyMemberId,
        note: "Patch update preserved the relationship.",
      }),
      "utf8",
    );
    const familyPatched = await runCli([
      "family",
      "import-json",
      "--input",
      `@${familyPatchPath}`,
      "--vault",
      vaultRoot,
    ]);
    const familyShown = await runCli<{
      entity: {
        data: Record<string, unknown>;
      };
    }>([
      "family",
      "show",
      familyMemberId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(conditionCreated.ok, true);
    assert.equal(conditionPatched.ok, true);
    assert.equal(conditionShown.ok, true);
    assert.equal(requireData(conditionShown).entity.data.title, "Migraine");
    assert.equal(requireData(conditionShown).entity.data.note, "Patch update preserved the title.");

    assert.equal(allergyCreated.ok, true);
    assert.equal(allergyPatched.ok, true);
    assert.equal(allergyShown.ok, true);
    assert.equal(requireData(allergyShown).entity.data.title, "Peanut allergy");
    assert.equal(requireData(allergyShown).entity.data.substance, "Peanut");
    assert.equal(requireData(allergyShown).entity.data.note, "Patch update preserved the substance.");

    assert.equal(familyCreated.ok, true);
    assert.equal(familyPatched.ok, true);
    assert.equal(familyShown.ok, true);
    assert.equal(requireData(familyShown).entity.data.title, "Mother");
    assert.equal(requireData(familyShown).entity.data.relationship, "mother");
    assert.equal(requireData(familyShown).entity.data.note, "Patch update preserved the relationship.");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("family descriptor wiring keeps member-specific commands aligned with generic health reads", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "family.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Mother",
        relationship: "mother",
        conditions: ["hypertension"],
      }),
      "utf8",
    );

    const upsertResult = await runCli<{
      familyMemberId: string;
    }>([
      "family",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const familyMemberId = requireData(upsertResult).familyMemberId;

    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "family",
      "show",
      familyMemberId,
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "family",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
      };
    }>([
      "show",
      familyMemberId,
      "--vault",
      vaultRoot,
    ]);
    const genericList = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "list",
      "--kind",
      "family",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(nounList.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(genericList.ok, true);
    assert.equal(requireData(genericShow).entity.id, familyMemberId);
    assert.equal(requireData(genericShow).entity.kind, "family");
    assert.equal(requireData(nounShow).entity.id, familyMemberId);
    assert.equal(requireData(nounShow).entity.kind, "family");
    assert.deepEqual(requireData(nounShow).entity.data.conditions, ["hypertension"]);
    assert.equal(requireData(nounList).count, 1);
    assert.deepEqual(
      requireData(nounList).items.map((item) => item.id),
      [familyMemberId],
    );
    assert.deepEqual(requireData(nounList).items[0]?.data.conditions, ["hypertension"]);
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.id),
      [familyMemberId],
    );
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.kind),
      ["family"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("generic family show links ignore the removed familyMemberIds alias", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const familyMemberId = "fam_01JNY0B2W4VG5C2A0G9S8M7R6P";
  const variantId = "var_01JNY0B2W4VG5C2A0G9S8M7R6Q";

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      path.join(vaultRoot, "bank/family/mother.md"),
      `---
schemaVersion: murph.frontmatter.family-member.v1
docType: family_member
familyMemberId: ${familyMemberId}
slug: mother
title: Mother
relationship: mother
relatedVariantIds:
  - ${variantId}
familyMemberIds:
  - var_should_not_leak
---
# Mother

Legacy alias coverage fixture.
`,
      "utf8",
    );

    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        links: Array<{ id: string }>;
      };
    }>([
      "show",
      familyMemberId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(genericShow.ok, true);
    assert.equal(requireData(genericShow).entity.id, familyMemberId);
    assert.equal(requireData(genericShow).entity.kind, "family");
    assert.deepEqual(
      requireData(genericShow).entity.links.map((link) => link.id).sort(),
      [variantId],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("family import-json validates payloads through the shared schema and does not expose a fake status filter", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "family-invalid.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Mother",
        relationship: "mother",
        relatedVariantIds: ["not-a-variant-id"],
      }),
      "utf8",
    );

    const upsertResult = await runCli([
      "family",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const listResult = await runCli([
      "family",
      "list",
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, false);
    assert.equal(upsertResult.error?.code, "invalid_payload");
    assert.match(upsertResult.error?.message ?? "", /family payload failed validation/i);
    assert.equal(listResult.ok, false);
    assert.match(listResult.error?.message ?? "", /status|unknown option|unexpected option/i);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("genetics descriptor wiring keeps variant-specific commands aligned with generic health reads", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "genetics.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "MTHFR C677T",
        gene: "MTHFR",
        significance: "risk_factor",
        sourceFamilyMemberIds: ["fam_01JNY0B2W4VG5C2A0G9S8M7R6P"],
      }),
      "utf8",
    );

    const upsertResult = await runCli<{
      variantId: string;
    }>([
      "genetics",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const variantId = requireData(upsertResult).variantId;

    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      };
    }>([
      "genetics",
      "show",
      variantId,
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "genetics",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
      };
    }>([
      "show",
      variantId,
      "--vault",
      vaultRoot,
    ]);
    const genericList = await runCli<{
      items: Array<{
        id: string;
        kind: string;
      }>;
    }>([
      "list",
      "--kind",
      "genetics",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(nounList.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(genericList.ok, true);
    assert.equal(requireData(genericShow).entity.id, variantId);
    assert.equal(requireData(genericShow).entity.kind, "genetics");
    assert.equal(requireData(nounShow).entity.id, variantId);
    assert.equal(requireData(nounShow).entity.kind, "genetics");
    assert.equal(requireData(nounShow).entity.data.gene, "MTHFR");
    assert.equal(requireData(nounShow).entity.data.significance, "risk_factor");
    assert.deepEqual(
      requireData(nounShow).entity.links.map((link) => link.id),
      ["fam_01JNY0B2W4VG5C2A0G9S8M7R6P"],
    );
    assert.equal(requireData(nounList).count, 1);
    assert.deepEqual(
      requireData(nounList).items.map((item) => item.id),
      [variantId],
    );
    assert.equal(requireData(nounList).items[0]?.data.gene, "MTHFR");
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.id),
      [variantId],
    );
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.kind),
      ["genetics"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("genetics import-json validates payloads through the shared schema and preserves omitted gene values on patch updates", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const createPayloadPath = path.join(vaultRoot, "genetics-create.json");
  const patchPayloadPath = path.join(vaultRoot, "genetics-patch.json");
  const invalidPayloadPath = path.join(vaultRoot, "genetics-invalid.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      createPayloadPath,
      JSON.stringify({
        title: "APOE e4 allele",
        gene: "APOE",
        significance: "risk_factor",
      }),
      "utf8",
    );

    const created = await runCli<{
      variantId: string;
    }>([
      "genetics",
      "import-json",
      "--input",
      `@${createPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const variantId = requireData(created).variantId;

    await writeFile(
      patchPayloadPath,
      JSON.stringify({
        variantId,
        title: "APOE e4 allele updated",
      }),
      "utf8",
    );
    await writeFile(
      invalidPayloadPath,
      JSON.stringify({
        title: "MTHFR C677T",
        gene: "MTHFR",
        sourceFamilyMemberIds: ["not-a-family-member-id"],
      }),
      "utf8",
    );

    const patched = await runCli([
      "genetics",
      "import-json",
      "--input",
      `@${patchPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const shown = await runCli<{
      entity: {
        data: Record<string, unknown>;
      };
    }>([
      "genetics",
      "show",
      variantId,
      "--vault",
      vaultRoot,
    ]);
    const invalid = await runCli([
      "genetics",
      "import-json",
      "--input",
      `@${invalidPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(created.ok, true);
    assert.equal(patched.ok, true);
    assert.equal(shown.ok, true);
    assert.equal(requireData(shown).entity.data.gene, "APOE");
    assert.equal(requireData(shown).entity.data.title, "APOE e4 allele updated");
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error?.code, "invalid_payload");
    assert.match(invalid.error?.message ?? "", /genetics payload failed validation/i);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("regimen commands keep noun-specific and generic reads aligned", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "regimen.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Morning metformin",
        kind: "medication",
        status: "active",
        startedOn: "2026-03-12",
        group: "medication",
        dose: 500,
        unit: "mg",
      }),
      "utf8",
    );

    const upsertResult = await runCli<{
      regimenId: string;
    }>([
      "regimen",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const regimenId = requireData(upsertResult).regimenId;

    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "regimen",
      "show",
      regimenId,
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "regimen",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
      };
    }>([
      "show",
      regimenId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(nounList.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(nounShow).entity.id, regimenId);
    assert.equal(requireData(nounShow).entity.kind, "regimen");
    assert.equal(requireData(nounShow).entity.data.kind, "medication");
    assert.equal(requireData(nounShow).entity.data.group, "medication");
    assert.equal(requireData(nounList).count, 1);
    assert.deepEqual(
      requireData(nounList).items.map((item) => item.id),
      [regimenId],
    );
    assert.equal(requireData(nounList).items[0]?.data.kind, "medication");
    assert.equal(requireData(genericShow).entity.id, regimenId);
    assert.equal(requireData(genericShow).entity.kind, "regimen");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("blood-test descriptor wiring exposes a dedicated noun while preserving the shared event id", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "blood-test.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12T13:00:00.000Z",
        title: "Functional health panel",
        testName: "functional_health_panel",
        labName: "Function Health",
        fastingStatus: "fasting",
        results: [
          {
            analyte: "Apolipoprotein B",
            value: 87,
            unit: "mg/dL",
            flag: "normal",
          },
          {
            analyte: "LDL Cholesterol",
            value: 134,
            unit: "mg/dL",
            flag: "high",
          },
        ],
      }),
      "utf8",
    );

    const importJsonResult = await runCli<{
      eventId: string;
      lookupId: string;
      ledgerFile: string;
      created: boolean;
    }>([
      "blood-test",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const eventId = requireData(importJsonResult).eventId;
    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "blood-test",
      "show",
      eventId,
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "show",
      eventId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(importJsonResult.ok, true);
    assert.match(eventId, /^evt_/u);
    assert.equal(requireData(importJsonResult).lookupId, eventId);
    assert.equal(requireData(importJsonResult).created, true);
    assert.equal(
      requireData(importJsonResult).ledgerFile,
      "ledger/events/2026/2026-03.jsonl",
    );
    assert.equal(nounShow.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(nounShow).entity.id, eventId);
    assert.equal(requireData(nounShow).entity.kind, "blood_test");
    assert.equal(requireData(nounShow).entity.data.testCategory, "blood");
    assert.equal(requireData(nounShow).entity.data.labName, "Function Health");
    assert.equal(Array.isArray(requireData(nounShow).entity.data.results), true);
    assert.equal(requireData(genericShow).entity.kind, "blood_test");
    assert.equal(requireData(genericShow).entity.data.resultStatus, "mixed");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("immunization descriptor wiring exposes a dedicated event-backed noun", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "immunization.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12T13:00:00.000Z",
        source: "import",
        title: "Influenza vaccine",
        vaccineName: "Influenza",
        manufacturer: "Example manufacturer",
        lotNumber: "LOT123",
        route: "intramuscular",
        site: "left deltoid",
        series: "annual",
        targetDiseases: ["influenza"],
        externalRef: {
          system: "source-document",
          resourceType: "immunization-entry",
          resourceId: "synthetic-row-1",
        },
      }),
      "utf8",
    );

    const importJsonResult = await runCli<{
      eventId: string;
      lookupId: string;
      ledgerFile: string;
      created: boolean;
    }>([
      "immunization",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const eventId = requireData(importJsonResult).eventId;
    const saveResult = await runCli<{
      eventId: string;
      lookupId: string;
      ledgerFile: string;
      created: boolean;
    }>([
      "immunization",
      "save",
      "Tdap",
      "--occurred-at",
      "2026-03-13",
      "--lot-number",
      "LOT456",
      "--target-disease",
      "tetanus",
      "--target-disease",
      "pertussis",
      "--vault",
      vaultRoot,
    ]);
    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "immunization",
      "show",
      "LOT123",
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "immunization",
      "list",
      "--from",
      "2026-03-01",
      "--limit",
      "5",
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "show",
      eventId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(importJsonResult.ok, true);
    assert.match(eventId, /^evt_/u);
    assert.equal(requireData(importJsonResult).lookupId, eventId);
    assert.equal(requireData(importJsonResult).created, true);
    assert.equal(
      requireData(importJsonResult).ledgerFile,
      "ledger/events/2026/2026-03.jsonl",
    );
    assert.equal(saveResult.ok, true);
    assert.match(requireData(saveResult).eventId, /^evt_/u);
    assert.equal(nounShow.ok, true);
    assert.equal(requireData(nounShow).entity.id, eventId);
    assert.equal(requireData(nounShow).entity.kind, "immunization");
    assert.equal(requireData(nounShow).entity.data.vaccineName, "Influenza");
    assert.equal(requireData(nounShow).entity.data.lotNumber, "LOT123");
    assert.equal(nounList.ok, true);
    assert.equal(requireData(nounList).count, 2);
    assert.equal(requireData(nounList).items[0]?.kind, "immunization");
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(genericShow).entity.kind, "immunization");
    const externalRef = requireData(genericShow).entity.data.externalRef;
    assert.equal(
      externalRef !== null &&
        typeof externalRef === "object" &&
        !Array.isArray(externalRef) &&
        "resourceId" in externalRef
        ? externalRef.resourceId
        : null,
      "synthetic-row-1",
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("blood-test list echoes shared filters and generic list kind routing", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "blood-test-list.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12T13:00:00.000Z",
        title: "Functional health panel",
        testName: "functional_health_panel",
        labName: "Function Health",
        results: [
          {
            analyte: "Apolipoprotein B",
            value: 87,
            unit: "mg/dL",
            flag: "normal",
          },
          {
            analyte: "VLDL Cholesterol",
            value: 24,
            unit: "mg/dL",
            flag: "normal",
          },
          {
            analyte: "LDL Cholesterol",
            value: 134,
            unit: "mg/dL",
            flag: "high",
          },
          {
            analyte: "Non-HDL Cholesterol",
            value: 158,
            unit: "mg/dL",
            flag: "high",
          },
          {
            analyte: "HDL Cholesterol",
            value: 52,
            unit: "mg/dL",
            flag: "normal",
          },
        ],
      }),
      "utf8",
    );

    await runCli([
      "blood-test",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      count: number;
      filters: Record<string, unknown>;
      nextCursor: string | null;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "blood-test",
      "list",
      "--status",
      "mixed",
      "--text",
      "Apolipoprotein B",
      "--limit",
      "5",
      "--vault",
      vaultRoot,
    ]);
    const genericList = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "list",
      "--kind",
      "blood_test",
      "--limit",
      "5",
      "--vault",
      vaultRoot,
    ]);
    const ldlList = await runCli<{
      count: number;
      items: Array<{ data: Record<string, unknown> }>;
    }>([
      "blood-test",
      "list",
      "--text",
      "LDL",
      "--limit",
      "1",
      "--vault",
      vaultRoot,
    ]);
    const hdlList = await runCli<{
      count: number;
      items: Array<{ data: Record<string, unknown> }>;
    }>([
      "blood-test",
      "list",
      "--text",
      "HDL",
      "--limit",
      "1",
      "--vault",
      vaultRoot,
    ]);
    const ambiguousList = await runCli<{
      count: number;
      items: Array<{ data: Record<string, unknown> }>;
    }>([
      "blood-test",
      "list",
      "--text",
      "cholesterol",
      "--limit",
      "1",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(nounList.ok, true);
    assert.equal(requireData(nounList).filters.status, "mixed");
    assert.equal(requireData(nounList).filters.text, "Apolipoprotein B");
    assert.equal("kind" in requireData(nounList).filters, false);
    assert.equal(requireData(nounList).filters.limit, 5);
    assert.equal(requireData(nounList).count, 1);
    assert.equal(requireData(nounList).nextCursor, null);
    assert.equal(requireData(nounList).items[0]?.kind, "blood_test");
    assert.equal(requireData(nounList).items[0]?.data.resultStatus, "mixed");
    assert.equal(requireData(nounList).items[0]?.data.labName, "Function Health");
    assert.deepEqual(requireData(nounList).items[0]?.data.matchedResult, {
      analyte: "Apolipoprotein B",
      flag: "normal",
      unit: "mg/dL",
      value: 87,
    });
    assert.doesNotMatch(
      JSON.stringify(requireData(nounList).items[0]?.data.matchedResult),
      /LDL Cholesterol|134/u,
    );
    assert.equal(genericList.ok, true);
    assert.equal(requireData(genericList).count, 1);
    assert.equal(requireData(genericList).items[0]?.kind, "blood_test");
    assert.equal(requireData(genericList).items[0]?.data.testCategory, "blood");
    assert.equal(requireData(genericList).items[0]?.data.resultsCount, 5);
    assert.equal(requireData(genericList).items[0]?.data.matchedResult, undefined);
    assert.deepEqual(requireData(ldlList).items[0]?.data.matchedResult, {
      analyte: "LDL Cholesterol",
      flag: "high",
      unit: "mg/dL",
      value: 134,
    });
    assert.deepEqual(requireData(hdlList).items[0]?.data.matchedResult, {
      analyte: "HDL Cholesterol",
      flag: "normal",
      unit: "mg/dL",
      value: 52,
    });
    assert.equal(requireData(ambiguousList).count, 1);
    assert.equal(
      requireData(ambiguousList).items[0]?.data.matchedResult,
      undefined,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});


test("goal list and show preserve canonical links and strip reserved fields", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const goalPayloadPath = path.join(vaultRoot, "goal-linked.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      goalPayloadPath,
      JSON.stringify({
        title: "Recover better",
        status: "active",
        horizon: "long_term",
        domains: ["sleep"],
      }),
      "utf8",
    );

    const goalUpsert = await runCli<{
      goalId: string;
    }>([
      "goal",
      "import-json",
      "--input",
      `@${goalPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalId = requireData(goalUpsert).goalId;

    const goalList = await runCli<{
      count: number;
      nextCursor: string | null;
      items: Array<{
        kind: string;
        title: string | null;
        path: string | null;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      }>;
    }>([
      "goal",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const goalShow = await runCli<{
      entity: {
        kind: string;
        title: string | null;
        markdown: string | null;
        path: string | null;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      };
    }>([
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(goalList.ok, true);
    assert.equal(requireData(goalList).count, 1);
    assert.equal(requireData(goalList).nextCursor, null);
    assert.equal(requireData(goalList).items[0]?.kind, "goal");
    assert.equal(requireData(goalList).items[0]?.title, "Recover better");
    assert.equal(Boolean(requireData(goalList).items[0]?.path), true);
    assert.equal("relativePath" in requireData(goalList).items[0]!.data, false);
    assert.equal("body" in requireData(goalList).items[0]!.data, false);

    assert.equal(goalShow.ok, true);
    assert.equal(requireData(goalShow).entity.kind, "goal");
    assert.equal(requireData(goalShow).entity.title, "Recover better");
    assert.equal(Boolean(requireData(goalShow).entity.path), true);
    assert.equal(
      requireData(goalShow).entity.links.some((link) => link.id === goalId),
      false,
    );
    assert.equal("relativePath" in requireData(goalShow).entity.data, false);
    assert.equal("body" in requireData(goalShow).entity.data, false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("goal list preserves status filters after explicit adapter migration", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const activePath = path.join(vaultRoot, "goal-active.json");
  const archivedPath = path.join(vaultRoot, "goal-archived.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      activePath,
      JSON.stringify({
        title: "Active goal",
        status: "active",
        horizon: "long_term",
        domains: ["sleep"],
      }),
      "utf8",
    );
    await writeFile(
      archivedPath,
      JSON.stringify({
        title: "Archived goal",
        status: "archived",
        horizon: "long_term",
        domains: ["sleep"],
      }),
      "utf8",
    );

    const inRangeUpsert = await runCli<{
      goalId: string;
    }>([
      "goal",
      "import-json",
      "--input",
      `@${activePath}`,
      "--vault",
      vaultRoot,
    ]);
    await runCli([
      "goal",
      "import-json",
      "--input",
      `@${archivedPath}`,
      "--vault",
      vaultRoot,
    ]);

    const listResult = await runCli<{
      count: number;
      filters: Record<string, unknown>;
      items: Array<{
        id: string;
      }>;
    }>([
      "goal",
      "list",
      "--status",
      "active",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(listResult.ok, true);
    assert.equal(requireData(listResult).filters.status, "active");
    assert.equal(requireData(listResult).count, 1);
    assert.equal(
      requireData(listResult).items[0]?.id,
      requireData(inRangeUpsert).goalId,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("supplement commands expose product metadata and a rolled-up compound ledger", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));

  try {
    await runCli(["init", "--vault", vaultRoot]);

    const primaryUpsert = await runCli<{
      regimenId: string;
    }>([
      "supplement",
      "save",
      "Daily Liposomal C",
      "--slug",
      "daily-liposomal-c",
      "--status",
      "active",
      "--started-on",
      "2026-03-01",
      "--brand",
      "LivOn Labs",
      "--manufacturer",
      "LivOn Laboratories",
      "--serving-size",
      "1 packet",
      "--ingredient",
      "{\"compound\":\"Vitamin C\",\"amount\":500,\"unit\":\"mg\",\"active\":true}",
      "--schedule",
      "with breakfast",
      "--vault",
      vaultRoot,
    ]);
    const secondaryUpsert = await runCli<{
      regimenId: string;
    }>([
      "supplement",
      "save",
      "Electrolyte C Mix",
      "--status",
      "active",
      "--started-on",
      "2026-03-02",
      "--ingredient",
      "{\"compound\":\"Vitamin C\",\"amount\":250,\"unit\":\"mg\"}",
      "--schedule",
      "post-training",
      "--vault",
      vaultRoot,
    ]);

    const primarySupplementId = requireData(primaryUpsert).regimenId;
    const secondarySupplementId = requireData(secondaryUpsert).regimenId;

    const showResult = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown> & {
          ingredients?: Array<Record<string, unknown>>;
        };
      };
    }>([
      "supplement",
      "show",
      primarySupplementId,
      "--vault",
      vaultRoot,
    ]);
    const listResult = await runCli<{
      count: number;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "supplement",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const compoundListResult = await runCli<{
      count: number;
      items: Array<{
        lookupId: string;
        supplementCount: number;
        totals: Array<{
          unit: string | null;
          totalAmount: number | null;
        }>;
      }>;
    }>([
      "supplement",
      "compound",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const compoundShowResult = await runCli<{
      compound: {
        lookupId: string;
        supplementCount: number;
        totals: Array<{
          unit: string | null;
          totalAmount: number | null;
          sourceCount: number;
        }>;
        sources: Array<{
          supplementId: string;
          brand: string | null;
        }>;
      };
    }>([
      "supplement",
      "compound",
      "show",
      "vitamin-c",
      "--vault",
      vaultRoot,
    ]);
    const stopResult = await runCli<{
      regimenId: string;
      status: string;
      stoppedOn: string | null;
    }>([
      "supplement",
      "stop",
      primarySupplementId,
      "--stoppedOn",
      "2026-03-20",
      "--vault",
      vaultRoot,
    ]);
    const stoppedCompoundList = await runCli<{
      items: Array<{
        lookupId: string;
        totals: Array<{
          unit: string | null;
          totalAmount: number | null;
        }>;
      }>;
    }>([
      "supplement",
      "compound",
      "list",
      "--status",
      "stopped",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(showResult.ok, true);
    assert.equal(requireData(showResult).entity.id, primarySupplementId);
    assert.equal(requireData(showResult).entity.kind, "supplement");
    assert.equal(requireData(showResult).entity.data.brand, "LivOn Labs");
    assert.equal(requireData(showResult).entity.data.manufacturer, "LivOn Laboratories");
    assert.equal(requireData(showResult).entity.data.servingSize, "1 packet");
    assert.equal(Array.isArray(requireData(showResult).entity.data.ingredients), true);

    assert.equal(listResult.ok, true);
    assert.equal(requireData(listResult).count, 2);
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.id).sort(),
      [primarySupplementId, secondarySupplementId].sort(),
    );
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.kind),
      ["supplement", "supplement"],
    );

    assert.equal(compoundListResult.ok, true);
    assert.deepEqual(
      requireData(compoundListResult).items.map((item) => item.lookupId),
      ["vitamin-c"],
    );

    assert.equal(compoundShowResult.ok, true);
    assert.equal(requireData(compoundShowResult).compound.lookupId, "vitamin-c");
    assert.equal(requireData(compoundShowResult).compound.supplementCount, 2);
    assert.deepEqual(
      requireData(compoundShowResult).compound.totals.map((total) => ({
        unit: total.unit,
        totalAmount: total.totalAmount,
        sourceCount: total.sourceCount,
      })),
      [
        {
          unit: "mg",
          totalAmount: 750,
          sourceCount: 2,
        },
      ],
    );
    assert.deepEqual(
      requireData(compoundShowResult).compound.sources.map((source) => source.supplementId),
      [primarySupplementId, secondarySupplementId],
    );
    assert.equal(requireData(compoundShowResult).compound.sources[0]?.brand, "LivOn Labs");

    assert.equal(stopResult.ok, true);
    assert.equal(requireData(stopResult).regimenId, primarySupplementId);
    assert.equal(requireData(stopResult).status, "stopped");
    assert.equal(requireData(stopResult).stoppedOn, "2026-03-20");

    assert.equal(stoppedCompoundList.ok, true);
    assert.deepEqual(
      requireData(stoppedCompoundList).items.map((item) => ({
        lookupId: item.lookupId,
        totals: item.totals.map((total) => ({
          unit: total.unit,
          totalAmount: total.totalAmount,
        })),
      })),
      [
        {
          lookupId: "vitamin-c",
          totals: [
            {
              unit: "mg",
              totalAmount: 500,
            },
          ],
        },
      ],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}, 60_000);


test("goal import-json rejects malformed payloads instead of coercing them into saved records", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "goal-invalid.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: 42,
      }),
      "utf8",
    );

    const upsertResult = await runCli([
      "goal",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalList = await runCli<{
      items: Array<{ id: string }>;
    }>([
      "goal",
      "list",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, false);
    assert.equal(upsertResult.error?.code, "invalid_payload");
    assert.equal(goalList.ok, true);
    assert.deepEqual(requireData(goalList).items, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
