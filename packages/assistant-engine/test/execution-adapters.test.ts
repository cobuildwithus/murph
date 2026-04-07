import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostedExecutionMocks = vi.hoisted(() => {
  const issue = vi.fn();

  return {
    createHostedExecutionServerShareLinkIssuer: vi.fn(() => ({ issue })),
    issue,
  };
});

vi.mock("@murphai/hosted-execution/web-control-plane", () => ({
  createHostedExecutionServerShareLinkIssuer:
    hostedExecutionMocks.createHostedExecutionServerShareLinkIssuer,
}));

import type { SharePack } from "@murphai/contracts";

import { issueHostedShareLink } from "../src/assistant-cli-tools/execution-adapters.ts";

const TEST_SHARE_PACK: SharePack = {
  createdAt: "2026-03-28T09:20:00.000Z",
  entities: [
    {
      kind: "food",
      payload: {
        kind: "smoothie",
        status: "active",
        title: "Shared breakfast",
      },
      ref: "food.shared-breakfast",
    },
  ],
  schemaVersion: "murph.share-pack.v1",
  title: "Shared breakfast",
};

describe("issueHostedShareLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
    process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET = "dispatch-secret";
  });

  afterEach(() => {
    delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    delete process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET;
  });

  it("fails closed when hosted share env is missing", async () => {
    delete process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET;

    await expect(
      issueHostedShareLink({
        pack: TEST_SHARE_PACK,
        senderMemberId: "member_123",
      }),
    ).rejects.toThrow(
      "Hosted share link creation requires HOSTED_ONBOARDING_PUBLIC_BASE_URL plus HOSTED_WEB_INTERNAL_SIGNING_SECRET in the assistant environment.",
    );
  });

  it("fails closed when the hosted sender member id is missing", async () => {
    await expect(
      issueHostedShareLink({
        pack: TEST_SHARE_PACK,
        senderMemberId: null,
      }),
    ).rejects.toThrow(
      "Hosted share link creation requires a hosted member identity so the share pack stays bound to its owner.",
    );
  });

  it("delegates hosted share creation through the semantic hosted-execution issuer", async () => {
    hostedExecutionMocks.issue.mockResolvedValue({
      shareCode: "share_123",
      url: "https://join.example.test/share/share_123",
    });

    await expect(
      issueHostedShareLink({
        pack: TEST_SHARE_PACK,
        expiresInHours: 24,
        inviteCode: "invite_123",
        recipientPhoneNumber: "+15551234567",
        senderMemberId: "member_123",
      }),
    ).resolves.toEqual({
      shareCode: "share_123",
      url: "https://join.example.test/share/share_123",
    });

    expect(
      hostedExecutionMocks.createHostedExecutionServerShareLinkIssuer,
    ).toHaveBeenCalledWith({
      baseUrl: "https://join.example.test",
      boundUserId: "member_123",
      fetchImpl: fetch,
      signingSecret: "dispatch-secret",
    });
    expect(hostedExecutionMocks.issue).toHaveBeenCalledWith({
      pack: TEST_SHARE_PACK,
      expiresInHours: 24,
      inviteCode: "invite_123",
      recipientPhoneNumber: "+15551234567",
    });
  });
});
