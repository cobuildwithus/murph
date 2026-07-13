import { describe, expect, it } from "vitest";

import {
  buildHostedPrivyAuthIntentClearCookie,
  buildHostedPrivyAuthIntentCookie,
  issueHostedPrivyAuthIntent,
  readHostedPrivyAuthIntentFromRequest,
  verifyHostedPrivyAuthenticationProof as verifyHostedPrivyProviderProof,
  verifyHostedPrivyAuthIntent,
  verifyHostedPrivyLegacyAuthContext,
  verifyHostedPrivyLegacyAuthenticationProof,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";
import type {
  HostedPrivyIdentity,
  HostedPrivyUser,
} from "@/src/lib/hosted-onboarding/privy";
import {
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";

const SECRET = "test-only-privy-app-secret";
const NOW = new Date("2026-07-12T20:00:30.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

describe("hosted Privy authentication intents", () => {
  it("proves a fresh uniquely-newest phone verification", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "phone",
      now: NOW,
      secret: SECRET,
    });

    expect(verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({
        emailVerifiedAt: NOW_SECONDS - 60,
        phoneVerifiedAt: NOW_SECONDS,
      }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS - 60),
        phoneAccount(NOW_SECONDS),
      ],
      now: NOW,
      secret: SECRET,
    })).toEqual(expectedAuthenticationProof("phone", NOW_SECONDS));
  });

  it("proves a fresh uniquely-newest email verification", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });

    expect(verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({
        emailVerifiedAt: NOW_SECONDS,
        phoneVerifiedAt: NOW_SECONDS - 60,
      }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS),
        phoneAccount(NOW_SECONDS - 60),
      ],
      now: NOW,
      secret: SECRET,
    })).toEqual(expectedAuthenticationProof("email", NOW_SECONDS));
  });

  it.each([
    {
      account: emailAccount(NOW_SECONDS),
      method: "email" as const,
    },
    {
      account: phoneAccount(NOW_SECONDS),
      method: "phone" as const,
    },
  ])("proves a fresh $method credential despite older disagreeing Telegram projections", ({
    account,
    method,
  }) => {
    const intent = verifyHostedPrivyAuthIntent({
      intent: issueHostedPrivyAuthIntent({ method, now: NOW, secret: SECRET }),
      now: NOW,
      secret: SECRET,
    });

    expect(verifyHostedPrivyProviderProof({
      intent,
      now: NOW,
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [
          account,
          {
            id: "123456",
            latest_verified_at: NOW_SECONDS - 60,
            type: "telegram",
          },
        ],
        telegram: {
          id: "654321",
          latest_verified_at: NOW_SECONDS - 120,
        },
      }),
    })).toEqual(expectedAuthenticationProof(method, NOW_SECONDS));
  });

  it("proves a fresh uniquely-newest Telegram verification", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "telegram",
      now: NOW,
      secret: SECRET,
    });

    expect(verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({
        emailVerifiedAt: NOW_SECONDS - 60,
        telegramVerifiedAt: NOW_SECONDS,
      }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS - 60),
        telegramAccount(NOW_SECONDS),
      ],
      now: NOW,
      secret: SECRET,
    })).toEqual(expectedAuthenticationProof("telegram", NOW_SECONDS));
  });

  it("proves a fresh direct-only Telegram verification from the authoritative user", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "telegram",
      now: NOW,
      secret: SECRET,
    });
    const verifiedIntent = verifyHostedPrivyAuthIntent({
      intent,
      now: NOW,
      secret: SECRET,
    });
    const verifiedPrivyUser = makeVerifiedPrivyUser({
      telegram: {
        id: "123456",
        latest_verified_at: NOW_SECONDS,
      },
    });

    expect(verifyHostedPrivyProviderProof({
      intent: verifiedIntent,
      now: NOW,
      verifiedPrivyUser,
    })).toEqual(expectedAuthenticationProof("telegram", NOW_SECONDS));
  });

  it("deduplicates matching direct and linked Telegram evidence", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "telegram",
      now: NOW,
      secret: SECRET,
    });
    const verifiedIntent = verifyHostedPrivyAuthIntent({
      intent,
      now: NOW,
      secret: SECRET,
    });
    const verifiedPrivyUser = makeVerifiedPrivyUser({
      linkedAccounts: [telegramAccount(NOW_SECONDS - 1)],
      telegram: {
        id: "123456",
        latest_verified_at: NOW_SECONDS,
      },
    });

    expect(verifyHostedPrivyProviderProof({
      intent: verifiedIntent,
      now: NOW,
      verifiedPrivyUser,
    })).toEqual(expectedAuthenticationProof("telegram", NOW_SECONDS));
  });

  it("fails closed when malformed Telegram evidence is newer", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });
    const verifiedIntent = verifyHostedPrivyAuthIntent({
      intent,
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyProviderProof({
      intent: verifiedIntent,
      now: new Date(NOW.getTime() + 1_000),
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [
          emailAccount(NOW_SECONDS),
          {
            latest_verified_at: NOW_SECONDS + 1,
            type: "telegram",
          },
        ],
      }),
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it.each([
    {
      code: "PRIVY_EMAIL_REQUIRED",
      malformed: { latest_verified_at: NOW_SECONDS + 1, type: "email" },
      method: "email",
      valid: emailAccount(NOW_SECONDS),
    },
    {
      code: "PRIVY_PHONE_REQUIRED",
      malformed: { latest_verified_at: NOW_SECONDS + 1, type: "phone" },
      method: "phone",
      valid: phoneAccount(NOW_SECONDS),
    },
    {
      code: "PRIVY_TELEGRAM_REQUIRED",
      malformed: { latest_verified_at: NOW_SECONDS + 1, type: "telegram" },
      method: "telegram",
      valid: telegramAccount(NOW_SECONDS),
    },
  ] as const)("rejects an older valid $method credential when newer same-method evidence is malformed", ({
    code,
    malformed,
    method,
    valid,
  }) => {
    const intent = verifyHostedPrivyAuthIntent({
      intent: issueHostedPrivyAuthIntent({ method, now: NOW, secret: SECRET }),
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyProviderProof({
      intent,
      now: new Date(NOW.getTime() + 1_000),
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [valid, malformed],
      }),
    })).toThrow(expect.objectContaining({ code }));
  });

  it("does not drop newer malformed direct Telegram evidence", () => {
    const intent = verifyHostedPrivyAuthIntent({
      intent: issueHostedPrivyAuthIntent({ method: "email", now: NOW, secret: SECRET }),
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyProviderProof({
      intent,
      now: new Date(NOW.getTime() + 1_000),
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [emailAccount(NOW_SECONDS)],
        telegram: { latest_verified_at: NOW_SECONDS + 1 },
      }),
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("fails closed when distinct same-method credentials tie as newest", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS),
        {
          address: "other@example.test",
          latest_verified_at: NOW_SECONDS,
          type: "email",
        },
      ],
      now: NOW,
      secret: SECRET,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("rejects an email intent when phone was the newest provider verification", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({
        emailVerifiedAt: NOW_SECONDS,
        phoneVerifiedAt: NOW_SECONDS + 1,
      }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS),
        phoneAccount(NOW_SECONDS + 1),
      ],
      now: new Date(NOW.getTime() + 1_000),
      secret: SECRET,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("fails closed when an unsupported credential is newest", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS),
        {
          credential_id: "passkey-credential",
          latest_verified_at: NOW_SECONDS + 1,
          type: "passkey",
        },
      ],
      now: new Date(NOW.getTime() + 1_000),
      secret: SECRET,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("ignores a newer camelCase embedded Privy wallet", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });

    expect(verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS }),
      intent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS),
        {
          address: "0x0000000000000000000000000000000000000001",
          connectorType: "embedded",
          latestVerifiedAt: NOW_SECONDS + 1,
          type: "wallet",
          walletClientType: "privy-v2",
        },
      ],
      now: NOW,
      secret: SECRET,
    })).toEqual(expectedAuthenticationProof("email", NOW_SECONDS));
  });

  it("fails closed when distinct credentials tie as newest", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({
        emailVerifiedAt: NOW_SECONDS,
        phoneVerifiedAt: NOW_SECONDS,
      }),
      intent,
      linkedAccounts: [emailAccount(NOW_SECONDS), phoneAccount(NOW_SECONDS)],
      now: NOW,
      secret: SECRET,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("rejects stale, future, expired, invite-mismatched, and tampered proof", () => {
    const intent = issueHostedPrivyAuthIntent({
      inviteCode: "invite-a",
      method: "email",
      now: NOW,
      secret: SECRET,
    });
    const freshEmailIdentity = makeIdentity({ emailVerifiedAt: NOW_SECONDS });

    const common = {
      identity: freshEmailIdentity,
      intent,
      inviteCode: "invite-a",
      linkedAccounts: [emailAccount(NOW_SECONDS)],
      secret: SECRET,
    };

    expect(() => verifyHostedPrivyAuthenticationProof({
      ...common,
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS - 30 }),
      linkedAccounts: [emailAccount(NOW_SECONDS - 30)],
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
    expect(() => verifyHostedPrivyAuthenticationProof({
      ...common,
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS + 10 }),
      linkedAccounts: [emailAccount(NOW_SECONDS + 10)],
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
    expect(() => verifyHostedPrivyAuthenticationProof({
      ...common,
      now: new Date(NOW.getTime() + 601_000),
    })).toThrow(expect.objectContaining({ code: "HOSTED_AUTH_PROOF_EXPIRED" }));
    expect(() => verifyHostedPrivyAuthenticationProof({
      ...common,
      inviteCode: "invite-b",
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "HOSTED_AUTH_PROOF_INVALID" }));
    expect(() => verifyHostedPrivyAuthenticationProof({
      ...common,
      intent: `${intent.slice(0, -1)}x`,
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "HOSTED_AUTH_PROOF_INVALID" }));
  });

  it.each([
    { offsetSeconds: -5, label: "lower" },
    { offsetSeconds: 5, label: "upper" },
  ])("accepts the exact $label provider clock-skew boundary", ({ offsetSeconds }) => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });
    const verifiedAt = NOW_SECONDS + offsetSeconds;

    expect(verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({ emailVerifiedAt: verifiedAt }),
      intent,
      linkedAccounts: [emailAccount(verifiedAt)],
      now: NOW,
      secret: SECRET,
    })).toEqual(expectedAuthenticationProof("email", verifiedAt));
  });

  it.each([
    { offsetSeconds: -6, label: "below" },
    { offsetSeconds: 6, label: "above" },
  ])("rejects a provider verification $label the clock-skew boundary", ({ offsetSeconds }) => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });
    const verifiedAt = NOW_SECONDS + offsetSeconds;

    expect(() => verifyHostedPrivyAuthenticationProof({
      identity: makeIdentity({ emailVerifiedAt: verifiedAt }),
      intent,
      linkedAccounts: [emailAccount(verifiedAt)],
      now: NOW,
      secret: SECRET,
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("allows bounded verifier clock rollback and rejects rollback beyond the bound", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });
    const common = {
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS }),
      intent,
      linkedAccounts: [emailAccount(NOW_SECONDS)],
      secret: SECRET,
    };

    expect(verifyHostedPrivyAuthenticationProof({
      ...common,
      now: new Date(NOW.getTime() - 5_000),
    })).toEqual(expectedAuthenticationProof("email", NOW_SECONDS));
    expect(() => verifyHostedPrivyAuthenticationProof({
      ...common,
      now: new Date(NOW.getTime() - 6_000),
    })).toThrow(expect.objectContaining({ code: "HOSTED_AUTH_PROOF_INVALID" }));
  });

  it("rejects an intent that expires after local validation but before provider evidence validation", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "email",
      now: NOW,
      secret: SECRET,
    });
    const verifiedIntent = verifyHostedPrivyAuthIntent({
      intent,
      now: NOW,
      secret: SECRET,
    });

    expect(() => verifyHostedPrivyProviderProof({
      intent: verifiedIntent,
      now: new Date(NOW.getTime() + 601_000),
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [emailAccount(NOW_SECONDS)],
      }),
    })).toThrow(expect.objectContaining({ code: "HOSTED_AUTH_PROOF_EXPIRED" }));
  });

  it("stores the proof in an HttpOnly cookie and clears it after completion", () => {
    const intent = issueHostedPrivyAuthIntent({
      method: "telegram",
      now: NOW,
      secret: SECRET,
    });
    const cookie = buildHostedPrivyAuthIntentCookie(intent);
    const request = new Request("https://example.test/complete", {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(readHostedPrivyAuthIntentFromRequest(request)).toBe(intent);
    expect(buildHostedPrivyAuthIntentClearCookie()).toContain("Max-Age=0");
  });

  it("constrains the temporary legacy path to a freshly issued verified identity token", () => {
    expect(verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS,
      method: "phone",
      now: NOW,
    })).toEqual({
      identityTokenIssuedAt: NOW_SECONDS,
      method: "phone",
    });
    expect(verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS - 600,
      method: "phone",
      now: NOW,
    })).toEqual({
      identityTokenIssuedAt: NOW_SECONDS - 600,
      method: "phone",
    });
    expect(verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS + 5,
      method: "phone",
      now: NOW,
    })).toEqual({
      identityTokenIssuedAt: NOW_SECONDS + 5,
      method: "phone",
    });

    expect(() => verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS - 601,
      method: "phone",
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "HOSTED_CLIENT_UPDATE_REQUIRED" }));
    expect(() => verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS + 6,
      method: "phone",
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "HOSTED_CLIENT_UPDATE_REQUIRED" }));
    expect(() => verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: null,
      method: "phone",
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "HOSTED_CLIENT_UPDATE_REQUIRED" }));
    expect(() => verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS,
      method: "wallet",
      now: NOW,
    })).toThrow(expect.objectContaining({ code: "HOSTED_CLIENT_UPDATE_REQUIRED" }));
  });

  it.each([6, 60])(
    "accepts a legacy credential verified %s seconds before token issuance",
    (secondsBeforeToken) => {
      const authContext = verifyHostedPrivyLegacyAuthContext({
        identityTokenIssuedAt: NOW_SECONDS,
        method: "email",
        now: NOW,
      });

      expect(verifyHostedPrivyLegacyAuthenticationProof({
        authContext,
        now: NOW,
        verifiedPrivyUser: makeVerifiedPrivyUser({
          linkedAccounts: [emailAccount(NOW_SECONDS - secondsBeforeToken)],
        }),
      })).toEqual(expectedAuthenticationProof("email", NOW_SECONDS - secondsBeforeToken));
    },
  );

  it("does not treat a fresh token refresh as fresh legacy credential verification", () => {
    const authContext = verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS,
      method: "email",
      now: NOW,
    });

    expect(() => verifyHostedPrivyLegacyAuthenticationProof({
      authContext,
      now: NOW,
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [emailAccount(NOW_SECONDS - 61)],
      }),
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it.each([
    {
      label: "wrong-method newest evidence",
      linkedAccounts: [phoneAccount(NOW_SECONDS)],
    },
    {
      label: "distinct tied-newest evidence",
      linkedAccounts: [emailAccount(NOW_SECONDS), phoneAccount(NOW_SECONDS)],
    },
    {
      label: "malformed newest evidence",
      linkedAccounts: [
        emailAccount(NOW_SECONDS - 1),
        { latest_verified_at: NOW_SECONDS, type: "email" },
      ],
    },
    {
      label: "unsupported newest evidence",
      linkedAccounts: [
        emailAccount(NOW_SECONDS - 1),
        {
          credential_id: "passkey-credential",
          latest_verified_at: NOW_SECONDS,
          type: "passkey",
        },
      ],
    },
  ])("rejects legacy $label", ({ linkedAccounts }) => {
    const authContext = verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS,
      method: "email",
      now: NOW,
    });

    expect(() => verifyHostedPrivyLegacyAuthenticationProof({
      authContext,
      now: NOW,
      verifiedPrivyUser: makeVerifiedPrivyUser({ linkedAccounts }),
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it("accepts future legacy credential evidence within clock skew and rejects beyond it", () => {
    const authContext = verifyHostedPrivyLegacyAuthContext({
      identityTokenIssuedAt: NOW_SECONDS,
      method: "email",
      now: NOW,
    });

    expect(verifyHostedPrivyLegacyAuthenticationProof({
      authContext,
      now: NOW,
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [emailAccount(NOW_SECONDS + 5)],
      }),
    })).toEqual(expectedAuthenticationProof("email", NOW_SECONDS + 5));

    expect(() => verifyHostedPrivyLegacyAuthenticationProof({
      authContext,
      now: NOW,
      verifiedPrivyUser: makeVerifiedPrivyUser({
        linkedAccounts: [emailAccount(NOW_SECONDS + 6)],
      }),
    })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
  });

  it.each([6, 300])(
    "rejects a legacy credential verified %s seconds after token issuance",
    (secondsAfterToken) => {
      const authContext = verifyHostedPrivyLegacyAuthContext({
        identityTokenIssuedAt: NOW_SECONDS,
        method: "email",
        now: NOW,
      });
      const delayedNow = new Date(NOW.getTime() + 300_000);

      expect(verifyHostedPrivyLegacyAuthenticationProof({
        authContext,
        now: delayedNow,
        verifiedPrivyUser: makeVerifiedPrivyUser({
          linkedAccounts: [emailAccount(NOW_SECONDS + 5)],
        }),
      })).toEqual(expectedAuthenticationProof("email", NOW_SECONDS + 5));

      expect(() => verifyHostedPrivyLegacyAuthenticationProof({
        authContext,
        now: delayedNow,
        verifiedPrivyUser: makeVerifiedPrivyUser({
          linkedAccounts: [emailAccount(NOW_SECONDS + secondsAfterToken)],
        }),
      })).toThrow(expect.objectContaining({ code: "PRIVY_EMAIL_REQUIRED" }));
    },
  );
});

function makeIdentity(input: {
  emailVerifiedAt?: number;
  phoneVerifiedAt?: number;
  telegramVerifiedAt?: number;
} = {}): HostedPrivyIdentity {
  return {
    email: input.emailVerifiedAt === undefined
      ? null
      : { address: "member@example.test", verifiedAt: input.emailVerifiedAt },
    phone: input.phoneVerifiedAt === undefined
      ? null
      : { number: "+15555550123", verifiedAt: input.phoneVerifiedAt },
    telegram: input.telegramVerifiedAt === undefined
      ? null
      : {
          firstName: "Example",
          lastName: null,
          photoUrl: null,
          telegramUserId: "123456",
          username: "example_member",
          verifiedAt: input.telegramVerifiedAt,
        },
    userId: "did:privy:test-member",
  };
}

function emailAccount(verifiedAt: number) {
  return {
    address: "member@example.test",
    latest_verified_at: verifiedAt,
    type: "email",
  };
}

function phoneAccount(verifiedAt: number) {
  return {
    latest_verified_at: verifiedAt,
    phoneNumber: "+15555550123",
    type: "phone",
  };
}

function telegramAccount(verifiedAt: number) {
  return {
    id: "123456",
    latest_verified_at: verifiedAt,
    type: "telegram",
    username: "example_member",
  };
}

function verifyHostedPrivyAuthenticationProof(input: {
  identity: HostedPrivyIdentity;
  intent: string | null | undefined;
  inviteCode?: string | null;
  linkedAccounts: readonly PrivyLinkedAccountLike[];
  now?: Date;
  secret?: string;
}) {
  const verifiedIntent = verifyHostedPrivyAuthIntent({
    intent: input.intent,
    inviteCode: input.inviteCode,
    now: input.now,
    secret: input.secret,
  });

  return verifyHostedPrivyProviderProof({
    intent: verifiedIntent,
    now: input.now,
    verifiedPrivyUser: makeVerifiedPrivyUser({
      id: input.identity.userId,
      linkedAccounts: input.linkedAccounts,
    }),
  });
}

function makeVerifiedPrivyUser(input: {
  id?: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  telegram?: Record<string, unknown>;
} = {}): HostedPrivyUser {
  return {
    created_at: NOW_SECONDS - 3600,
    has_accepted_terms: true,
    id: input.id ?? "did:privy:test-member",
    is_guest: false,
    linked_accounts: [],
    linkedAccounts: input.linkedAccounts ?? [],
    mfa_methods: [],
    ...(input.telegram ? { telegram: input.telegram } : {}),
  };
}

function expectedAuthenticationProof(
  method: "email" | "phone" | "telegram",
  verifiedAt: number,
) {
  const credential = method === "email"
    ? { address: "member@example.test", verifiedAt }
    : method === "phone"
      ? { number: "+15555550123", verifiedAt }
      : expect.objectContaining({
          telegramUserId: "123456",
          verifiedAt,
        });

  return {
    credential,
    method,
    privyUserId: "did:privy:test-member",
  };
}
