import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  buildHostedExecutionVaultShareAcceptedWake,
} from "../src/index.ts";
import {
  parseHostedExecutionRunnerRequest,
  parseHostedIngressEnvelope,
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

    expect(parseHostedIngressEnvelope(wake)).toEqual(wake);
  });

  it("rejects share acceptance wakes that omit the owner share ref", () => {
    expect(() =>
      parseHostedIngressEnvelope({
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

  it("accepts hydrated runner share packs on run-drain events", () => {
    const request = {
      bundle: null,
      run: {
        attempt: 1,
        runId: "run_123",
        startedAt: "2026-04-06T00:00:00.000Z",
      },
      runDrain: {
        acquiredAt: "2026-04-06T00:00:00.000Z",
        events: [
          {
            seq: "24",
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
            wakeId: "wake_24",
          },
        ],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        runId: "run_123",
        triggerKind: "external_ingress" as const,
        userId: "member_123",
      },
    };

    expect(parseHostedExecutionRunnerRequest(request)).toEqual(request);
  });
});
