import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { requireData, runCli } from "./cli-test-helpers.js";

test.sequential("intake show and intake list route assessment reads through the noun-specific commands", async () => {
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
});

test.sequential("intake list applies date bounds and echoes renamed filter keys", async () => {
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

test.sequential("intake list rejects the removed assessment status filter", async () => {
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

test.sequential("goal descriptor wiring keeps noun-specific and generic reads aligned", async () => {
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
      "upsert",
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

test.sequential("goal show projects shared Goal relations through the noun-specific CLI surface", async () => {
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
      "upsert",
      "--input",
      `@${parentPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const relatedUpsert = await runCli<{
      goalId: string;
    }>([
      "goal",
      "upsert",
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
      "upsert",
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
      [
        ...requireData(nounShow).entity.links.map((link) => link.id),
        goalId,
      ].sort(),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("goal upsert rejects reserved vault-root overrides from JSON payloads", async () => {
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
      "upsert",
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

test.sequential("goal upsert preserves omitted fields on patch updates", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const createPayloadPath = path.join(vaultRoot, "goal-create.json");
  const patchPriorityPayloadPath = path.join(vaultRoot, "goal-patch-priority.json");
  const patchTitlePayloadPath = path.join(vaultRoot, "goal-patch-title.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      createPayloadPath,
      JSON.stringify({
        title: "Sleep longer",
        status: "completed",
        horizon: "short_term",
      }),
      "utf8",
    );

    const created = await runCli<{
      goalId: string;
    }>([
      "goal",
      "upsert",
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

    const patchPriority = await runCli([
      "goal",
      "upsert",
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

    const patchTitle = await runCli([
      "goal",
      "upsert",
      "--input",
      `@${patchTitlePayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const shown = await runCli<{
      entity: {
        id: string;
        data: Record<string, unknown>;
      };
    }>([
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

test.sequential("goal upsert validates payloads through the shared goal schema", async () => {
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
      "upsert",
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

test.sequential("condition and allergy commands keep noun-specific and generic reads aligned", async () => {
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
      "upsert",
      "--input",
      `@${conditionPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const allergyUpsert = await runCli<{
      allergyId: string;
    }>([
      "allergy",
      "upsert",
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

test.sequential("condition and allergy upsert validate payloads through the shared schemas", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const conditionPayloadPath = path.join(vaultRoot, "condition-invalid.json");
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

    const conditionUpsertResult = await runCli([
      "condition",
      "upsert",
      "--input",
      `@${conditionPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const allergyUpsertResult = await runCli([
      "allergy",
      "upsert",
      "--input",
      `@${allergyPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(conditionUpsertResult.ok, false);
    assert.equal(conditionUpsertResult.error?.code, "invalid_payload");
    assert.match(conditionUpsertResult.error?.message ?? "", /condition payload failed validation/i);
    assert.equal(allergyUpsertResult.ok, false);
    assert.equal(allergyUpsertResult.error?.code, "invalid_payload");
    assert.match(allergyUpsertResult.error?.message ?? "", /allergy payload failed validation/i);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("family descriptor wiring keeps member-specific commands aligned with generic health reads", async () => {
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
      "upsert",
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

test.sequential("generic family show links ignore the removed familyMemberIds alias", async () => {
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

test.sequential("family upsert validates payloads through the shared schema and does not expose a fake status filter", async () => {
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
      "upsert",
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

test.sequential("genetics descriptor wiring keeps variant-specific commands aligned with generic health reads", async () => {
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
      "upsert",
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

test.sequential("genetics upsert validates payloads through the shared schema and preserves omitted gene values on patch updates", async () => {
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
      "upsert",
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
      "upsert",
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
      "upsert",
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

test.sequential("protocol commands keep noun-specific and generic reads aligned", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "protocol.json");

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
      protocolId: string;
    }>([
      "protocol",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const protocolId = requireData(upsertResult).protocolId;

    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "protocol",
      "show",
      protocolId,
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
      "protocol",
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
      protocolId,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(nounList.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(nounShow).entity.id, protocolId);
    assert.equal(requireData(nounShow).entity.kind, "protocol");
    assert.equal(requireData(nounShow).entity.data.kind, "medication");
    assert.equal(requireData(nounShow).entity.data.group, "medication");
    assert.equal(requireData(nounList).count, 1);
    assert.deepEqual(
      requireData(nounList).items.map((item) => item.id),
      [protocolId],
    );
    assert.equal(requireData(nounList).items[0]?.data.kind, "medication");
    assert.equal(requireData(genericShow).entity.id, protocolId);
    assert.equal(requireData(genericShow).entity.kind, "protocol");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("history descriptor wiring preserves the shared history-ledger upsert result shape", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "history.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        kind: "encounter",
        occurredAt: "2026-03-12T13:00:00.000Z",
        title: "Primary care follow-up",
        encounterType: "office_visit",
        location: "Primary care clinic",
      }),
      "utf8",
    );

    const upsertResult = await runCli<{
      eventId: string;
      lookupId: string;
      ledgerFile: string;
      created: boolean;
    }>([
      "history",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const eventId = requireData(upsertResult).eventId;
    const showResult = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "history",
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

    assert.equal(upsertResult.ok, true);
    assert.match(eventId, /^evt_/u);
    assert.equal(requireData(upsertResult).lookupId, eventId);
    assert.equal(requireData(upsertResult).created, true);
    assert.equal(
      requireData(upsertResult).ledgerFile,
      "ledger/events/2026/2026-03.jsonl",
    );
    assert.equal(showResult.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(showResult).entity.id, eventId);
    assert.equal(requireData(showResult).entity.kind, "encounter");
    assert.equal(requireData(showResult).entity.data.encounterType, "office_visit");
    assert.equal(requireData(genericShow).entity.id, eventId);
    assert.equal(requireData(genericShow).entity.kind, "encounter");
    assert.equal(requireData(genericShow).entity.data.encounterType, "office_visit");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("history list keeps canonical kind/data and echoes shared filters", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const encounterPayloadPath = path.join(vaultRoot, "history-encounter.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      encounterPayloadPath,
      JSON.stringify({
        kind: "encounter",
        occurredAt: "2026-03-12T13:00:00.000Z",
        title: "Primary care follow-up",
        encounterType: "office_visit",
        location: "Primary care clinic",
      }),
      "utf8",
    );

    await runCli([
      "history",
      "upsert",
      "--input",
      `@${encounterPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const listResult = await runCli<{
      count: number;
      filters: Record<string, unknown>;
      nextCursor: string | null;
      items: Array<{
        id: string;
        kind: string;
        data: Record<string, unknown>;
      }>;
    }>([
      "history",
      "list",
      "--kind",
      "encounter",
      "--limit",
      "5",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(listResult.ok, true);
    assert.equal(requireData(listResult).filters.kind, "encounter");
    assert.equal("from" in requireData(listResult).filters, false);
    assert.equal("to" in requireData(listResult).filters, false);
    assert.equal(requireData(listResult).filters.limit, 5);
    assert.equal(requireData(listResult).count, 1);
    assert.equal(requireData(listResult).nextCursor, null);
    assert.equal(requireData(listResult).items[0]?.kind, "encounter");
    assert.equal(requireData(listResult).items[0]?.data.encounterType, "office_visit");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("blood-test descriptor wiring exposes a dedicated noun while preserving the shared event id", async () => {
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

    const upsertResult = await runCli<{
      eventId: string;
      lookupId: string;
      ledgerFile: string;
      created: boolean;
    }>([
      "blood-test",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const eventId = requireData(upsertResult).eventId;
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
    const historyShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
      };
    }>([
      "history",
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

    assert.equal(upsertResult.ok, true);
    assert.match(eventId, /^evt_/u);
    assert.equal(requireData(upsertResult).lookupId, eventId);
    assert.equal(requireData(upsertResult).created, true);
    assert.equal(
      requireData(upsertResult).ledgerFile,
      "ledger/events/2026/2026-03.jsonl",
    );
    assert.equal(nounShow.ok, true);
    assert.equal(historyShow.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(nounShow).entity.id, eventId);
    assert.equal(requireData(nounShow).entity.kind, "blood_test");
    assert.equal(requireData(nounShow).entity.data.testCategory, "blood");
    assert.equal(requireData(nounShow).entity.data.labName, "Function Health");
    assert.equal(Array.isArray(requireData(nounShow).entity.data.results), true);
    assert.equal(requireData(historyShow).entity.kind, "test");
    assert.equal(requireData(historyShow).entity.data.resultStatus, "mixed");
    assert.equal(requireData(genericShow).entity.kind, "blood_test");
    assert.equal(requireData(genericShow).entity.data.resultStatus, "mixed");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("blood-test list echoes shared filters and generic list kind routing", async () => {
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
            analyte: "LDL Cholesterol",
            value: 134,
            unit: "mg/dL",
            flag: "high",
          },
        ],
      }),
      "utf8",
    );

    await runCli([
      "blood-test",
      "upsert",
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

    assert.equal(nounList.ok, true);
    assert.equal(requireData(nounList).filters.status, "mixed");
    assert.equal("kind" in requireData(nounList).filters, false);
    assert.equal(requireData(nounList).filters.limit, 5);
    assert.equal(requireData(nounList).count, 1);
    assert.equal(requireData(nounList).nextCursor, null);
    assert.equal(requireData(nounList).items[0]?.kind, "blood_test");
    assert.equal(requireData(nounList).items[0]?.data.resultStatus, "mixed");
    assert.equal(requireData(nounList).items[0]?.data.labName, "Function Health");
    assert.equal(genericList.ok, true);
    assert.equal(requireData(genericList).count, 1);
    assert.equal(requireData(genericList).items[0]?.kind, "blood_test");
    assert.equal(requireData(genericList).items[0]?.data.testCategory, "blood");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("profile current lookup stays wired for both noun-specific and generic show", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "profile.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        source: "manual",
        profile: {
          domains: ["sleep"],
          topGoalIds: [],
        },
      }),
      "utf8",
    );

    const upsertResult = await runCli([
      "profile",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const nounShow = await runCli<{
      entity: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      };
    }>([
      "profile",
      "show",
      "current",
      "--vault",
      vaultRoot,
    ]);
    const genericShow = await runCli<{
      entity: {
        kind: string;
      };
    }>([
      "show",
      "current",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(requireData(genericShow).entity.kind, "profile");
    assert.equal(requireData(nounShow).entity.id, "current");
    assert.equal(requireData(nounShow).entity.kind, "profile");
    assert.deepEqual(requireData(nounShow).entity.data.topGoalIds, []);
    assert.equal(requireData(nounShow).entity.links.length >= 1, true);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("profile list and current show preserve canonical links and strip reserved fields", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const goalPayloadPath = path.join(vaultRoot, "goal-linked.json");
  const profilePayloadPath = path.join(vaultRoot, "profile-linked.json");
  const assessmentId = "asmt_01JNY0B2W4VG5C2A0G9S8M7R6Q";
  const eventId = "evt_01JNY0B2W4VG5C2A0G9S8M7R6R";

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
      "upsert",
      "--input",
      `@${goalPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const goalId = requireData(goalUpsert).goalId;

    await mkdir(path.join(vaultRoot, "ledger/assessments/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: assessmentId,
        assessmentType: "full-intake",
        recordedAt: "2026-03-12T13:00:00Z",
        source: "manual",
        title: "Linked assessment",
        responses: {
          sleep: {
            averageHours: 7,
          },
        },
      })}\n`,
      "utf8",
    );
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: eventId,
        kind: "encounter",
        occurredAt: "2026-03-12T12:45:00Z",
        recordedAt: "2026-03-12T12:50:00Z",
        source: "manual",
        title: "Linked encounter",
      })}\n`,
      "utf8",
    );
    await writeFile(
      profilePayloadPath,
      JSON.stringify({
        source: "manual",
        sourceAssessmentIds: [assessmentId],
        sourceEventIds: [eventId],
        profile: {
          domains: ["sleep"],
          topGoalIds: [goalId],
        },
      }),
      "utf8",
    );

    const profileUpsert = await runCli<{
      snapshotId: string;
    }>([
      "profile",
      "upsert",
      "--input",
      `@${profilePayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const snapshotId = requireData(profileUpsert).snapshotId;

    const profileList = await runCli<{
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
      "profile",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const currentProfile = await runCli<{
      entity: {
        kind: string;
        title: string | null;
        markdown: string | null;
        path: string | null;
        data: Record<string, unknown>;
        links: Array<{ id: string }>;
      };
    }>([
      "profile",
      "show",
      "current",
      "--vault",
      vaultRoot,
    ]);
    const genericCurrentProfile = await runCli<{
      entity: {
        kind: string;
        title: string | null;
        markdown: string | null;
        links: Array<{ id: string }>;
      };
    }>([
      "show",
      "current",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(profileUpsert.ok, true);
    assert.equal(profileList.ok, true);
    assert.equal(requireData(profileList).count, 1);
    assert.equal(requireData(profileList).nextCursor, null);
    assert.equal(requireData(profileList).items[0]?.kind, "profile");
    assert.equal(requireData(profileList).items[0]?.title, snapshotId);
    assert.equal(Boolean(requireData(profileList).items[0]?.path), true);
    assert.deepEqual(
      requireData(profileList).items[0]?.links.map((link) => link.id).sort(),
      [assessmentId, eventId].sort(),
    );
    assert.equal("relativePath" in requireData(profileList).items[0]!.data, false);
    assert.equal("body" in requireData(profileList).items[0]!.data, false);

    assert.equal(currentProfile.ok, true);
    assert.equal(genericCurrentProfile.ok, true);
    assert.equal(requireData(currentProfile).entity.kind, "profile");
    assert.equal(requireData(currentProfile).entity.title, "Current profile");
    assert.equal(
      requireData(currentProfile).entity.title,
      requireData(genericCurrentProfile).entity.title,
    );
    assert.equal(
      requireData(currentProfile).entity.markdown,
      requireData(genericCurrentProfile).entity.markdown,
    );
    assert.equal(Boolean(requireData(currentProfile).entity.path), true);
    assert.deepEqual(
      requireData(currentProfile).entity.links.map((link) => link.id).sort(),
      [assessmentId, eventId, goalId, snapshotId].sort(),
    );
    assert.equal("relativePath" in requireData(currentProfile).entity.data, false);
    assert.equal("body" in requireData(currentProfile).entity.data, false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("profile list preserves date-range filters after explicit adapter migration", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const inRangePath = path.join(vaultRoot, "profile-in-range.json");
  const outOfRangePath = path.join(vaultRoot, "profile-out-of-range.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      inRangePath,
      JSON.stringify({
        recordedAt: "2026-03-12T09:00:00Z",
        profile: {
          topGoalIds: [],
        },
      }),
      "utf8",
    );
    await writeFile(
      outOfRangePath,
      JSON.stringify({
        recordedAt: "2026-03-20T09:00:00Z",
        profile: {
          topGoalIds: [],
        },
      }),
      "utf8",
    );

    const inRangeUpsert = await runCli<{
      snapshotId: string;
    }>([
      "profile",
      "upsert",
      "--input",
      `@${inRangePath}`,
      "--vault",
      vaultRoot,
    ]);
    await runCli([
      "profile",
      "upsert",
      "--input",
      `@${outOfRangePath}`,
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
      "profile",
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
    assert.equal(requireData(listResult).count, 1);
    assert.equal(
      requireData(listResult).items[0]?.id,
      requireData(inRangeUpsert).snapshotId,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("supplement commands expose product metadata and a rolled-up compound ledger", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const primaryPayloadPath = path.join(vaultRoot, "supplement-primary.json");
  const secondaryPayloadPath = path.join(vaultRoot, "supplement-secondary.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      primaryPayloadPath,
      JSON.stringify({
        title: "Liposomal Vitamin C",
        kind: "supplement",
        status: "active",
        startedOn: "2026-03-01",
        brand: "LivOn Labs",
        manufacturer: "LivOn Laboratories",
        servingSize: "1 packet",
        ingredients: [
          {
            compound: "Vitamin C",
            label: "Ascorbic acid",
            amount: 500,
            unit: "mg",
          },
          {
            compound: "Phosphatidylcholine",
            amount: 1200,
            unit: "mg",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      secondaryPayloadPath,
      JSON.stringify({
        title: "Electrolyte C Mix",
        status: "active",
        startedOn: "2026-03-02",
        substance: "Vitamin C",
        dose: 250,
        unit: "mg",
        schedule: "post-training",
      }),
      "utf8",
    );

    const scaffoldResult = await runCli<{
      noun: string;
      payload: {
        ingredients?: Array<Record<string, unknown>>;
      };
    }>([
      "supplement",
      "scaffold",
      "--vault",
      vaultRoot,
    ]);
    const primaryUpsert = await runCli<{
      protocolId: string;
    }>([
      "supplement",
      "upsert",
      "--input",
      `@${primaryPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const secondaryUpsert = await runCli<{
      protocolId: string;
    }>([
      "supplement",
      "upsert",
      "--input",
      `@${secondaryPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    const primarySupplementId = requireData(primaryUpsert).protocolId;
    const secondarySupplementId = requireData(secondaryUpsert).protocolId;

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
      protocolId: string;
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

    assert.equal(scaffoldResult.ok, true);
    assert.equal(requireData(scaffoldResult).noun, "supplement");
    assert.equal(Array.isArray(requireData(scaffoldResult).payload.ingredients), true);

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
      ["phosphatidylcholine", "vitamin-c"],
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
      [secondarySupplementId, primarySupplementId],
    );
    assert.equal(requireData(compoundShowResult).compound.sources[1]?.brand, "LivOn Labs");

    assert.equal(stopResult.ok, true);
    assert.equal(requireData(stopResult).protocolId, primarySupplementId);
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
          lookupId: "phosphatidylcholine",
          totals: [
            {
              unit: "mg",
              totalAmount: 1200,
            },
          ],
        },
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

test.sequential("supplement rename moves the product record to the new slug while preserving the id", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-supplement-rename-"));
  const payloadPath = path.join(vaultRoot, "supplement.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Morning Supplement Mix",
        kind: "supplement",
        status: "active",
        startedOn: "2026-03-10",
        brand: "HB",
        manufacturer: "Murph",
      }),
      "utf8",
    );

    const created = await runCli<{
      protocolId: string;
      path?: string;
    }>([
      "supplement",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(created.ok, true);

    const renamed = await runCli<{
      protocolId: string;
      path?: string;
      created: boolean;
    }>([
      "supplement",
      "rename",
      requireData(created).protocolId,
      "--title",
      "Morning Protein Drink",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(renamed.ok, true);
    assert.equal(requireData(renamed).protocolId, requireData(created).protocolId);
    assert.equal(requireData(renamed).created, false);
    assert.match(requireData(renamed).path ?? "", /morning-protein-drink\.md$/u);

    const renamedPath = requireData(renamed).path;
    assert.equal(typeof renamedPath, "string");

    await access(path.join(vaultRoot, String(renamedPath)));

    const renamedMarkdown = await readFile(
      path.join(vaultRoot, String(renamedPath)),
      "utf8",
    );
    assert.match(renamedMarkdown, /title: "Morning Protein Drink"/u);

    const showResult = await runCli<{
      entity: {
        id: string;
        title: string | null;
      };
    }>([
      "supplement",
      "show",
      "morning-protein-drink",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(showResult.ok, true);
    assert.equal(requireData(showResult).entity.id, requireData(created).protocolId);
    assert.equal(requireData(showResult).entity.title, "Morning Protein Drink");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("profile upsert rejects malformed profile payloads instead of coercing them to {}", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "profile-invalid.json");

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await writeFile(
      payloadPath,
      JSON.stringify({
        source: "manual",
        profile: "oops",
      }),
      "utf8",
    );

    const upsertResult = await runCli([
      "profile",
      "upsert",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);
    const profileList = await runCli<{
      items: Array<{ id: string }>;
    }>([
      "profile",
      "list",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(upsertResult.ok, false);
    assert.equal(upsertResult.error?.code, "invalid_payload");
    assert.equal(profileList.ok, true);
    assert.deepEqual(requireData(profileList).items, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
