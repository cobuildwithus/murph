import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  buildHostedExecutionVaultShareAcceptedDispatch,
  parseHostedExecutionDispatchRequest,
} from "../src/index.ts";

describe("vault.share.accepted dispatch contract", () => {
  it("preserves the inline share pack in the dispatch payload", () => {
    const dispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "evt_share_accept",
      memberId: "member_123",
      occurredAt: "2026-04-06T00:00:00.000Z",
      share: {
        pack: TEST_HOSTED_SHARE_PACK,
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
