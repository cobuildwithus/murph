import { describe, expect, it, vi } from "vitest";

import type {
  HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import {
  createCloudflareHostedMailboxPayloadDecoder,
} from "../src/runtime-bridge-mailbox-payload-decode.ts";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
  type HostedMailboxPayloadDecodeInput,
} from "../src/runtime-mailbox-payload-decode-contract.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";

describe("createCloudflareHostedMailboxPayloadDecoder", () => {
  it("posts decode requests through web-control with the active write fence", async () => {
    const calls: Array<{
      body: unknown;
      headers: Headers;
      init: RequestInit | undefined;
      url: URL;
    }> = [];
    const wake = createSystemWake();
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(readStringBody(init?.body));
      calls.push({
        body,
        headers: new Headers(init?.headers),
        init,
        url: readFetchUrl(input),
      });
      return Response.json({
        status: "decoded",
        wake,
      });
    };
    const decoder = createCloudflareHostedMailboxPayloadDecoder({
      fetchImpl,
      readCurrentLease: () => ({
        attemptId: "attempt_decode",
        leaseGeneration: "4",
        userId: "member_decode",
        workspaceVersion: "9",
      }),
      timeoutMs: 1000,
    });

    await expect(decoder.decode(createDecodeInput())).resolves.toEqual({
      status: "decoded",
      wake,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url.pathname).toBe(HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH);
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(call?.body).toEqual(createDecodeInput());
    expect(call?.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(call?.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe("attempt_decode");
    expect(call?.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe("4");
    expect(call?.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe("9");
  });

  it("fails closed without a current write fence before calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const decoder = createCloudflareHostedMailboxPayloadDecoder({
      fetchImpl,
      readCurrentLease: () => null,
      timeoutMs: 1000,
    });

    await expect(decoder.decode(createDecodeInput()))
      .rejects.toThrow("requires a runtime write fence");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves the HTTP status on decode failures", async () => {
    const decoder = createCloudflareHostedMailboxPayloadDecoder({
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
      readCurrentLease: () => ({
        attemptId: "attempt_decode",
        leaseGeneration: "4",
        userId: "member_decode",
        workspaceVersion: "9",
      }),
      timeoutMs: 1000,
    });

    await expect(decoder.decode(createDecodeInput())).rejects.toMatchObject({
      message: "Hosted mailbox payload decode failed with HTTP 503.",
      status: 503,
      statusCode: 503,
    });
  });

  it("reports invalid JSON responses as decode contract failures", async () => {
    const decoder = createCloudflareHostedMailboxPayloadDecoder({
      fetchImpl: async () =>
        new Response("{", {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }),
      readCurrentLease: () => ({
        attemptId: "attempt_decode",
        leaseGeneration: "4",
        userId: "member_decode",
        workspaceVersion: "9",
      }),
      timeoutMs: 1000,
    });

    await expect(decoder.decode(createDecodeInput()))
      .rejects.toThrow("returned invalid JSON");
  });
});

function createDecodeInput(): HostedMailboxPayloadDecodeInput {
  return {
    itemRef: {
      dedupeKey: "event_decode",
      id: "mailbox_item_decode",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "1",
      occurredAt: "2026-06-03T00:00:00.000Z",
      userId: "member_decode",
    },
    payloadCiphertext: "opaque-mailbox-payload",
    payloadRequestId: "request_decode",
    payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
    payloadSource: "sidecar",
  };
}

function createSystemWake(): HostedExecutionSystemWake {
  return {
    eventId: "event_decode",
    kind: "member.channels.updated",
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: "2026-06-03T00:00:00.000Z",
    userId: "member_decode",
  };
}

function readFetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input);
}

function readStringBody(body: BodyInit | null | undefined): string {
  if (typeof body === "string") {
    return body;
  }

  throw new TypeError("Expected a string request body.");
}
