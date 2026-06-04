import { describe, expect, it } from "vitest";

import {
  assertPostResetCounts,
  parseResetOptions,
  safeErrorMessage,
  type CountSnapshot,
} from "../scripts/reset-hosted-member-runtime";

describe("reset hosted member runtime script guards", () => {
  it("requires exact member confirmation before execute", () => {
    expect(() =>
      parseResetOptions(["--member-id", "member_fixture", "--execute"]),
    ).toThrow("--execute requires --confirm-member-id");

    expect(parseResetOptions([
      "--member-id",
      "member_fixture",
      "--execute",
      "--confirm-member-id",
      "member_fixture",
    ])).toMatchObject({
      execute: true,
      memberId: "member_fixture",
    });
  });

  it("requires exact confirmations for manual external cleanup skips", () => {
    expect(() =>
      parseResetOptions([
        "--member-id",
        "member_fixture",
        "--execute",
        "--confirm-member-id",
        "member_fixture",
        "--skip-cloudflare-delete",
      ]),
    ).toThrow("--skip-cloudflare-delete requires --confirm-cloudflare-cleaned");

    expect(() =>
      parseResetOptions([
        "--member-id",
        "member_fixture",
        "--execute",
        "--confirm-member-id",
        "member_fixture",
        "--skip-temporal-terminate",
      ]),
    ).toThrow("--skip-temporal-terminate requires --confirm-temporal-terminated");
  });

  it("requires exact confirmation before clearing suspension", () => {
    expect(() =>
      parseResetOptions([
        "--member-id",
        "member_fixture",
        "--execute",
        "--confirm-member-id",
        "member_fixture",
        "--unsuspend-after-reset",
      ]),
    ).toThrow("--unsuspend-after-reset requires --confirm-unsuspend-after-reset");
  });

  it("fails post-reset verification when destructive rows remain", () => {
    expect(() => assertPostResetCounts(cleanCounts())).not.toThrow();
    expect(() =>
      assertPostResetCounts({
        ...cleanCounts(),
        hostedMailboxItem: 1,
      }),
    ).toThrow("hostedMailboxItem=1");
  });

  it("redacts member identifiers in error output", () => {
    expect(safeErrorMessage(new Error(
      "failed hosted-user-runtime:hbm_member_fixture in workflow for hbm_member_fixture",
    ))).toBe("failed hosted-user-runtime:<member-id> in workflow for <member-id>");
  });
});

function cleanCounts(): CountSnapshot {
  return {
    deviceAgentSession: 0,
    deviceBrowserAssertionNonce: 0,
    deviceConnectIntent: 0,
    deviceConnection: 0,
    deviceOauthSession: 0,
    deviceSyncDirtyConnection: 0,
    deviceSyncDirtyPayload: 0,
    deviceSyncSignal: 0,
    deviceTokenAudit: 0,
    deviceWebhookTraceOwners: 0,
    hostedAiUsage: 0,
    hostedAiUsageNonSkipped: 0,
    hostedAiUsagePeriod: 0,
    hostedIngressLatencyTrace: 0,
    hostedInvite: 0,
    hostedLinqDailyState: 0,
    hostedMailboxItem: 0,
    hostedMailboxLaneCounter: 0,
    hostedMailboxPayload: 0,
    hostedRuntimeLog: 0,
    hostedUserCryptoAuditControl: 1,
    hostedUserCryptoAuditResetDomains: 3,
    hostedUserCryptoEnvelopeControl: 1,
    hostedUserCryptoEnvelopeResetDomains: 3,
    hostedWebSession: 0,
    hostedWorkspace: 1,
  };
}
