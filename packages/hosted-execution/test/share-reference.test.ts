import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionVaultShareAcceptedWake,
} from "../src/index.ts";
import {
  parseHostedExecutionWake,
} from "../src/index.ts";

describe("vault.share.accepted wake contract", () => {
  it("preserves the tiny share ref in the wake payload", () => {
    const wake = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share_accept",
      memberId: "member_123",
      occurredAt: "2026-04-06T00:00:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "hshare_123",
      },
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
  });

  it("rejects share acceptance wakes that omit the owner share ref", () => {
    expect(() =>
      parseHostedExecutionWake({
        eventId: "evt_share_accept",
        kind: "vault.share.accepted",
        occurredAt: "2026-04-06T00:00:00.000Z",
        share: {
          shareId: "hshare_123",
        },
        userId: "member_123",
      }),
    ).toThrow(/ownerUserId/i);
  });

});
