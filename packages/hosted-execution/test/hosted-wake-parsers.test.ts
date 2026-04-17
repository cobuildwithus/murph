import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionCursorState,
  parseHostedWakeCommitResponse,
  parseHostedWakeFetchResponse,
} from "../src/parsers.ts";

describe("hosted wake parser contracts", () => {
  it("parses hosted wake batch responses with bigint-string cursor fields", () => {
    const parsed = parseHostedWakeFetchResponse({
      cursor: {
        committedSeq: "12",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "13",
        snapshotRef: {
          kind: "bundle",
          ref: "bundle-1",
        },
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      wakes: [
        {
          behavior: "coalescing",
          coalescingKey: "member.channels.updated:member-1",
          createdAt: "2026-04-17T00:00:00.000Z",
          dedupeKey: "member.channels.updated:test",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadJson: {
            eventId: "evt_123",
          },
          payloadBytes: 88,
          payloadInlineCiphertext: "ciphertext",
          payloadRef: null,
          payloadSchema: "murph.hosted-wake-dispatch.v1",
          quarantineCode: null,
          quarantinedAt: null,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
    });

    expect(parsed.cursor.version).toBe("4");
    expect(parsed.wakes[0]).toMatchObject({
      behavior: "coalescing",
      kind: "member.channels.updated",
      payloadJson: {
        eventId: "evt_123",
      },
      seq: "12",
    });
  });

  it("rejects invalid bigint strings in hosted wake responses", () => {
    expect(() => parseHostedExecutionCursorState({
      committedSeq: "not-a-bigint",
      createdAt: "2026-04-17T00:00:00.000Z",
      nextSeq: "2",
      snapshotRef: null,
      updatedAt: "2026-04-17T00:00:01.000Z",
      userId: "member-1",
      version: "1",
    })).toThrow(/committedSeq/i);
  });

  it("parses cursor commit responses", () => {
    const parsed = parseHostedWakeCommitResponse({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:05.000Z",
        userId: "member-1",
        version: "8",
      },
    });

    expect(parsed).toEqual({
      committed: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: null,
        updatedAt: "2026-04-17T00:00:05.000Z",
        userId: "member-1",
        version: "8",
      },
    });
  });
});
