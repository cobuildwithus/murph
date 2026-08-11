import {
  HOSTED_PHYSICAL_NOTES_PATH,
  HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
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
      HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
      environment.webControlTimeoutMs,
    ]);
  });
});
