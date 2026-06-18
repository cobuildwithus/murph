import { describe, expect, it } from "vitest";

import {
  canContinueHostedPrivyClientSession,
  describeHostedPrivyClientSessionIssue,
  ensureHostedPrivyPhoneReady,
  resolveHostedPrivyClientSessionIssue,
  shouldShowHostedPrivyManualResumeState,
  shouldShowHostedPrivyRestartState,
} from "@/src/lib/hosted-onboarding/privy-client";

describe("hosted Privy client session readiness", () => {
  it("treats a missing phone as blocking and ignores missing wallet state", () => {
    expect(resolveHostedPrivyClientSessionIssue(null)).toBeNull();
    expect(
      resolveHostedPrivyClientSessionIssue({
        linkedAccounts: [],
        phone: null,
        wallet: null,
      }),
    ).toBe("missing-phone");
    expect(
      resolveHostedPrivyClientSessionIssue({
        linkedAccounts: [],
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        wallet: null,
      }),
    ).toBeNull();
    expect(canContinueHostedPrivyClientSession("missing-phone")).toBe(false);
    expect(
      describeHostedPrivyClientSessionIssue(null),
    ).toBeNull();
  });

  it("treats a partially hydrated non-null user shell as indeterminate", async () => {
    await expect(
      ensureHostedPrivyPhoneReady({
        user: {},
      }),
    ).resolves.toBeUndefined();

    expect(resolveHostedPrivyClientSessionIssue(null)).toBeNull();
  });

  it("switches from manual resume to restart mode when the authenticated session is missing a phone", () => {
    expect(
      shouldShowHostedPrivyManualResumeState({
        authenticated: true,
        issue: null,
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyManualResumeState({
        authenticated: true,
        issue: "missing-phone",
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(false);

    expect(
      shouldShowHostedPrivyRestartState({
        authenticated: true,
        issue: "missing-phone",
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyRestartState({
        authenticated: true,
        issue: null,
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(false);
  });

  it("allows phone auth completion without an embedded wallet", async () => {
    await expect(
      ensureHostedPrivyPhoneReady({
        user: {
          linkedAccounts: [
            {
              latest_verified_at: 1741194420,
              phone_number: "+1 415 555 2671",
              type: "phone",
            },
          ],
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("does not require wallet state when setup completion still has no linked embedded account", async () => {
    await expect(
      ensureHostedPrivyPhoneReady({
        user: {
          linkedAccounts: [
            {
              latest_verified_at: 1741194420,
              phone_number: "+1 415 555 2671",
              type: "phone",
            },
          ],
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("treats missing local user state as indeterminate instead of forcing a refresh", async () => {
    await expect(
      ensureHostedPrivyPhoneReady({
        user: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects phone readiness only when a hydrated session has no phone", async () => {
    await expect(
      ensureHostedPrivyPhoneReady({
        user: {
          linkedAccounts: [
            {
              address: "person@example.test",
              latest_verified_at: 1741194420,
              type: "email",
            },
          ],
        },
      }),
    ).rejects.toThrow("missing a verified phone number");
  });
});
