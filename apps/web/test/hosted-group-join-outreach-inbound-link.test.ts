import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSignupLinkResponse } from "@/src/lib/hosted-onboarding/webhook-provider-linq-shared";

describe("hosted group join outreach inbound handoff", () => {
  beforeEach(() => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
      "https://join.example.test",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("carries both the originating group and issued invite after the participant replies", () => {
    const plan = buildSignupLinkResponse({
      chatId: "chat_group_join_reply",
      groupJoinCode: "join_group_opaque",
      inviteCode: "invite_opaque",
      inviteId: "hbi_opaque",
      memberId: "hbm_opaque",
      messageId: "message_group_join_reply",
      occurredAt: "2026-07-24T20:00:00.000Z",
      sourceEventId: "event_group_join_reply",
      threadIsDirect: true,
    });

    expect(plan.response).toMatchObject({
      inviteCode: "invite_opaque",
      joinUrl:
        "https://join.example.test/groups/join/join_group_opaque?invite=invite_opaque",
      reason: "sent-signup-link",
    });
    expect(plan.desiredSideEffects).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          groupJoinCode: "join_group_opaque",
          inviteId: "hbi_opaque",
          template: "invite_signup",
        }),
      }),
    ]);
  });
});
