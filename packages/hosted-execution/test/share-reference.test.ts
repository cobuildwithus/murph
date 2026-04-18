import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "../src/index.ts";
import {
  parseHostedExecutionRunnerRequest,
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

  it("requires a hydrated share pack on runner requests for share imports", () => {
    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        wake: {
          eventId: "evt_share_accept",
          kind: "vault.share.accepted",
          occurredAt: "2026-04-06T00:00:00.000Z",
          share: {
            ownerUserId: "member_sender",
            shareId: "hshare_123",
          },
          userId: "member_123",
        },
      }),
    ).toThrow(/sharePack is required/i);
  });

  it("accepts a hydrated runner share pack when it matches the share ref", () => {
    const request = {
      bundle: null,
      sharePack: {
        ownerUserId: "member_sender",
        pack: TEST_HOSTED_SHARE_PACK,
        shareId: "hshare_123",
      },
      wake: {
        eventId: "evt_share_accept",
        kind: "vault.share.accepted" as const,
        occurredAt: "2026-04-06T00:00:00.000Z",
        share: {
          ownerUserId: "member_sender",
          shareId: "hshare_123",
        },
        userId: "member_123",
      },
    };

    expect(parseHostedExecutionRunnerRequest(request)).toEqual(request);
  });

  it("rejects mismatched share-pack owner and share ids", () => {
    const baseRequest = {
      bundle: null,
      sharePack: {
        ownerUserId: "owner_999",
        pack: TEST_HOSTED_SHARE_PACK,
        shareId: "share_123",
      },
      wake: {
        eventId: "evt_123",
        kind: "vault.share.accepted" as const,
        occurredAt: "2026-04-08T00:00:00.000Z",
        share: {
          ownerUserId: "owner_123",
          shareId: "share_123",
        },
        userId: "user_123",
      },
    };

    expect(() => parseHostedExecutionRunnerRequest(baseRequest)).toThrow(
      /ownerUserId must match/i,
    );

    expect(() =>
      parseHostedExecutionRunnerRequest({
        ...baseRequest,
        sharePack: {
          ...baseRequest.sharePack,
          ownerUserId: "owner_123",
          shareId: "share_999",
        },
      }),
    ).toThrow(/shareId must match/i);
  });

  it("rejects share packs on non-share wakes", () => {
    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        sharePack: {
          ownerUserId: "owner_123",
          pack: TEST_HOSTED_SHARE_PACK,
          shareId: "share_123",
        },
        wake: buildHostedExecutionAssistantCronTickWake({
          eventId: "evt_runner_request",
          occurredAt: "2026-04-06T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        }),
      }),
    ).toThrow(/sharePack is only supported/i);
  });
});
