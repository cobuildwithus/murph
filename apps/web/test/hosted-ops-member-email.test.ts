import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  prisma: { readonly: true },
  readHostedMemberEmailSnapshots: vi.fn(),
  sendHostedResendPlainTextEmailBatch: vi.fn(),
}));

vi.mock("@/src/lib/prisma", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/prisma")>(
    "@/src/lib/prisma",
  );
  return {
    ...actual,
    getPrisma: mocks.getPrisma,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");
  return {
    ...actual,
    readHostedMemberEmailSnapshots: mocks.readHostedMemberEmailSnapshots,
  };
});

vi.mock("@/src/lib/hosted-onboarding/resend-plain-text-email", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/resend-plain-text-email")
  >("@/src/lib/hosted-onboarding/resend-plain-text-email");
  return {
    ...actual,
    sendHostedResendPlainTextEmailBatch:
      mocks.sendHostedResendPlainTextEmailBatch,
  };
});

import {
  HostedOpsMemberEmailNotConfiguredError,
  HostedOpsMemberEmailPreviewStaleError,
  previewHostedOpsMemberEmail,
  sendHostedOpsMemberEmail,
} from "@/src/lib/hosted-ops/member-email";

const NOW = new Date("2026-07-15T16:00:00.000Z");
const MEMBER_ONE = "hbm_member_1";
const MEMBER_TWO = "hbm_member_2";
const MEMBER_THREE = "hbm_member_3";
const MEMBER_FOUR = "hbm_member_4";
const SUBJECT = "Your Murph trial is ready again";
const TEXT = "Hey,\n\nI added more time to your trial.";
const ENV = {
  HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
  HOSTED_CONTACT_PRIVACY_KEYS: `v1:${Buffer.alloc(32, 7).toString("base64")}`,
  HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <hello@example.com>",
  RESEND_API_KEY: "re_test",
};

