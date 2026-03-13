import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { requireData, runCli } from "./cli-test-helpers.js";

test.sequential("intake show and intake list route assessment reads through the noun-specific commands", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));

  try {
    await runCli(["init", "--vault", vaultRoot]);
    await mkdir(path.join(vaultRoot, "ledger/assessments/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "ledger/assessments/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "hb.assessment-response.v1",
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
      };
    }>([
      "intake",
      "show",
      "asmt_cli_01",
      "--vault",
      vaultRoot,
    ]);
    const listResult = await runCli<{
      items: Array<{
        id: string;
        kind: string;
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
    assert.equal(listResult.ok, true);
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.id),
      ["asmt_cli_01"],
    );
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.kind),
      ["assessment"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("goal descriptor wiring keeps noun-specific and generic reads aligned", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));
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
      entity: Record<string, unknown>;
    }>([
      "goal",
      "show",
      goalId,
      "--vault",
      vaultRoot,
    ]);
    const nounList = await runCli<{
      items: Array<Record<string, unknown>>;
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

    assert.equal(upsertResult.ok, true);
    assert.equal(nounShow.ok, true);
    assert.equal(nounList.ok, true);
    assert.equal(genericShow.ok, true);
    assert.equal(genericList.ok, true);
    assert.equal(requireData(genericShow).entity.id, goalId);
    assert.equal(requireData(genericShow).entity.kind, "goal");
    assert.equal(
      requireData(nounShow).entity.id ?? requireData(nounShow).entity.goalId,
      goalId,
    );
    assert.deepEqual(
      requireData(nounList).items.map((item) => item.id),
      [goalId],
    );
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.id),
      [goalId],
    );
    assert.deepEqual(
      requireData(genericList).items.map((item) => item.kind),
      ["goal"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("goal upsert rejects reserved vault-root overrides from JSON payloads", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));
  const redirectVaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));
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

test.sequential("profile current lookup stays wired for both noun-specific and generic show", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));
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
      entity: Record<string, unknown>;
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
    assert.equal(
      requireData(nounShow).entity.id ?? requireData(nounShow).entity.snapshotId ?? "current",
      "current",
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("profile upsert rejects malformed profile payloads instead of coercing them to {}", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "healthybob-cli-health-"));
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
