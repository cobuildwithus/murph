import {
  HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
  HOSTED_PHYSICAL_NOTES_PATH,
  HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
  type HostedPhysicalNoteRecoveryRequest,
  type HostedPhysicalNoteSendRequest,
} from "@murphai/hosted-execution/physical-notes";
import {
  HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );
  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse:
      mocks.fetchHostedExecutionWebControlPlaneResponse,
  };
});

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
import {
  createHostedWebPhysicalNotePort,
} from "../src/runtime-platform/physical-notes-port.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

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

const RECOVERY_REQUEST = {
  originAssistantInputId: `ain_${"c".repeat(32)}`,
} satisfies HostedPhysicalNoteRecoveryRequest;

const WRITE_FENCE_HEADERS = {
  [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_physical_note",
  [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "generation_physical_note",
  [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "1",
};

beforeEach(() => {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
});

describe("createHostedWebPhysicalNotePort", () => {
  it("allows only the bounded physical-note POST route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
    })).toEqual({
      allowed: true,
      operation: "physical_note_recovery",
    });
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

  it("forwards and strictly parses one paid physical-note recovery check", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: "250000",
      status: "accepted",
    }));
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.resolve!(RECOVERY_REQUEST)).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: "250000",
      status: "accepted",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestInfo = fetchImpl.mock.calls[0]![0];
    const requestUrl = requestInfo instanceof Request
      ? new URL(requestInfo.url)
      : new URL(requestInfo);
    expect(requestUrl.pathname).toBe(
      HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify(RECOVERY_REQUEST),
      method: "POST",
    });
  });

  it("rejects a recovery response that omits the settlement field", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      remainingUnresolved: false,
      retryAfter: null,
      status: "clear",
    }));
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.resolve!(RECOVERY_REQUEST)).rejects.toThrow();
  });

  it("does not replay recovery after a lost response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => createLostBodyResponse());
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.resolve!(RECOVERY_REQUEST)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    [403, "permission_denied"],
    [404, "unavailable"],
  ] as const)(
    "maps recovery HTTP %i to %s without claiming a state change",
    async (status, expectedStatus) => {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      const port = createHostedWebPhysicalNotePort({
        boundUserId: "member_physical_note",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 1_000,
        transport: { mode: "proxy" },
      });

      await expect(port.resolve!(RECOVERY_REQUEST)).resolves.toEqual({
        remainingUnresolved: null,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: expectedStatus,
      });
    },
  );

  it("reports participant authority rejections distinctly", async () => {
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
      status: "permission_denied",
    });
  });

  it("preserves bounded physical-note failure reasons from Web", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      complimentary: true,
      costUsdMicros: "0",
      failureReason: "recipient_address",
      physicalNoteId: "physical_note_failed",
      status: "failed",
    }));
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).resolves.toEqual({
      complimentary: true,
      costUsdMicros: "0",
      failureReason: "recipient_address",
      physicalNoteId: "physical_note_failed",
      status: "failed",
    });
  });

  it("exact-replays the same request after a committed 5xx response", async () => {
    const bodies: BodyInit[] = [];
    const responses = [
      new Response(JSON.stringify({
        error: {
          code: "HOSTED_PHYSICAL_NOTE_UNAVAILABLE",
          message: "Physical-note state is unavailable.",
          retryable: true,
        },
      }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 503,
      }),
      Response.json({
        complimentary: false,
        costUsdMicros: "250000",
        failureReason: "artwork",
        physicalNoteId: "physical_note_replayed",
        status: "failed",
      }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
      if (init?.body) bodies.push(init.body);
      return responses.shift()!;
    });
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).resolves.toMatchObject({
      failureReason: "artwork",
      physicalNoteId: "physical_note_replayed",
      status: "failed",
    });
    expect(bodies).toEqual([JSON.stringify(REQUEST), JSON.stringify(REQUEST)]);
  });

  it("exact-replays the same request after a successful response body is lost", async () => {
    const bodies: BodyInit[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
      if (init?.body) bodies.push(init.body);
      return bodies.length === 1
        ? createLostBodyResponse()
        : Response.json({
            complimentary: false,
            costUsdMicros: "250000",
            physicalNoteId: "physical_note_accepted",
            status: "accepted",
          });
    });
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).resolves.toMatchObject({
      physicalNoteId: "physical_note_accepted",
      status: "accepted",
    });
    expect(bodies).toEqual([JSON.stringify(REQUEST), JSON.stringify(REQUEST)]);
  });

  it.each([401, 403, 409])(
    "keeps first-attempt ambiguity when exact replay returns HTTP %i",
    async (replayStatus) => {
      const initialFailure = new TypeError("First response body lost.");
      const responses = [
        createLostBodyResponse(initialFailure),
        new Response(null, { status: replayStatus }),
      ];
      const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
      const port = createHostedWebPhysicalNotePort({
        boundUserId: "member_physical_note",
        fetchImpl,
        timeoutMs: 5_000,
        transport: { mode: "proxy" },
      });

      await expect(port.send(REQUEST)).rejects.toMatchObject({
        cause: initialFailure,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the first 5xx when exact replay reaches revoked authority", async () => {
    const responses = [
      new Response(null, { status: 503 }),
      new Response(null, { status: 403 }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves an HTTP 408 as uncertain after Web may have accepted the note", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 408 }));
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST)).rejects.toMatchObject({
      status: 408,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not exact-replay after the initiating turn is canceled", async () => {
    const abortController = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      abortController.abort(new DOMException("turn cancelled", "AbortError"));
      return new Response(null, { status: 503 });
    });
    const port = createHostedWebPhysicalNotePort({
      boundUserId: "member_physical_note",
      fetchImpl,
      timeoutMs: 5_000,
      transport: { mode: "proxy" },
    });

    await expect(port.send(REQUEST, {
      signal: abortController.signal,
    })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("forwards physical notes with their longer deadline and keeps other operations on the default", async () => {
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      Response.json({ ok: true }),
    );
    const environment = readHostedExecutionEnvironment(
      createHostedExecutionTestEnv({
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "30000",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
    );
    const env: RunnerOutboundEnvironmentSource = {
      BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
      USER_RUNNER: {
        getByName: () => ({
          validateRuntimeWriteFence: async () => true,
        }),
      },
    };

    for (const path of [
      HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
      HOSTED_PHYSICAL_NOTES_PATH,
      HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
    ]) {
      const url = new URL(`http://web-control.worker${path}`);
      const response = await handleRunnerWebControlRequest({
        env,
        environment,
        request: new Request(url, {
          body: "{}",
          headers: WRITE_FENCE_HEADERS,
          method: "POST",
        }),
        url,
        userId: "member_physical_note",
      });
      expect(response.status).toBe(200);
    }

    expect(mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls.map(
      ([call]) => call.timeoutMs,
    )).toEqual([
      environment.webControlTimeoutMs,
      HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
      environment.webControlTimeoutMs,
    ]);
  });
});

function createLostBodyResponse(
  error: Error = new TypeError("Response body lost."),
): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  }), { status: 200 });
}
