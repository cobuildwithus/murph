import { describe, expect, it } from "vitest";

import {
  buildHostedBackgroundGroupRosterPrompt,
} from "../src/hosted-runtime/group-roster-prompt.ts";

describe("hosted background group roster prompt", () => {
  it("renders only opaque member IDs and canonical granted scope keys", () => {
    const prompt = buildHostedBackgroundGroupRosterPrompt({
      authority: {
        action: "read_share_authority",
        result: {
          memberIds: ["member_beta", "member_alpha"],
          shares: [
            {
              memberId: "member_beta",
              projectionScopeKey: "profile-name.v0",
              shareId: "share_profile",
            },
            {
              memberId: "member_alpha",
              projectionScopeKey: "steps-days.v0",
              shareId: "share_steps",
            },
            {
              memberId: "member_alpha",
              projectionScopeKey: "activity-minutes-days.v1.activityKind.running",
              shareId: "share_running",
            },
            {
              memberId: "member_alpha",
              projectionScopeKey: "steps-days.v0",
              shareId: "share_steps_duplicate_scope",
            },
          ],
          status: "ok",
        },
      },
    });

    expect(prompt).toContain("authoritative current group membership and grant snapshot");
    expect(prompt).toContain('"memberId": "member_alpha"');
    expect(prompt).toContain('"memberId": "member_beta"');
    expect(prompt).toContain('"activity-minutes-days.v1.activityKind.running"');
    expect(prompt).toContain('"steps-days.v0"');
    expect(prompt).toContain("Treat only `grantedProjectionScopeKeys` as grant authority");
    expect(prompt).not.toContain('"grantedProjectionKinds"');
    expect(prompt).toContain("only participants recorded as `in`");
    expect(prompt).toContain("Do not call `murph.group post_join_offer`");
    expect(prompt).not.toContain("share_profile");
    expect(prompt).not.toContain("share_steps");
    expect(prompt).not.toContain('"role"');
    expect(prompt).not.toContain("requestedVaultShareProjection");
  });

  it.each([
    {
      label: "no current group",
      response: {
        action: "read_share_authority" as const,
        result: { memberIds: [] as [], shares: [] as [], status: "none" as const },
      },
    },
    {
      label: "unavailable current group",
      response: {
        action: "read_share_authority" as const,
        result: {
          status: "unavailable" as const,
          unavailableReason: "not_bound",
        },
      },
    },
  ])("fails closed for $label", ({ response }) => {
    expect(buildHostedBackgroundGroupRosterPrompt({ authority: response }))
      .toBeNull();
  });

  it("fails closed when the pass-local snapshot is missing", () => {
    expect(buildHostedBackgroundGroupRosterPrompt({ authority: null })).toBeNull();
  });
});
