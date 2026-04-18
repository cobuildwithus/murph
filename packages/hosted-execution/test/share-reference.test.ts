import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionWakeFromDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionRunnerRequest,
} from "../src/index.ts";

describe("vault.share.accepted dispatch contract", () => {
  it("preserves the tiny share ref in the dispatch payload", () => {
    const dispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "evt_share_accept",
      memberId: "member_123",
      occurredAt: "2026-04-06T00:00:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "hshare_123",
      },
    });

    expect(parseHostedExecutionDispatchRequest(dispatch)).toEqual(dispatch);
  });

  it("rejects share acceptance payloads that omit the owner share ref", () => {
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
    ).toThrow(/ownerUserId/i);
  });

  it("requires a hydrated share pack on runner requests for share imports", () => {
    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        dispatch: {
          event: {
            kind: "vault.share.accepted",
            share: {
              ownerUserId: "member_sender",
              shareId: "hshare_123",
            },
            userId: "member_123",
          },
          eventId: "evt_share_accept",
          occurredAt: "2026-04-06T00:00:00.000Z",
        },
      }),
    ).toThrow(/sharePack is required/i);
  });

  it("accepts a hydrated runner share pack when it matches the share ref", () => {
    const request = {
      bundle: null,
      dispatch: {
        event: {
          kind: "vault.share.accepted" as const,
          share: {
            ownerUserId: "member_sender",
            shareId: "hshare_123",
          },
          userId: "member_123",
        },
        eventId: "evt_share_accept",
        occurredAt: "2026-04-06T00:00:00.000Z",
      },
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

  it("rejects runner requests when the dispatch and wake metadata diverge", () => {
    const dispatch = buildHostedExecutionAssistantCronTickDispatch({
      eventId: "evt_runner_request",
      occurredAt: "2026-04-06T00:00:00.000Z",
      reason: "manual",
      userId: "member_123",
    });
    const wake = buildHostedExecutionWakeFromDispatch(dispatch);

    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        dispatch: {
          ...dispatch,
          eventId: "evt_runner_request_dispatch_mismatch",
        },
        wake,
      }),
    ).toThrow(/wake.eventId must match dispatch.eventId/i);

    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        dispatch: {
          ...dispatch,
          occurredAt: "2026-04-06T01:00:00.000Z",
        },
        wake,
      }),
    ).toThrow(/wake.occurredAt must match dispatch.occurredAt/i);

    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        dispatch: {
          ...dispatch,
          event: {
            ...dispatch.event,
            userId: "member_other",
          },
        },
        wake,
      }),
    ).toThrow(/wake.userId must match dispatch.event.userId/i);

    expect(() =>
      parseHostedExecutionRunnerRequest({
        bundle: null,
        dispatch,
        wake: {
          ...wake,
          reason: "alarm",
        },
      }),
    ).toThrow(/wake must describe the same wake as dispatch/i);
  });
});
