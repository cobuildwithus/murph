import { describe, expect, it } from "vitest";

import {
  assertPostResetCounts,
  assertResetExecutionTargetConfirmed,
  buildResetExecutionTargetSummary,
  buildResetMemberActivatedWake,
  isCloudflareHostedUserDataDeleteProven,
  parseResetOptions,
  RESET_TRANSACTION_OPTIONS,
  safeErrorMessage,
  type CountSnapshot,
} from "../scripts/reset-hosted-member-runtime";

describe("reset hosted member runtime script guards", () => {
  it("requires exact member confirmation before execute", () => {
    expect(() =>
      parseResetOptions([
        "--member-id",
        "member_fixture",
        "--execute",
        "--confirm-environment",
        "production",
      ]),
    ).toThrow("--execute requires --confirm-member-id");

    expect(parseResetOptions([
      "--member-id",
      "member_fixture",
      "--execute",
      "--confirm-member-id",
      "member_fixture",
      "--confirm-environment",
      "production",
      "--confirm-target-fingerprint",
      "sha256:target",
    ])).toMatchObject({
      confirmTargetFingerprint: "sha256:target",
      environmentLabel: "production",
      execute: true,
      memberId: "member_fixture",
    });
  });

  it("requires exact environment confirmation before execute", () => {
    expect(() =>
      parseResetOptions([
        "--member-id",
        "member_fixture",
        "--execute",
        "--confirm-member-id",
        "member_fixture",
      ]),
    ).toThrow("--execute requires --confirm-environment");

    expect(parseResetOptions([
      "--member-id",
      "member_fixture",
      "--environment",
      "staging",
      "--execute",
      "--confirm-member-id",
      "member_fixture",
      "--confirm-environment",
      "staging",
      "--confirm-target-fingerprint",
      "sha256:target",
    ])).toMatchObject({
      environmentLabel: "staging",
      execute: true,
    });
  });

  it("requires exact target fingerprint confirmation before execute mutates", () => {
    const targets = buildResetExecutionTargetSummary({
      cloudflareControlBaseUrlFingerprint: "sha256:cloudflare",
      databaseUrlFingerprint: "sha256:database",
      temporalAddressFingerprint: "sha256:temporal-address",
      temporalNamespaceFingerprint: "sha256:temporal-namespace",
    });

    expect(() =>
      assertResetExecutionTargetConfirmed({
        confirmTargetFingerprint: null,
        execute: true,
      }, targets),
    ).toThrow("--execute requires --confirm-target-fingerprint");

    expect(() =>
      assertResetExecutionTargetConfirmed({
        confirmTargetFingerprint: targets.executionTargetFingerprint,
        execute: true,
      }, targets),
    ).not.toThrow();
  });

  it("requires exact confirmations for manual external cleanup skips", () => {
    expect(() =>
      parseResetOptions([
        "--member-id",
        "member_fixture",
        "--execute",
        "--confirm-member-id",
        "member_fixture",
        "--confirm-environment",
        "production",
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
        "--confirm-environment",
        "production",
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
        "--confirm-environment",
        "production",
        "--unsuspend-after-reset",
      ]),
    ).toThrow("--unsuspend-after-reset requires --confirm-unsuspend-after-reset");
  });

  it("fails post-reset verification when destructive rows remain", () => {
    expect(() => assertPostResetCounts(cleanCounts())).not.toThrow();
    expect(() =>
      assertPostResetCounts({
        ...cleanCounts(),
        hostedMemberRouting: 1,
      }),
    ).toThrow("hostedMemberRouting=1");

    expect(() =>
      assertPostResetCounts({
        ...cleanCounts(),
        hostedConsentGrantResetScopes: 1,
      }),
    ).toThrow("hostedConsentGrantResetScopes=1");
  });

  it("requires exactly one fresh bootstrap mailbox item after reset", () => {
    expect(() =>
      assertPostResetCounts({
        ...cleanCounts(),
        hostedMailboxItem: 0,
      }),
    ).toThrow("hostedMailboxItem=0");

    expect(() =>
      assertPostResetCounts({
        ...cleanCounts(),
        hostedRuntimeLog: 0,
      }),
    ).toThrow("hostedRuntimeLog=0");
  });

  it("builds a reset activation wake without routing channels or raw member id in the event id", () => {
    const wake = buildResetMemberActivatedWake({
      memberId: "member_fixture",
      occurredAt: "2026-06-04T12:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });

    expect(wake).toMatchObject({
      kind: "member.activated",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-06-04T12:00:00.000Z",
      timeZone: "America/Los_Angeles",
      userId: "member_fixture",
    });
    expect(wake.eventId).toMatch(/^member\.activated:runtime-reset:[a-f0-9]{32}$/u);
    expect(wake.eventId).not.toContain("member_fixture");
  });

  it("uses a reset-specific transaction timeout", () => {
    expect(RESET_TRANSACTION_OPTIONS).toEqual({
      maxWait: 30_000,
      timeout: 120_000,
    });
  });

  it("requires Durable Object state deletion for Cloudflare cleanup proof", () => {
    expect(isCloudflareHostedUserDataDeleteProven({
      alarmCleared: true,
      r2SkippedUserScopedPrefixes: false,
      r2Supported: true,
      runnerStateDeleted: true,
    })).toBe(true);

    expect(isCloudflareHostedUserDataDeleteProven({
      alarmCleared: true,
      r2SkippedUserScopedPrefixes: false,
      r2Supported: true,
      runnerStateDeleted: false,
    })).toBe(false);
  });

  it("redacts member identifiers in error output", () => {
    expect(safeErrorMessage(new Error(
      "failed hosted-user-runtime:hbm_member_fixture in workflow for hbm_member_fixture",
    ))).toBe("failed hosted-user-runtime:<member-id> in workflow for <member-id>");

    expect(safeErrorMessage(
      new Error("failed workflow for custom_member_fixture"),
      "custom_member_fixture",
    )).toBe("failed workflow for <member-id>");

    expect(safeErrorMessage(new Error("Unknown argument."))).toBe("Unknown argument.");
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
    hostedConsentEventResetScopes: 0,
    hostedConsentGrantResetScopes: 0,
    hostedIngressLatencyTrace: 0,
    hostedInvite: 0,
    hostedLinqDailyState: 0,
    hostedMemberEmailAuthorization: 0,
    hostedMemberIdentityPhoneFields: 0,
    hostedMemberRouting: 0,
    hostedMailboxItem: 1,
    hostedMailboxLaneCounter: 1,
    hostedMailboxPayload: 0,
    hostedRuntimeLog: 1,
    hostedUserCryptoAuditControl: 1,
    hostedUserCryptoAuditResetDomains: 3,
    hostedUserCryptoEnvelopeControl: 1,
    hostedUserCryptoEnvelopeResetDomains: 3,
    hostedWebInternalRequestNonce: 0,
    hostedWebSession: 0,
    hostedWorkspace: 1,
  };
}
