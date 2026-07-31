import {
  HOSTED_PHYSICAL_NOTES_PATH,
  type HostedPhysicalNoteSendRequest,
} from "@murphai/hosted-execution/physical-notes";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedWebPhysicalNotePort,
} from "../src/runtime-platform/physical-notes-port.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";

const REQUEST = {
  artwork: {
    expiresAt: "2026-08-01T00:00:00.000Z",
    sha256: "a".repeat(64),
    url: "https://media.example.test/private-note",
  },
  originAssistantInputId: `ain_${"b".repeat(32)}`,
  recipient: {
    addressLine1: "123 Main Street",
    city: "Atlanta",
    name: "Alex Example",
    postalCode: "30301",
    state: "GA",
  },
  requestKey: "physical_note_test",
} satisfies HostedPhysicalNoteSendRequest;

describe("createHostedWebPhysicalNotePort", () => {
  it("allows only the bounded physical-note POST route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_PHYSICAL_NOTES_PATH,
    })).toEqual({
      allowed: true,
      operation: "physical_note_send",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_PHYSICAL_NOTES_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_PHYSICAL_NOTES_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("reports typed pre-provider Web rejections as definite failures", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_GROUP_PARTICIPANT_ACTION_AUTHORITY_REQUIRED",
        message: "Current participant authority is required.",
        retryable: false,
      },
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 403,
    }));
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).resolves.toEqual({
      complimentary: false,
      costUsdMicros: "0",
      physicalNoteId: null,
      status: "failed",
    });
  });

  it("preserves uncertain server failures for the no-retry boundary", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_PHYSICAL_NOTE_UNAVAILABLE",
        message: "Physical-note state is unavailable.",
        retryable: true,
      },
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 503,
    }));
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).rejects.toMatchObject({
      code: "HOSTED_PHYSICAL_NOTE_UNAVAILABLE",
      status: 503,
    });
  });
});
