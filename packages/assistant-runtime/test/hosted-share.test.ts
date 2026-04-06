import { describe, expect, it, vi } from "vitest";

import type { SharePack } from "@murphai/contracts";

const mocks = vi.hoisted(() => ({
  importSharePackIntoVault: vi.fn(),
}));

vi.mock("@murphai/core", () => ({
  importSharePackIntoVault: mocks.importSharePackIntoVault,
}));

import { handleHostedShareAcceptedDispatch } from "../src/hosted-runtime/events/share.ts";

const SHARE_PACK: SharePack = {
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

describe("handleHostedShareAcceptedDispatch", () => {
  it("imports the inline share pack without requiring a second lookup", async () => {
    mocks.importSharePackIntoVault.mockResolvedValueOnce({
      foods: [],
      meal: null,
      pack: SHARE_PACK,
      protocols: [],
      recipes: [],
    });

    const result = await handleHostedShareAcceptedDispatch({
      dispatch: {
        event: {
          kind: "vault.share.accepted",
          share: {
            pack: SHARE_PACK,
            shareId: "hshare_123",
          },
          userId: "member_123",
        },
      },
      vaultRoot: "/tmp/vault",
    });

    expect(mocks.importSharePackIntoVault).toHaveBeenCalledWith({
      pack: SHARE_PACK,
      vaultRoot: "/tmp/vault",
    });
    expect(result.shareImportTitle).toBe("Breakfast staples");
  });
});
