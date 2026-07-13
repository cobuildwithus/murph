import { describe, expect, it } from "vitest";

import {
  buildHostedPrivyAuthIntentClearCookie,
  buildHostedPrivyAuthIntentCookie,
  issueHostedPrivyAuthIntent,
  readHostedPrivyAuthIntentFromRequest,
  verifyHostedPrivyAuthenticationProof as verifyHostedPrivyProviderProof,
  verifyHostedPrivyAuthIntent,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";
import {
  resolveHostedPrivyLinkedAccounts,
  resolveHostedPrivyTelegramAccountSelection,
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
    })).toEqual({ method: "phone" });
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
    })).toEqual({ method: "email" });
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
    })).toEqual({ method: "telegram" });
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
    const verifiedPrivyUser = {
      telegram: {
        id: "123456",
        latest_verified_at: NOW_SECONDS,
      },
    };
    const telegram = resolveHostedPrivyTelegramAccountSelection(verifiedPrivyUser).account;

    expect(verifyHostedPrivyProviderProof({
      identity: {
        ...makeIdentity(),
        telegram,
      },
      intent: verifiedIntent,
      linkedAccounts: resolveHostedPrivyLinkedAccounts(verifiedPrivyUser),
      now: NOW,
    })).toEqual({ method: "telegram" });
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
    const verifiedPrivyUser = {
      linkedAccounts: [telegramAccount(NOW_SECONDS - 1)],
      telegram: {
        id: "123456",
        latest_verified_at: NOW_SECONDS,
      },
    };
    const telegram = resolveHostedPrivyTelegramAccountSelection(verifiedPrivyUser).account;

    expect(verifyHostedPrivyProviderProof({
      identity: {
        ...makeIdentity(),
        telegram,
      },
      intent: verifiedIntent,
      linkedAccounts: resolveHostedPrivyLinkedAccounts(verifiedPrivyUser),
      now: NOW,
    })).toEqual({ method: "telegram" });
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
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS }),
      intent: verifiedIntent,
      linkedAccounts: [
        emailAccount(NOW_SECONDS),
        {
          latest_verified_at: NOW_SECONDS + 1,
          type: "telegram",
        },
      ],
      now: new Date(NOW.getTime() + 1_000),
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
    })).toEqual({ method: "email" });
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
    })).toEqual({ method: "email" });
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
    })).toEqual({ method: "email" });
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
      identity: makeIdentity({ emailVerifiedAt: NOW_SECONDS }),
      intent: verifiedIntent,
      linkedAccounts: [emailAccount(NOW_SECONDS)],
      now: new Date(NOW.getTime() + 601_000),
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
    identity: input.identity,
    intent: verifiedIntent,
    linkedAccounts: input.linkedAccounts,
    now: input.now,
  });
}
