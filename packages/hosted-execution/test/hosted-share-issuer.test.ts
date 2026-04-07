import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  verifyHostedExecutionSignature,
} from "@murphai/hosted-execution";
import {
  createHostedExecutionServerShareLinkIssuer,
  HOSTED_EXECUTION_HOSTED_SHARE_INTERNAL_CREATE_PATH,
} from "@murphai/hosted-execution/web-control-plane";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";

describe("hosted share issuer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the shared hosted share internal-create route path", () => {
    expect(HOSTED_EXECUTION_HOSTED_SHARE_INTERNAL_CREATE_PATH).toBe(
      "/api/hosted-share/internal/create",
    );
  });

  it("creates hosted share links through the signed hosted web-control client", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        inviteCode: "invite_123",
        joinUrl: "https://join.example.test/join/invite_123?share=share_123",
        shareCode: "share_123",
        shareUrl: "https://join.example.test/share/share_123?invite=invite_123",
        url: "https://join.example.test/join/invite_123?share=share_123",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const issuer = createHostedExecutionServerShareLinkIssuer({
      baseUrl: "https://join.example.test",
      boundUserId: "member_123",
      signingSecret: "dispatch-secret",
      timeoutMs: 10_000,
    });

    await expect(
      issuer.issue({
        expiresInHours: 24,
        inviteCode: "invite_123",
        pack: TEST_HOSTED_SHARE_PACK,
        recipientPhoneNumber: "+15551234567",
      }),
    ).resolves.toMatchObject({
      inviteCode: "invite_123",
      shareCode: "share_123",
      url: "https://join.example.test/join/invite_123?share=share_123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://join.example.test/api/hosted-share/internal/create",
      expect.objectContaining({
        headers: expect.any(Headers),
        method: "POST",
      }),
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? ""));
    expect(requestBody).toEqual({
      expiresInHours: 24,
      inviteCode: "invite_123",
      pack: TEST_HOSTED_SHARE_PACK,
      recipientPhoneNumber: "+15551234567",
      senderMemberId: "member_123",
    });

    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get("authorization")).toBeNull();
    expect(requestHeaders.get("x-hosted-execution-user-id")).toBe("member_123");
    const nonce = requestHeaders.get(HOSTED_EXECUTION_NONCE_HEADER);
    const timestamp = requestHeaders.get(HOSTED_EXECUTION_TIMESTAMP_HEADER);
    await expect(
      verifyHostedExecutionSignature({
        method: "POST",
        nonce,
        path: HOSTED_EXECUTION_HOSTED_SHARE_INTERNAL_CREATE_PATH,
        payload: JSON.stringify(requestBody),
        secret: "dispatch-secret",
        signature: requestHeaders.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp,
        nowMs: timestamp ? Date.parse(timestamp) : Date.now(),
        userId: "member_123",
      }),
    ).resolves.toBe(true);
  });

  it("surfaces nested JSON error messages from hosted web-control routes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "hosted share denied",
      },
    }), { status: 403 }));
    const issuer = createHostedExecutionServerShareLinkIssuer({
      baseUrl: "https://join.example.test/",
      boundUserId: "member_123",
      fetchImpl,
      signingSecret: "dispatch-secret",
    });

    await expect(
      issuer.issue({
        pack: TEST_HOSTED_SHARE_PACK,
      }),
    ).rejects.toThrow(
      "Hosted share link creation failed with HTTP 403: hosted share denied.",
    );
  });
});
