import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { Cli } from "incur";
import { test } from "vitest";

import { appendBloodTest, initializeVault } from "@murphai/core";
import { listBloodTests } from "@murphai/query";

import { registerProfileCommands, setProfileBloodType } from "../src/commands/profile.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { createTempVaultContext, requireData, runInProcessJsonCli } from "./cli-test-helpers.js";

interface BloodTypePayload {
  value: string;
  abo: string;
  rh: string;
  eventId: string;
  occurredAt: string;
}

function createProfileCli() {
  const cli = Cli.create("vault-cli", { description: "profile command test cli", version: "0.0.0-test" });
  cli.use(incurErrorBridge);
  registerProfileCommands(cli);
  return cli;
}

async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-profile-");
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-11-04T12:00:00.000Z", timezone: "UTC" });
    await run(vaultRoot);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
}

async function show(vaultRoot: string) {
  const result = await runInProcessJsonCli<{ bloodType: BloodTypePayload | null }>(createProfileCli(), [
    "profile", "show", "--vault", vaultRoot,
  ]);
  return requireData(result.envelope).bloodType;
}

async function set(vaultRoot: string, ...args: string[]) {
  const result = await runInProcessJsonCli<{ outcome: string; bloodType: BloodTypePayload }>(createProfileCli(), [
    "profile", "set", ...args, "--vault", vaultRoot,
  ]);
  return requireData(result.envelope);
}

test("profile set saves one canonical blood-test result that profile show reads back", async () => {
  await withVault(async (vaultRoot) => {
    assert.equal(await show(vaultRoot), null);

    const saved = await set(vaultRoot, "--blood-type", "AB positive", "--occurred-at", "2026-03-03", "--source", "import");
    assert.equal(saved.outcome, "saved");
    assert.deepEqual(
      { value: saved.bloodType.value, abo: saved.bloodType.abo, rh: saved.bloodType.rh },
      { value: "AB+", abo: "AB", rh: "positive" },
    );
    assert.equal((await show(vaultRoot))?.eventId, saved.bloodType.eventId);

    const [event] = await listBloodTests(vaultRoot);
    assert.deepEqual(event?.data.results, [{ analyte: "Blood type (ABO/Rh)", slug: "blood-type", textValue: "AB+" }]);
  });
});

test("an exact retry is unchanged, while new evidence for the same value is kept", async () => {
  await withVault(async (vaultRoot) => {
    const first = await set(vaultRoot, "--blood-type", "O-", "--occurred-at", "2026-03-03", "--source", "import");
    const retry = await set(vaultRoot, "--blood-type", "o neg", "--occurred-at", "2026-03-03", "--source", "import");
    assert.equal(retry.outcome, "unchanged");
    assert.equal(retry.bloodType.eventId, first.bloodType.eventId);
    assert.equal((await listBloodTests(vaultRoot)).length, 1);

    const withEvidence = await set(vaultRoot, "--blood-type", "O-", "--raw-ref", "raw/inbox/2026/11/cap_synthetic/lab.webp");
    assert.equal(withEvidence.outcome, "saved");
    assert.notEqual(withEvidence.bloodType.eventId, first.bloodType.eventId);
    assert.equal((await listBloodTests(vaultRoot)).length, 2);
    assert.equal((await set(vaultRoot, "--blood-type", "O-", "--raw-ref", "raw/inbox/2026/11/cap_synthetic/lab.webp")).outcome, "unchanged");
  });
});

test("a correction saved later wins even with an older lab date", async () => {
  await withVault(async (vaultRoot) => {
    await set(vaultRoot, "--blood-type", "O+");
    const correction = await set(vaultRoot, "--blood-type", "AB+", "--occurred-at", "2024-01-15");
    assert.equal(correction.outcome, "saved");
    assert.equal((await show(vaultRoot))?.value, "AB+");
    assert.equal((await set(vaultRoot, "--blood-type", "AB+")).outcome, "unchanged");
  });
});

test("profile show recognizes blood types saved under lab wording inside a panel", async () => {
  await withVault(async (vaultRoot) => {
    const panel = await appendBloodTest({
      vaultRoot, occurredAt: "2025-06-01T12:00:00.000Z", title: "Synthetic panel", testName: "synthetic-panel",
      results: [
        { analyte: "Ferritin", slug: "ferritin", value: 80, unit: "ng/mL" },
        { analyte: "ABO Group", textValue: "AB Positive" },
      ],
    });
    assert.deepEqual(
      { value: (await show(vaultRoot))?.value, eventId: (await show(vaultRoot))?.eventId },
      { value: "AB+", eventId: String(panel.record.id) },
    );
    assert.equal((await set(vaultRoot, "--blood-type", "AB+")).outcome, "unchanged");
    const [stored] = await listBloodTests(vaultRoot);
    assert.equal((stored?.data.results as unknown[]).length, 2);
  });
});

test("profile show combines separate ABO group and Rh rows", async () => {
  await withVault(async (vaultRoot) => {
    await appendBloodTest({
      vaultRoot, occurredAt: "2025-06-01T12:00:00.000Z", title: "Type and screen", testName: "type-and-screen",
      results: [{ analyte: "ABO Group", textValue: "B" }, { analyte: "Rh Type", textValue: "Negative" }],
    });
    assert.equal((await show(vaultRoot))?.value, "B-");
  });
});

test("concurrent identical sets commit one observation", async () => {
  await withVault(async (vaultRoot) => {
    const outcomes = await Promise.all([
      setProfileBloodType({ bloodType: "A+", vault: vaultRoot }),
      setProfileBloodType({ bloodType: "A+", vault: vaultRoot }),
    ]);
    assert.deepEqual(outcomes.map((outcome) => outcome.outcome).sort(), ["saved", "unchanged"]);
    assert.equal((await listBloodTests(vaultRoot)).length, 1);
  });
});

test("profile set rejects a value without both ABO group and Rh factor", async () => {
  await withVault(async (vaultRoot) => {
    const result = await runInProcessJsonCli(createProfileCli(), ["profile", "set", "--blood-type", "AB", "--vault", vaultRoot]);
    assert.equal(result.exitCode, 1);
    assert.match(result.envelope.ok ? "" : result.envelope.error.message ?? "", /ABO group and Rh factor/u);
    assert.equal((await listBloodTests(vaultRoot)).length, 0);
  });
});
