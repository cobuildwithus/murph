import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

export async function createWebFixtureVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-web-"));

  await writeVaultFile(
    vaultRoot,
    "vault.json",
    JSON.stringify(
      {
        createdAt: "2026-03-12T00:00:00.000Z",
        vaultId: "vault_web_fixture_01",
        owner: "fixture",
        timezone: "Australia/Melbourne",
        title: "Web fixture vault",
      },
      null,
      2,
    ),
  );

  await writeVaultFile(
    vaultRoot,
    "CORE.md",
    `---
schemaVersion: hv/core@v1
vaultId: vault_web_fixture_01
title: Web fixture vault
---
# Web Fixture Vault

Local-only fixture content.
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/experiments/sleep-reset.md",
    `---
schemaVersion: hv/experiment@v1
experimentId: exp_sleep_reset_01
slug: sleep-reset
title: Sleep Reset
status: active
startedOn: 2026-03-12
tags:
  - sleep
  - recovery
---
# Sleep Reset

Tracking sleep consistency.
`,
  );

  await writeVaultFile(
    vaultRoot,
    "journal/2026/2026-03-12.md",
    `---
schemaVersion: hv/journal@v1
date: 2026-03-12
title: March 12
tags:
  - recovery
---
# March 12

Sleep felt steadier after a lighter dinner.
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/profile/current.md",
    `---
schemaVersion: murph.frontmatter.profile-current.v1
docType: profile_current
snapshotId: psnap_web_01
updatedAt: 2026-03-12T14:00:00Z
---
# Current Profile

Sleep steadier, energy improving, and evening routine is becoming more repeatable.
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/goals/protect-sleep.md",
    `---
schemaVersion: hv/goal@v1
goalId: goal_sleep_01
slug: protect-sleep
title: Protect sleep consistency
status: active
priority: 1
---
# Protect sleep consistency
`,
  );

  await writeVaultFile(
    vaultRoot,
    "ledger/events/2026/2026-03.jsonl",
    `${JSON.stringify({
      schemaVersion: "murph.event.v1",
      id: "evt_web_01",
      kind: "encounter",
      occurredAt: "2026-03-12T09:30:00Z",
      recordedAt: "2026-03-12T09:45:00Z",
      source: "manual",
      title: "Sleep consult follow-up",
      relatedIds: ["goal_sleep_01"],
      tags: ["sleep", "clinic"],
    })}\n`,
  );

  await writeVaultFile(
    vaultRoot,
    "ledger/samples/glucose/2026/2026-03.jsonl",
    [
      {
        schemaVersion: "murph.sample.v1",
        id: "smp_glucose_01",
        stream: "glucose",
        occurredAt: "2026-03-12T07:00:00Z",
        recordedAt: "2026-03-12T07:00:00Z",
        value: 94,
        unit: "mg_dL",
        source: "manual",
      },
      {
        schemaVersion: "murph.sample.v1",
        id: "smp_glucose_02",
        stream: "glucose",
        occurredAt: "2026-03-12T19:10:00Z",
        recordedAt: "2026-03-12T19:10:00Z",
        value: 101,
        unit: "mg_dL",
        source: "manual",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );

  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-03.jsonl",
    `${JSON.stringify({
      schemaVersion: "murph.assessment-response.v1",
      id: "asmt_web_01",
      assessmentType: "check-in",
      recordedAt: "2026-03-12T13:00:00Z",
      source: "manual",
      title: "Midweek recovery check-in",
      responses: {
        sleep: {
          averageHours: 7.2,
        },
      },
    })}\n`,
  );

  await writeVaultFile(
    vaultRoot,
    "ledger/profile-snapshots/2026/2026-03.jsonl",
    `${JSON.stringify({
      schemaVersion: "murph.profile-snapshot.v1",
      id: "psnap_web_01",
      recordedAt: "2026-03-12T14:00:00Z",
      source: "assessment_projection",
      sourceAssessmentIds: ["asmt_web_01"],
      profile: {
        topGoalIds: ["goal_sleep_01"],
        sleep: {
          averageHours: 7.2,
        },
      },
    })}\n`,
  );

  return vaultRoot;
}

export async function destroyWebFixtureVault(vaultRoot: string): Promise<void> {
  await rm(vaultRoot, { force: true, recursive: true });
}
