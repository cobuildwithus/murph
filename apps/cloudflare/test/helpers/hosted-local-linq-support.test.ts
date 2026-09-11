import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHostedRunnerContainerEnv } from "../../src/hosted-env-policy.ts";

import {
  buildHostedLinqInboundEvent,
  HOSTED_LOCAL_LINQ_API_TOKEN,
  startHostedLocalLinqStub,
  type HostedLocalLinqWaitScenario,
} from "./hosted-local-linq-support.js";

afterEach(() => {
  vi.useRealTimers();
});

const passiveWaitScenario = {
  buildFailureMessage: async (_userId: string, summaryLines: readonly string[]) =>
    summaryLines.join("\n"),
} satisfies HostedLocalLinqWaitScenario;
const providerHeaders = { authorization: `Bearer ${HOSTED_LOCAL_LINQ_API_TOKEN}` };

describe("hosted local Linq provider stub", () => {
  it.each([
    { attachmentId: "att_pdf_fixture", extension: "pdf", mimeType: "application/pdf" },
    { attachmentId: "att_image_fixture", extension: "png", mimeType: "image/png" },
    { attachmentId: "att_voice_fixture", extension: "wav", mimeType: "audio/wav" },
  ])("keeps $extension download URLs aligned with the runner CDN origin", async ({
    attachmentId,
    extension,
    mimeType,
  }) => {
    const stub = await startHostedLocalLinqStub();

    try {
      const runnerEnv = buildHostedRunnerContainerEnv({
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq",
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "172.17.0.1",
        LINQ_API_BASE_URL: stub.runnerBaseUrl,
        LINQ_API_TOKEN: HOSTED_LOCAL_LINQ_API_TOKEN,
        LINQ_ATTACHMENT_CDN_BASE_URL: stub.attachmentDownloadBaseUrl,
      });
      const expectedCdnOrigin = `${stub.runnerBaseUrl}/attachment-downloads`;
      expect(runnerEnv.LINQ_API_BASE_URL).toBe("https://api.linqapp.com/api/partner/v3");
      expect(runnerEnv.LINQ_ATTACHMENT_CDN_BASE_URL).toBe(expectedCdnOrigin);

      const metadata = await fetch(`${stub.baseUrl}/attachments/${attachmentId}`, {
        headers: { ...providerHeaders, host: "api.linqapp.com" },
      });
      expect(metadata.status).toBe(200);
      const expectedDownloadUrl = `${expectedCdnOrigin}/${attachmentId}.${extension}`;
      await expect(metadata.json()).resolves.toEqual({ download_url: expectedDownloadUrl });

      // The host test reaches the same public byte route over loopback.
      const bytes = await fetch(`${stub.baseUrl}${new URL(expectedDownloadUrl).pathname}`);
      expect(bytes.status).toBe(200);
      expect(bytes.headers.get("content-type")).toBe(mimeType);
      expect((await bytes.arrayBuffer()).byteLength).toBeGreaterThan(0);
      expect(stub.observedRequests.at(-1)?.authorizationStatus).toBe("missing");
    } finally {
      await stub.stop();
    }
  });

  it("serves canonical direct-chat summaries through its shared runtime URL", async () => {
    const stub = await startHostedLocalLinqStub();

    try {
      expect(new URL(stub.runnerBaseUrl).hostname).toBe("host.docker.internal");
      const response = await fetch(`${stub.baseUrl}/chats/chat_direct`, { headers: providerHeaders });

      expect(response.status).toBe(200);
      expect(Number.isSafeInteger(stub.observedRequests[0]?.observedAtEpochMs)).toBe(
        true,
      );
      await expect(response.json()).resolves.toEqual({
        handles: [],
        id: "chat_direct",
        is_group: false,
      });
    } finally {
      await stub.stop();
    }
  });

  it("serves configured canonical group-chat summaries for route-drift scenarios", async () => {
    const stub = await startHostedLocalLinqStub({
      canonicalChats: [
        {
          chatId: "chat_group",
          handles: [
            {
              handle: "+15550000000",
              isMe: true,
              status: "active",
            },
            {
              handle: "+15551112222",
              isMe: false,
              status: "active",
            },
          ],
          isGroup: true,
        },
      ],
    });

    try {
      const response = await fetch(`${stub.baseUrl}/chats/chat_group`, { headers: providerHeaders });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        handles: [
          {
            handle: "+15550000000",
            is_me: true,
            status: "active",
          },
          {
            handle: "+15551112222",
            is_me: false,
            status: "active",
          },
        ],
        id: "chat_group",
        is_group: true,
      });
      await expect(stub.waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "GET",
        expectedPath: "/chats/chat_group",
        scenario: passiveWaitScenario,
        userId: "member_group_chat_summary",
      })).resolves.toHaveLength(1);
    } finally {
      await stub.stop();
    }
  });

  it("creates deterministic presigned attachment uploads for outbound file scenarios", async () => {
    const stub = await startHostedLocalLinqStub();

    try {
      const response = await fetch(`${stub.baseUrl}/attachments`, {
        body: JSON.stringify({
          content_type: "application/pdf",
          filename: "report.pdf",
          size_bytes: 128,
        }),
        headers: {
          ...providerHeaders,
          "content-type": "application/json",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        attachment_id: "attachment_local_1",
        http_method: "PUT",
        required_headers: {
          "content-type": "application/pdf",
        },
        upload_url:
          "https://uploads.example.test/linq-attachments/attachment_local_1",
      });
      await expect(stub.waitForMatchingRequestCount({
        expectedCount: 1,
        expectedMethod: "POST",
        expectedPath: "/attachments",
        scenario: passiveWaitScenario,
        userId: "member_attachment_upload",
      })).resolves.toHaveLength(1);
    } finally {
      await stub.stop();
    }
  });

  it("accepts a media-only send without requiring a caption", async () => {
    const stub = await startHostedLocalLinqStub();
    const expectedPath = "/chats/chat_media_only/messages";

    try {
      const response = await fetch(`${stub.baseUrl}${expectedPath}`, {
        body: JSON.stringify({
          message: {
            parts: [{
              attachment_id: "attachment_local_1",
              type: "media",
            }],
          },
        }),
        headers: {
          ...providerHeaders,
          "content-type": "application/json",
        },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(stub.countAcceptedSends(expectedPath)).toBe(1);
    } finally {
      await stub.stop();
    }
  });

  it("fails one matching logical send before provider acceptance", async () => {
    const stub = await startHostedLocalLinqStub();
    const expectedPath = "/chats/chat_retry/messages";
    const matchRequest = (request: { body: string }) =>
      JSON.parse(request.body).message?.parts?.[0]?.value === "retry this";

    try {
      stub.armNextPreAcceptRetryableSendFailure({
        expectedPath,
        matchRequest,
      });

      const unrelatedResponse = await postLinqStubMessage({
        baseUrl: stub.baseUrl,
        message: "unrelated",
        path: expectedPath,
      });
      expect(unrelatedResponse.status).toBe(200);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await postLinqStubMessage({
          baseUrl: stub.baseUrl,
          message: "retry this",
          path: expectedPath,
        });
        expect(response.status).toBe(503);
      }

      expect(stub.countObservedSends(expectedPath, matchRequest)).toBe(3);
      expect(stub.countAcceptedSends(expectedPath, matchRequest)).toBe(0);

      const retryResponse = await postLinqStubMessage({
        baseUrl: stub.baseUrl,
        message: "retry this",
        path: expectedPath,
      });
      expect(retryResponse.status).toBe(200);
      expect(stub.countAcceptedSends(expectedPath, matchRequest)).toBe(1);
      expect(stub.listObservedMessageIds("chat_retry")).toHaveLength(2);
    } finally {
      await stub.stop();
    }
  });

  it("loses one matching acknowledgment after one provider acceptance", async () => {
    const stub = await startHostedLocalLinqStub();
    const expectedPath = "/chats/chat_lost_ack/messages";
    const matchRequest = (request: { body: string }) =>
      JSON.parse(request.body).message?.parts?.[0]?.value === "accept once";

    try {
      stub.armNextPostAcceptLostAcknowledgment({
        expectedPath,
        matchRequest,
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const lostAcknowledgment = await postLinqStubMessage({
          baseUrl: stub.baseUrl,
          idempotencyKey: "delivery-lost-ack",
          message: "accept once",
          path: expectedPath,
        });
        expect(lostAcknowledgment.status).toBe(503);
      }
      expect(stub.countObservedSends(expectedPath, matchRequest)).toBe(3);
      expect(stub.countAcceptedSends(expectedPath, matchRequest)).toBe(1);
      expect(stub.listObservedMessageIds("chat_lost_ack")).toHaveLength(1);
      const acceptedMessageId = stub.requireLatestObservedMessageId("chat_lost_ack");

      const recoveredAcknowledgment = await postLinqStubMessage({
        baseUrl: stub.baseUrl,
        idempotencyKey: "delivery-lost-ack",
        message: "accept once",
        path: expectedPath,
      });
      expect(recoveredAcknowledgment.status).toBe(200);
      expect(stub.countObservedSends(expectedPath, matchRequest)).toBe(4);
      expect(stub.countAcceptedSends(expectedPath, matchRequest)).toBe(1);
      expect(stub.acceptedSendRequests.filter(matchRequest)).toHaveLength(1);
      expect(stub.listObservedMessageIds("chat_lost_ack")).toHaveLength(1);
      await expect(recoveredAcknowledgment.json()).resolves.toMatchObject({
        message: {
          id: acceptedMessageId,
        },
      });
    } finally {
      await stub.stop();
    }
  });

  it("replays an accepted message for the same provider idempotency key", async () => {
    const stub = await startHostedLocalLinqStub();
    const expectedPath = "/chats/chat_idempotency_replay/messages";
    const matchRequest = (request: { body: string }) =>
      JSON.parse(request.body).message?.parts?.[0]?.value === "accept once";

    try {
      const firstResponse = await postLinqStubMessage({
        baseUrl: stub.baseUrl,
        idempotencyKey: "delivery-idempotency-replay",
        message: "accept once",
        path: expectedPath,
      });
      expect(firstResponse.status).toBe(200);
      const acceptedMessageId = stub.requireLatestObservedMessageId(
        "chat_idempotency_replay",
      );

      const replayResponse = await postLinqStubMessage({
        baseUrl: stub.baseUrl,
        idempotencyKey: "delivery-idempotency-replay",
        message: "accept once",
        path: expectedPath,
      });
      expect(replayResponse.status).toBe(200);

      expect(stub.countObservedSends(expectedPath, matchRequest)).toBe(2);
      expect(stub.countAcceptedSends(expectedPath, matchRequest)).toBe(1);
      expect(stub.listObservedMessageIds("chat_idempotency_replay")).toEqual([
        acceptedMessageId,
      ]);
      await expect(replayResponse.json()).resolves.toMatchObject({
        message: {
          id: acceptedMessageId,
        },
      });

      const conflictingReplayResponse = await postLinqStubMessage({
        baseUrl: stub.baseUrl,
        idempotencyKey: "delivery-idempotency-replay",
        message: "conflicting payload",
        path: expectedPath,
      });
      expect(conflictingReplayResponse.status).toBe(409);
      expect(stub.countAcceptedSends(expectedPath)).toBe(1);
      expect(stub.listObservedMessageIds("chat_idempotency_replay")).toEqual([
        acceptedMessageId,
      ]);
    } finally {
      await stub.stop();
    }
  });

  it("overrides canonical chat classification without changing inbound webhook fixtures", async () => {
    const stub = await startHostedLocalLinqStub();

    try {
      stub.setChatIsGroup("chat_group", true);
      const groupResponse = await fetch(`${stub.baseUrl}/chats/chat_group`, { headers: providerHeaders });
      await expect(groupResponse.json()).resolves.toMatchObject({
        id: "chat_group",
        is_group: true,
      });

      stub.setChatIsGroup("chat_group", false);
      const directResponse = await fetch(`${stub.baseUrl}/chats/chat_group`, { headers: providerHeaders });
      await expect(directResponse.json()).resolves.toMatchObject({
        id: "chat_group",
        is_group: false,
      });
    } finally {
      await stub.stop();
    }
  });

  it("builds group-drift webhook payloads with explicit or omitted directness", () => {
    const explicitDirect = buildHostedLinqInboundEvent(
      "member_local_group_route",
      "chat_group_route",
      {
        isGroup: false,
        service: "iMessage",
      },
    );
    const omitted = buildHostedLinqInboundEvent(
      "member_local_group_route",
      "chat_group_route",
      {
        isGroup: null,
        service: "iMessage",
      },
    );

    expect(explicitDirect).toMatchObject({
      data: {
        chat: {
          id: "chat_group_route",
          is_group: false,
        },
        service: "iMessage",
      },
    });
    expect(JSON.stringify(omitted)).not.toContain('"is_group"');
    expect(omitted).toMatchObject({
      data: {
        chat: {
          id: "chat_group_route",
        },
        service: "iMessage",
      },
    });
  });
});

async function postLinqStubMessage(input: {
  baseUrl: string;
  idempotencyKey?: string;
  message: string;
  path: string;
}): Promise<Response> {
  return await fetch(`${input.baseUrl}${input.path}`, {
    body: JSON.stringify({
      message: {
        ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
        parts: [{
          type: "text",
          value: input.message,
        }],
      },
    }),
    headers: {
      ...providerHeaders,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

it("times out passively without access to runtime recovery controls", async () => {
  const stub = await startHostedLocalLinqStub();

  vi.useFakeTimers();
  try {
    const waitPromise = stub.waitForSend({
      expectedPath: "/chats/passive/messages",
      scenario: passiveWaitScenario,
      userId: "member_passive_linq_wait",
    });
    const rejection = expect(waitPromise).rejects.toThrow(
      /Timed out waiting for 1 Linq request/u,
    );

    await vi.advanceTimersByTimeAsync(180_250);
    await rejection;
  } finally {
    vi.useRealTimers();
    await stub.stop();
  }
});