describe("hosted ops member email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.sendHostedResendPlainTextEmailBatch.mockResolvedValue({
      providerMessageIds: ["email_1"],
    });
  });

  it("previews ready and skipped members without exposing email addresses", async () => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValue([
      makeSnapshot(MEMBER_ONE, { verifiedEmail: "verified@example.com" }),
      makeSnapshot(MEMBER_TWO),
      makeSnapshot(MEMBER_THREE, {
        suspendedAt: new Date("2026-07-14T00:00:00.000Z"),
        verifiedEmail: "private@example.com",
      }),
    ]);

    const result = await previewHostedOpsMemberEmail({
      env: ENV,
      memberIds: [MEMBER_ONE, MEMBER_TWO, MEMBER_THREE, "hbm_missing"],
      now: NOW,
      subject: SUBJECT,
      text: TEXT,
    });

    expect(result).toMatchObject({
      outcome: "preview",
      recipients: [
        { memberId: MEMBER_ONE, status: "ready" },
        { memberId: MEMBER_TWO, status: "no_email" },
        { memberId: MEMBER_THREE, status: "member_suspended" },
        { memberId: "hbm_missing", status: "member_not_found" },
      ],
      summary: {
        readyCount: 1,
        requestedCount: 4,
        sentCount: 0,
        skippedCount: 3,
      },
    });
    expect(result.previewProof).toMatchObject({
      previewedAt: NOW.toISOString(),
      token: expect.stringMatching(/^ops-member-email-preview-v1\.v1\./u),
    });
    expect(JSON.stringify(result)).not.toContain("@");
    expect(mocks.sendHostedResendPlainTextEmailBatch).not.toHaveBeenCalled();
  });

  it("sends one separate batch item per ready member with stable idempotency", async () => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValue([
      makeSnapshot(MEMBER_ONE, {
        stripeCheckoutEmail: "older-payer@example.com",
        verifiedEmail: "verified@example.com",
      }),
      makeSnapshot(MEMBER_TWO, { stripeCheckoutEmail: "payer@example.com" }),
      makeSnapshot(MEMBER_THREE),
      makeSnapshot(MEMBER_FOUR, {
        suspendedAt: new Date("2026-07-14T00:00:00.000Z"),
        verifiedEmail: "suspended@example.com",
      }),
    ]);
    const draft = {
      env: ENV,
      memberIds: [
        MEMBER_ONE,
        MEMBER_TWO,
        MEMBER_THREE,
        MEMBER_FOUR,
        "hbm_missing",
      ],
      subject: SUBJECT,
      text: TEXT,
    };
    const preview = await previewHostedOpsMemberEmail({ ...draft, now: NOW });
    if (!preview.previewProof) {
      throw new Error("Expected a preview proof.");
    }

    const first = await sendHostedOpsMemberEmail({
      ...draft,
      now: new Date(NOW.getTime() + 60_000),
      previewProof: preview.previewProof,
    });
    await sendHostedOpsMemberEmail({
      ...draft,
      now: new Date(NOW.getTime() + 120_000),
      previewProof: preview.previewProof,
    });

    expect(first).toEqual({
      message: "2 member emails were sent.",
      outcome: "sent",
      previewProof: null,
      recipients: [
        { memberId: MEMBER_ONE, status: "sent" },
        { memberId: MEMBER_TWO, status: "sent" },
        { memberId: MEMBER_THREE, status: "no_email" },
        { memberId: MEMBER_FOUR, status: "member_suspended" },
        { memberId: "hbm_missing", status: "member_not_found" },
      ],
      summary: {
        readyCount: 0,
        requestedCount: 5,
        sentCount: 2,
        skippedCount: 3,
      },
    });
    expect(mocks.sendHostedResendPlainTextEmailBatch).toHaveBeenCalledTimes(2);
    const firstCall = mocks.sendHostedResendPlainTextEmailBatch.mock.calls[0]?.[0];
    const secondCall = mocks.sendHostedResendPlainTextEmailBatch.mock.calls[1]?.[0];
    expect(firstCall).toMatchObject({
      emails: [
        { subject: SUBJECT, text: TEXT, to: ["verified@example.com"] },
        { subject: SUBJECT, text: TEXT, to: ["payer@example.com"] },
      ],
      idempotencyKey: expect.stringMatching(/^hosted-ops-member-email\//u),
    });
    expect(JSON.stringify(first)).not.toContain("@");
    expect(secondCall.idempotencyKey).toBe(firstCall.idempotencyKey);
  });

  it.each([
    ["subject", { subject: `${SUBJECT}!` }],
    ["body", { text: `${TEXT}\nChanged` }],
    ["member order", { memberIds: [MEMBER_TWO, MEMBER_ONE] }],
  ])("rejects Send when the %s changed after Preview", async (_label, change) => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValue([
      makeSnapshot(MEMBER_ONE, { verifiedEmail: "verified@example.com" }),
      makeSnapshot(MEMBER_TWO, { verifiedEmail: "second@example.com" }),
    ]);
    const draft = {
      env: ENV,
      memberIds: [MEMBER_ONE, MEMBER_TWO],
      subject: SUBJECT,
      text: TEXT,
    };
    const preview = await previewHostedOpsMemberEmail({ ...draft, now: NOW });
    if (!preview.previewProof) {
      throw new Error("Expected a preview proof.");
    }

    await expect(sendHostedOpsMemberEmail({
      ...draft,
      ...change,
      now: new Date(NOW.getTime() + 60_000),
      previewProof: preview.previewProof,
    })).rejects.toBeInstanceOf(HostedOpsMemberEmailPreviewStaleError);
    expect(mocks.sendHostedResendPlainTextEmailBatch).not.toHaveBeenCalled();
  });

  it.each([
    [
      "recipient changed",
      [makeSnapshot(MEMBER_ONE, { verifiedEmail: "second@example.com" })],
    ],
    [
      "member became suspended",
      [makeSnapshot(MEMBER_ONE, {
        suspendedAt: new Date("2026-07-15T16:00:30.000Z"),
        verifiedEmail: "first@example.com",
      })],
    ],
    ["recipient disappeared", [makeSnapshot(MEMBER_ONE)]],
    ["member disappeared", []],
  ])("rejects Send when the %s after Preview", async (_label, sendSnapshots) => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValueOnce([
      makeSnapshot(MEMBER_ONE, { verifiedEmail: "first@example.com" }),
    ]).mockResolvedValueOnce(sendSnapshots);
    const draft = {
      env: ENV,
      memberIds: [MEMBER_ONE],
      subject: SUBJECT,
      text: TEXT,
    };
    const preview = await previewHostedOpsMemberEmail({ ...draft, now: NOW });
    if (!preview.previewProof) {
      throw new Error("Expected a preview proof.");
    }

    await expect(sendHostedOpsMemberEmail({
      ...draft,
      now: new Date(NOW.getTime() + 60_000),
      previewProof: preview.previewProof,
    })).rejects.toBeInstanceOf(HostedOpsMemberEmailPreviewStaleError);
    expect(mocks.sendHostedResendPlainTextEmailBatch).not.toHaveBeenCalled();
  });

  it("rejects Send if the configured sender changed after Preview", async () => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValue([
      makeSnapshot(MEMBER_ONE, { verifiedEmail: "verified@example.com" }),
    ]);
    const draft = {
      env: ENV,
      memberIds: [MEMBER_ONE],
      subject: SUBJECT,
      text: TEXT,
    };
    const preview = await previewHostedOpsMemberEmail({ ...draft, now: NOW });
    if (!preview.previewProof) {
      throw new Error("Expected a preview proof.");
    }

    await expect(sendHostedOpsMemberEmail({
      ...draft,
      env: {
        ...ENV,
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <other@example.com>",
      },
      now: new Date(NOW.getTime() + 60_000),
      previewProof: preview.previewProof,
    })).rejects.toBeInstanceOf(HostedOpsMemberEmailPreviewStaleError);
    expect(mocks.sendHostedResendPlainTextEmailBatch).not.toHaveBeenCalled();
  });

  it("rejects an expired Preview before contacting Resend", async () => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValue([
      makeSnapshot(MEMBER_ONE, { verifiedEmail: "verified@example.com" }),
    ]);
    const draft = {
      env: ENV,
      memberIds: [MEMBER_ONE],
      subject: SUBJECT,
      text: TEXT,
    };
    const preview = await previewHostedOpsMemberEmail({ ...draft, now: NOW });
    if (!preview.previewProof) {
      throw new Error("Expected a preview proof.");
    }

    await expect(sendHostedOpsMemberEmail({
      ...draft,
      now: new Date(NOW.getTime() + 24 * 60 * 60_000 + 1),
      previewProof: preview.previewProof,
    })).rejects.toBeInstanceOf(HostedOpsMemberEmailPreviewStaleError);
    expect(mocks.readHostedMemberEmailSnapshots).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedResendPlainTextEmailBatch).not.toHaveBeenCalled();
  });

  it("returns no proof when every supplied member is skipped", async () => {
    mocks.readHostedMemberEmailSnapshots.mockResolvedValue([]);

    await expect(previewHostedOpsMemberEmail({
      env: ENV,
      memberIds: [MEMBER_ONE],
      now: NOW,
      subject: SUBJECT,
      text: TEXT,
    })).resolves.toMatchObject({
      message: "No supplied member can receive this email.",
      previewProof: null,
      summary: { readyCount: 0, skippedCount: 1 },
    });
  });

  it("fails closed when the existing Resend configuration is absent", async () => {
    await expect(previewHostedOpsMemberEmail({
      env: {
        HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
        HOSTED_CONTACT_PRIVACY_KEYS: ENV.HOSTED_CONTACT_PRIVACY_KEYS,
      },
      memberIds: [MEMBER_ONE],
      now: NOW,
      subject: SUBJECT,
      text: TEXT,
    })).rejects.toBeInstanceOf(HostedOpsMemberEmailNotConfiguredError);
    expect(mocks.readHostedMemberEmailSnapshots).not.toHaveBeenCalled();
  });
});

function makeSnapshot(
  memberId: string,
  input: {
    stripeCheckoutEmail?: string;
    suspendedAt?: Date | null;
    verifiedEmail?: string;
  } = {},
) {
  return {
    core: {
      billingStatus: "paused",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      id: memberId,
      suspendedAt: input.suspendedAt ?? null,
      updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    },
    emailAuthorization: input.verifiedEmail || input.stripeCheckoutEmail
      ? {
          directPublicSender: null,
          memberId,
          stripeCheckoutEmail: input.stripeCheckoutEmail
            ? {
                address: input.stripeCheckoutEmail,
                collectedAt: new Date("2026-07-01T00:00:00.000Z"),
              }
            : null,
          verifiedEmail: input.verifiedEmail
            ? {
                address: input.verifiedEmail,
                lookupKey: "lookup_key",
                verifiedAt: new Date("2026-07-01T00:00:00.000Z"),
              }
            : null,
        }
      : null,
  };
}
