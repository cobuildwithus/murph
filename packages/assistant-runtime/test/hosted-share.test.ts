import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, test } from "vitest";

import {
  ID_PREFIXES,
  readFood,
  REQUIRED_DIRECTORIES,
  VAULT_LAYOUT,
  VAULT_SCHEMA_VERSION,
} from "@murphai/core";
import type { SharePack } from "@murphai/contracts";

import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";
import { handleHostedShareAcceptedDispatch } from "../src/hosted-runtime/events/share.ts";

const VAULT_PATHS = {
  allergiesRoot: "bank/allergies",
  assessmentLedgerRoot: "ledger/assessments",
  conditionsRoot: "bank/conditions",
  coreDocument: "CORE.md",
  familyRoot: "bank/family",
  foodsRoot: "bank/foods",
  geneticsRoot: "bank/genetics",
  goalsRoot: "bank/goals",
  journalRoot: "journal",
  experimentsRoot: "bank/experiments",
  profileCurrentDocument: "bank/profile/current.md",
  profileRoot: "bank/profile",
  profileSnapshotsRoot: "ledger/profile-snapshots",
  providersRoot: "bank/providers",
  recipesRoot: "bank/recipes",
  workoutFormatsRoot: "bank/workout-formats",
  rawAssessmentsRoot: "raw/assessments",
  rawRoot: "raw",
  eventsRoot: "ledger/events",
  protocolsRoot: "bank/protocols",
  samplesRoot: "ledger/samples",
  auditRoot: "audit",
  exportsRoot: "exports",
} as const;

const VAULT_SHARDS = {
  assessments: "ledger/assessments/YYYY/YYYY-MM.jsonl",
  events: "ledger/events/YYYY/YYYY-MM.jsonl",
  profileSnapshots: "ledger/profile-snapshots/YYYY/YYYY-MM.jsonl",
  samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
  audit: "audit/YYYY/YYYY-MM.jsonl",
} as const;

function buildSharePack(): SharePack {
  return {
    createdAt: "2026-04-06T00:00:00.000Z",
    entities: [
      {
        kind: "food",
        payload: {
          kind: "smoothie",
          status: "active",
          title: "Overnight oats",
        },
        ref: "food.oats",
      },
    ],
    schemaVersion: "murph.share-pack.v1",
    title: "Breakfast staples",
  };
}

async function bootstrapVaultRoot(vaultRoot: string): Promise<void> {
  for (const relativeDirectory of REQUIRED_DIRECTORIES) {
    await mkdir(path.join(vaultRoot, relativeDirectory), {
      recursive: true,
    });
  }

  const vaultPrefixes = Object.fromEntries(
    Object.entries(ID_PREFIXES).filter(([key]) => key !== "automation" && key !== "memory"),
  );
  const vaultMetadata = {
    createdAt: "2026-04-06T00:00:00.000Z",
    idPolicy: {
      format: "prefix_ulid",
      prefixes: vaultPrefixes,
    },
    paths: VAULT_PATHS,
    schemaVersion: VAULT_SCHEMA_VERSION,
    shards: VAULT_SHARDS,
    timezone: "UTC",
    title: "Murph Vault",
    vaultId: "vault_01J00000000000000000000000",
  };

  await writeFile(
    path.join(vaultRoot, VAULT_LAYOUT.metadata),
    `${JSON.stringify(vaultMetadata, null, 2)}\n`,
    "utf8",
  );
}

describe("handleHostedShareAcceptedDispatch", () => {
  test("imports the inline share pack into a real vault", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "murph-hosted-share-import-",
    );

    try {
      await bootstrapVaultRoot(vaultRoot);

      const pack = buildSharePack();
      const result = await handleHostedShareAcceptedDispatch({
        dispatch: {
          event: {
            kind: "vault.share.accepted",
            share: {
              pack,
              shareId: "hshare_123",
            },
            userId: "member_123",
          },
        },
        vaultRoot,
      });

      assert.equal(result.shareImportTitle, "Breakfast staples");
      assert.equal(result.shareImportResult.pack.title, "Breakfast staples");
      assert.equal(result.shareImportResult.foods.length, 1);
      assert.equal(result.shareImportResult.protocols.length, 0);
      assert.equal(result.shareImportResult.recipes.length, 0);
      assert.equal(result.shareImportResult.meal, null);

      const [importedRecord] = result.shareImportResult.foods;
      assert.ok(importedRecord);

      const importedFood = await readFood({
        vaultRoot,
        foodId: importedRecord.foodId,
      });

      assert.equal(importedFood.title, "Overnight oats");
      assert.equal(importedFood.kind, "smoothie");
      assert.equal(importedFood.status, "active");
    } finally {
      await cleanup();
    }
  });
});
