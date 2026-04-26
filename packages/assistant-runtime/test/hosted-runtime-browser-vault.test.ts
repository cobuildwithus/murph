import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";

import { exportHostedBrowserVaultReplica } from "../src/hosted-runtime/browser-vault.ts";

const tempRoots: string[] = [];

interface BrowserVaultReplicaLike {
  entities: Array<{
    attributes: Record<string, unknown>;
    bodyPreview: string | null;
    family: string;
    id: string;
    title: string | null;
  }>;
  schema: string;
  searchRows: Array<{
    text: string;
  }>;
  source: {
    sourceBundleHash: string;
  };
  timelineRows: Array<{
    id: string;
  }>;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((vaultRoot) =>
    rm(vaultRoot, { force: true, recursive: true })
  ));
});

test("exports a hosted browser vault replica from the tolerant vault read", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-browser-vault-"));
  tempRoots.push(vaultRoot);

  await mkdir(path.join(vaultRoot, "journal/2026"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify({
      createdAt: "2026-04-08T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Hosted browser vault",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
    }),
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-04-08.md"),
    `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-04-08
---

# Travel recovery note

Felt steadier after a full night of sleep.
`,
    "utf8",
  );

  const replica: BrowserVaultReplicaLike = await exportHostedBrowserVaultReplica({
    sourceBundleHash: "a".repeat(64),
    vaultRoot,
  });

  assert.equal(replica.schema, "murph.browser-vault-replica.v1");
  assert.equal(replica.source.sourceBundleHash, "a".repeat(64));
  assert.equal(replica.entities.some((entity) => entity.title === "Travel recovery note"), true);
  assert.equal(replica.searchRows.some((row) => row.text.includes("steadier")), true);
  assert.ok(Array.isArray(replica.timelineRows));
});

test("hosted browser vault export minimizes experiments while preserving allowed event and registry families", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-browser-vault-min-"));
  tempRoots.push(vaultRoot);

  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/conditions"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/goals"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/regimens/supplement"), { recursive: true });

  const longBody = "Testing a deliberately long hosted browser vault preview sentence. ".repeat(12);

  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify({
      createdAt: "2026-04-08T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Hosted browser vault minimization",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4C",
    }),
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/experiments/empty-preview.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_hosted_browser_vault_00
slug: empty-preview
title: Empty Preview
status: active
startedOn: 2026-04-01
---
`,
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/experiments/short-preview.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_hosted_browser_vault_01
slug: short-preview
title: Short Preview
status: active
startedOn: 2026-04-02
---

Short hosted preview.
`,
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/experiments/long-preview.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_hosted_browser_vault_02
slug: long-preview
title: Long Preview
status: active
startedOn: 2026-04-03
---

# Long Preview

${longBody}
`,
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/conditions/insomnia.md"),
    `---
schemaVersion: murph.frontmatter.condition.v1
docType: condition
conditionId: cond_hosted_browser_vault_01
slug: insomnia
title: Insomnia
clinicalStatus: active
verificationStatus: provisional
assertedOn: 2026-04-01
note: Sensitive note that should not leave the hosted projection.
---
# Insomnia
`,
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/goals/improve-sleep.md"),
    `---
schemaVersion: murph.frontmatter.goal.v1
docType: goal
goalId: goal_hosted_browser_vault_01
slug: improve-sleep
title: Improve sleep
status: active
horizon: long_term
priority: 1
---
# Improve sleep
`,
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/regimens/supplement/magnesium.md"),
    `---
schemaVersion: murph.frontmatter.regimen.v1
docType: regimen
regimenId: reg_01K72NVW6Z4QK8VYAVX7GT7S4B
slug: magnesium
title: Magnesium
kind: supplement
status: active
startedOn: 2026-04-01
substance: Magnesium glycinate
dose: 200
unit: mg
schedule: nightly
---
# Magnesium
`,
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
    `${JSON.stringify({
      schemaVersion: "murph.event.v1",
      id: "evt_hosted_browser_vault_01",
      kind: "routine",
      occurredAt: "2026-04-09T20:15:00Z",
      recordedAt: "2026-04-09T20:18:00Z",
      source: "manual",
      title: "Early wind-down started",
      tags: ["sleep", "routine"],
    })}\n`,
    "utf8",
  );

  const replica: BrowserVaultReplicaLike = await exportHostedBrowserVaultReplica({
    sourceBundleHash: "b".repeat(64),
    vaultRoot,
  });
  const longExperiment = replica.entities.find((entity) => entity.title === "Long Preview");
  const shortExperiment = replica.entities.find((entity) => entity.title === "Short Preview");
  const emptyExperiment = replica.entities.find((entity) => entity.title === "Empty Preview");
  const conditionEntity = replica.entities.find((entity) => entity.family === "condition");

  assert.equal(replica.source.sourceBundleHash, "b".repeat(64));
  assert.equal(
    replica.entities.filter((entity) =>
      entity.family === "condition" ||
      entity.family === "goal" ||
      entity.family === "regimen"
    ).length,
    3,
  );
  assert.match(longExperiment?.bodyPreview ?? "", /\.\.\.$/u);
  assert.equal(shortExperiment?.bodyPreview, "Short hosted preview.");
  assert.equal(emptyExperiment?.bodyPreview, null);
  assert.deepEqual(conditionEntity?.attributes, {});
  assert.equal(conditionEntity?.bodyPreview, null);
  assert.equal(replica.searchRows.some((row) => row.text.includes("Sensitive note")), false);
  assert.equal(replica.timelineRows.some((entry) => entry.id === "evt_hosted_browser_vault_01"), true);
});
