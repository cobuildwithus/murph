import { describe, expect, it } from "vitest";

import type { SharePack } from "@murphai/contracts";

import {
  buildHostedExecutionVaultShareAcceptedDispatch,
  parseHostedExecutionDispatchRequest,
} from "../src/index.ts";

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

describe("vault.share.accepted dispatch contract", () => {
  it("preserves the inline share pack in the dispatch payload", () => {
    const dispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "evt_share_accept",
      memberId: "member_123",
      occurredAt: "2026-04-06T00:00:00.000Z",
      share: {
        pack: SHARE_PACK,
        shareId: "hshare_123",
      },
    });

    expect(parseHostedExecutionDispatchRequest(dispatch)).toEqual(dispatch);
  });

  it("rejects share acceptance payloads that omit the inline share pack", () => {
    expect(() =>
      parseHostedExecutionDispatchRequest({
        event: {
          kind: "vault.share.accepted",
          share: {
            shareId: "hshare_123",
          },
          userId: "member_123",
        },
        eventId: "evt_share_accept",
        occurredAt: "2026-04-06T00:00:00.000Z",
      }),
    ).toThrow(/share pack/i);
  });
});
