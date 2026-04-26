import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  initializeVault,
  readFood,
} from "@murphai/core";
import type { SharePack } from "@murphai/contracts";
import { buildHostedExecutionVaultShareAcceptedWake } from "@murphai/hosted-execution";

import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";
import { handleHostedShareAcceptedWake } from "../src/hosted-runtime/events/share.ts";

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

describe("handleHostedShareAcceptedWake", () => {
  test("imports the inline share pack into a real vault", async () => {
    const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace(
      "murph-hosted-share-import-",
    );

    try {
      await initializeVault({
        createdAt: "2026-04-06T00:00:00.000Z",
        vaultRoot,
      });

      const pack = buildSharePack();
      const result = await handleHostedShareAcceptedWake({
        wake: buildHostedExecutionVaultShareAcceptedWake({
          eventId: "evt_share_accepted",
          memberId: "member_123",
          occurredAt: "2026-04-06T00:00:00.000Z",
          share: {
            ownerUserId: "member_sender",
            shareId: "hshare_123",
          },
        }),
        sharePack: {
          ownerUserId: "member_sender",
          pack,
          shareId: "hshare_123",
        },
        vaultRoot,
      });

      assert.equal(result.shareImportTitle, "Breakfast staples");
      assert.ok(result.shareImportResult);
      assert.equal(result.shareImportResult.pack.title, "Breakfast staples");
      assert.equal(result.shareImportResult.foods.length, 1);
      assert.equal(result.shareImportResult.regimens.length, 0);
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

  test("rejects share packs whose owner does not match the dispatch share reference", async () => {
    const pack = buildSharePack();

    await assert.rejects(
      handleHostedShareAcceptedWake({
        wake: buildHostedExecutionVaultShareAcceptedWake({
          eventId: "evt_share_owner_mismatch",
          memberId: "member_123",
          occurredAt: "2026-04-06T00:00:00.000Z",
          share: {
            ownerUserId: "member_sender",
            shareId: "hshare_123",
          },
        }),
        sharePack: {
          ownerUserId: "member_other",
          pack,
          shareId: "hshare_123",
        },
        vaultRoot: "/tmp/vault-root",
      }),
      /ownerUserId must match the canonical share reference/,
    );
  });

  test("rejects share packs whose share id does not match the dispatch share reference", async () => {
    const pack = buildSharePack();

    await assert.rejects(
      handleHostedShareAcceptedWake({
        wake: buildHostedExecutionVaultShareAcceptedWake({
          eventId: "evt_share_id_mismatch",
          memberId: "member_123",
          occurredAt: "2026-04-06T00:00:00.000Z",
          share: {
            ownerUserId: "member_sender",
            shareId: "hshare_123",
          },
        }),
        sharePack: {
          ownerUserId: "member_sender",
          pack,
          shareId: "hshare_other",
        },
        vaultRoot: "/tmp/vault-root",
      }),
      /shareId must match the canonical share reference/,
    );
  });
});
