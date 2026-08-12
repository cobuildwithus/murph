import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAssistantAskRequestId,
} from "@/src/lib/hosted-groups/group-assistant-ask";

const mocks = vi.hoisted(() => ({
  handoffHostedMailboxWake: vi.fn(),
  handleTool: vi.fn(),
  requireJsonCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: mocks.requireJsonCallback,
}));

vi.mock("@/src/lib/hosted-groups/group-tool", () => ({
  handleHostedRuntimeGroupTool: mocks.handleTool,
}));
vi.mock("@/src/lib/hosted-orchestration/mailbox-wake", () => ({
  handoffHostedMailboxWake: mocks.handoffHostedMailboxWake,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/groups/tool/route"
);

let route: RouteModule;

describe("hosted group tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/groups/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handoffHostedMailboxWake.mockResolvedValue(undefined);
    mocks.requireJsonCallback.mockImplementation(async (
      request: Request,
      options: { maxBodyBytes: number },
    ) => {
      const payloadText = await request.text();
      if (new TextEncoder().encode(payloadText).byteLength > options.maxBodyBytes) {
        throw new RangeError(`Request body exceeded ${options.maxBodyBytes} bytes.`);
      }
      return {
        payload: JSON.parse(payloadText),
        userId: "member_group_runtime",
      };
    });
    mocks.handleTool.mockResolvedValue({
      action: "read_shared",
      result: {
        members: [],
        requestedProjectionScopeKeys: ["steps-days.v0"],
        status: "ok",
      },
    });
  });

  it("accepts a valid read_shared callback larger than the former 8 KiB limit", async () => {
    const body = {
      action: "read_shared",
      linqSenderHandles: Array.from(
        { length: 32 },
        (_, index) => `${index}`.padStart(2, "0") + "\0".repeat(64),
      ),
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    };
    const payloadText = JSON.stringify(body);
    const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
    expect(payloadBytes).toBeGreaterThan(8 * 1_024);
    expect(payloadBytes).toBeLessThanOrEqual(
      HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
    );
    const request = new Request(
      `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
      {
        body: payloadText,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireJsonCallback).toHaveBeenCalledWith(request, {
      maxBodyBytes: HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
    });
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_group_runtime",
      request: body,
      // Anchored before the signed-callback read above, so the verification and
      // nonce work it covers is charged to whatever budget the tool derives.
      requestStartedAtMs: expect.any(Number),
      scheduleMailboxWake: expect.any(Function),
    });
    const [handled] = mocks.handleTool.mock.calls.at(-1) as [
      { requestStartedAtMs: number },
    ];
    expect(handled.requestStartedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it("accepts an eight-scope group email preparation callback", async () => {
    const body = {
      action: "prepare_email",
      projectionScopes: [
        { projectionKind: "steps-days.v0" },
        { projectionKind: "activity-days.v0" },
        { projectionKind: "workout-days.v0" },
        { projectionKind: "workouts.v0" },
        { projectionKind: "sleep-duration-days.v0" },
        { projectionKind: "sleep-times.v0" },
        { projectionKind: "resting-heart-rate-days.v0" },
        { projectionKind: "hrv-days.v0" },
      ],
    };
    mocks.handleTool.mockResolvedValueOnce({
      action: "prepare_email",
      result: {
        authorizationProof: "a".repeat(64),
        groupId: "hgrp_test",
        missingEmailParticipants: [],
        participants: [],
        status: "ok",
      },
    });
    const request = new Request(
      `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_group_runtime",
      request: body,
      requestStartedAtMs: expect.any(Number),
      scheduleMailboxWake: expect.any(Function),
    });
  });

  it.each([
    ["P2010", "P2010"],
    ["PRIVATE_CODE", null],
  ] as const)(
    "returns bounded Assistant Ask diagnostics for unexpected admission code %s",
    async (errorCode, expectedDiagnosticCode) => {
      const originAssistantInputId = `ain_${"a".repeat(32)}`;
      const body = {
        action: "ask",
        groupLabel: "100 Club",
        originAssistantInputId,
        originSessionId: "session_private",
        question: "What exercises are scheduled today?",
      };
      mocks.handleTool.mockRejectedValue(
        Object.assign(
          new Error("Private database detail must not reach the caller."),
          { code: errorCode },
        ),
      );
      const request = new Request(
        `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      const response = await route.POST(request);

      expect(response.status).toBe(500);
      expect(response.headers.get(HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER))
        .toBe(expectedDiagnosticCode);
      expect(response.headers.get(HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER))
        .toBe(createHostedAssistantAskRequestId({
          memberId: "member_group_runtime",
          originAssistantInputId,
        }));
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal error.",
        },
      });
    },
  );

  it("schedules accepted Ask requests through the shared direct wake path", async () => {
    const body = {
      action: "ask",
      groupLabel: "100 Club",
      originAssistantInputId: `ain_${"a".repeat(32)}`,
      originSessionId: "session_private",
      question: "What exercises are scheduled today?",
    };
    mocks.handleTool.mockImplementationOnce(async (input) => {
      await input.scheduleMailboxWake({
        expectedUserId: "member-group-runtime",
        mailboxItemId: "aask_req_direct_wake",
      });
      return {
        action: "ask",
        requestId: "aask_req_direct_wake",
        status: "accepted",
      };
    });
    const request = new Request(
      `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledWith({
      directWakeSource: "assistant-ask-request",
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_direct_wake",
      signal: request.signal,
    });
  });

  it("does not acknowledge an accepted Ask when its durable handoff rejects", async () => {
    mocks.handoffHostedMailboxWake.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );
    const originAssistantInputId = `ain_${"a".repeat(32)}`;
    const body = {
      action: "ask",
      groupLabel: "100 Club",
      originAssistantInputId,
      originSessionId: "session_private",
      question: "What exercises are scheduled today?",
    };
    mocks.handleTool.mockImplementationOnce(async (input) => {
      await input.scheduleMailboxWake({
        expectedUserId: "member-group-runtime",
        mailboxItemId: "aask_req_direct_wake",
      });
      return {
        action: "ask",
        requestId: "aask_req_direct_wake",
        status: "accepted",
      };
    });
    const request = new Request(
      `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(500);
    expect(response.headers.get(HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER))
      .toBe(createHostedAssistantAskRequestId({
        memberId: "member_group_runtime",
        originAssistantInputId,
      }));
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
  });

  it.each([
    {
      label: "canonical group destination",
      requestBody: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"c".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "group",
      },
      expectedRequest: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"c".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "group",
      },
      toolResponse: {
        action: "ask_current_sender",
        responseDestination: "group",
        result: { status: "accepted" },
      },
      expectedResponse: {
        action: "ask_current_sender",
        responseDestination: "group",
        result: { status: "accepted" },
      },
    },
    {
      label: "canonical direct destination",
      requestBody: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"d".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "current_sender",
      },
      expectedRequest: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"d".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "current_sender",
      },
      toolResponse: {
        action: "ask_current_sender",
        responseDestination: "current_sender",
        result: { status: "accepted" },
      },
      expectedResponse: {
        action: "ask_current_sender",
        responseDestination: "current_sender",
        result: { status: "accepted" },
      },
    },
    {
      label: "legacy group transport",
      requestBody: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"e".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
      },
      expectedRequest: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"e".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "group",
      },
      toolResponse: {
        action: "ask_current_sender",
        responseDestination: "group",
        result: { status: "accepted" },
      },
      expectedResponse: {
        action: "ask_current_sender",
        result: { status: "accepted" },
      },
    },
    {
      label: "legacy direct transport",
      requestBody: {
        action: "message_current_sender",
        origin: {
          assistantInputId: `ain_${"f".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
      },
      expectedRequest: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"f".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "current_sender",
      },
      toolResponse: {
        action: "ask_current_sender",
        responseDestination: "current_sender",
        result: { status: "accepted" },
      },
      expectedResponse: {
        action: "message_current_sender",
        result: { status: "accepted" },
      },
    },
  ])(
    "keeps $label compatible while canonicalizing Web admission",
    async ({
      expectedRequest,
      expectedResponse,
      requestBody,
      toolResponse,
    }) => {
      mocks.handleTool.mockResolvedValueOnce(toolResponse);
      const request = new Request(
        `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
        {
          body: JSON.stringify(requestBody),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      const response = await route.POST(request);

      expect(response.status).toBe(200);
      expect(mocks.handleTool).toHaveBeenCalledWith({
        memberId: "member_group_runtime",
        request: expectedRequest,
        requestStartedAtMs: expect.any(Number),
        scheduleMailboxWake: expect.any(Function),
      });
      await expect(response.json()).resolves.toEqual(expectedResponse);
    },
  );

  it.each([
    {
      body: {
        action: "ask_member",
        grantId: "grant_sleep",
        origin: {
          assistantInputId: `ain_${"b".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        question: "How has the grantor been sleeping lately?",
      },
      expectedUserId: "member-grantor",
      mailboxItemId: "aask_req_disclosure_one",
      toolResponse: {
        action: "ask_member",
        result: { status: "accepted" },
      },
    },
    {
      body: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"c".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "group",
      },
      expectedUserId: "member-sender",
      mailboxItemId: "aask_req_current_sender",
      toolResponse: {
        action: "ask_current_sender",
        responseDestination: "group",
        result: { status: "accepted" },
      },
    },
    {
      body: {
        action: "ask_current_sender",
        origin: {
          assistantInputId: `ain_${"d".repeat(32)}`,
          kind: "accepted_input",
          sessionId: "session_group",
        },
        responseDestination: "current_sender",
      },
      expectedUserId: "member-sender",
      mailboxItemId: "aask_req_private_sender",
      toolResponse: {
        action: "ask_current_sender",
        responseDestination: "current_sender",
        result: { status: "accepted" },
      },
    },
  ] as const)(
    "does not acknowledge an accepted $toolResponse.action when its durable handoff rejects",
    async ({
      body,
      expectedUserId,
      mailboxItemId,
      toolResponse,
    }) => {
      mocks.handoffHostedMailboxWake.mockRejectedValueOnce(
        new Error("Temporal unavailable"),
      );
      mocks.handleTool.mockImplementationOnce(async (input) => {
        await input.scheduleMailboxWake({ expectedUserId, mailboxItemId });
        return toolResponse;
      });
      const request = new Request(
        `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      const response = await route.POST(request);

      expect(response.status).toBe(500);
      expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledWith({
        directWakeSource: "assistant-ask-request",
        expectedUserId,
        mailboxItemId,
        signal: request.signal,
      });
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal error.",
        },
      });
    },
  );
});
