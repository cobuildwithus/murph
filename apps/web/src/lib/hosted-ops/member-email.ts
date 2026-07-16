import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import {
  readHostedMemberEmailSnapshots,
  type HostedMemberEmailSnapshot,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmailBatch,
} from "../hosted-onboarding/resend-plain-text-email";
import { getPrisma } from "../prisma";

const PREVIEW_TOKEN_PREFIX = "ops-member-email-preview-v1";
const PREVIEW_HMAC_CONTEXT = "hosted-ops-member-email-preview-v1";
const PREVIEW_PROOF_TTL_MS = 24 * 60 * 60_000;
const PREVIEW_CLOCK_SKEW_MS = 60_000;

export const HOSTED_OPS_MEMBER_EMAIL_MAX_RECIPIENTS = 100;
export const HOSTED_OPS_MEMBER_EMAIL_MAX_SUBJECT_LENGTH = 200;
export const HOSTED_OPS_MEMBER_EMAIL_MAX_TEXT_LENGTH = 20_000;

export type HostedOpsMemberEmailRecipientStatus =
  | "member_not_found"
  | "member_suspended"
  | "no_email"
  | "ready"
  | "sent";

export interface HostedOpsMemberEmailRecipientResult {
  memberId: string;
  status: HostedOpsMemberEmailRecipientStatus;
}

export interface HostedOpsMemberEmailPreviewProof {
  previewedAt: string;
  token: string;
}

export interface HostedOpsMemberEmailResult {
  message: string;
  outcome: "preview" | "sent";
  previewProof: HostedOpsMemberEmailPreviewProof | null;
  recipients: HostedOpsMemberEmailRecipientResult[];
  summary: {
    readyCount: number;
    requestedCount: number;
    sentCount: number;
    skippedCount: number;
  };
}

type HostedOpsMemberEmailEnvironment = Readonly<
  Record<string, string | undefined>
>;

type HostedOpsMemberEmailDependencies = {
  env?: HostedOpsMemberEmailEnvironment;
  fetchImpl?: typeof fetch;
  prisma?: Parameters<typeof readHostedMemberEmailSnapshots>[0]["prisma"];
};

type HostedOpsMemberEmailDraft = {
  memberIds: readonly string[];
  subject: string;
  text: string;
};

type HostedOpsMemberEmailInspection = {
  recipient: string | null;
  result: HostedOpsMemberEmailRecipientResult;
};

export class HostedOpsMemberEmailPreviewStaleError extends Error {
  constructor() {
    super("The member or draft changed since Preview. Preview this email again.");
    this.name = "HostedOpsMemberEmailPreviewStaleError";
  }
}

export class HostedOpsMemberEmailNotConfiguredError extends Error {
  constructor() {
    super("Member email sending is not configured.");
    this.name = "HostedOpsMemberEmailNotConfiguredError";
  }
}

export async function previewHostedOpsMemberEmail(
  input: HostedOpsMemberEmailDraft &
    HostedOpsMemberEmailDependencies & {
      now?: Date;
    },
): Promise<HostedOpsMemberEmailResult> {
  const dependencies = resolveHostedOpsMemberEmailDependencies(input);
  const inspections = await inspectHostedOpsMemberEmailRecipients({
    memberIds: input.memberIds,
    prisma: dependencies.prisma,
  });
  const readyCount = countReadyHostedOpsMemberEmailRecipients(inspections);
  const previewProof = readyCount > 0
    ? buildHostedOpsMemberEmailPreviewProof({
        env: dependencies.env,
        from: dependencies.from,
        inspections,
        memberIds: input.memberIds,
        previewedAt: input.now ?? new Date(),
        subject: input.subject,
        text: input.text,
      })
    : null;

  return buildHostedOpsMemberEmailResult({
    inspections,
    outcome: "preview",
    previewProof,
  });
}

export async function sendHostedOpsMemberEmail(
  input: HostedOpsMemberEmailDraft &
    HostedOpsMemberEmailDependencies & {
      now?: Date;
      previewProof: HostedOpsMemberEmailPreviewProof;
    },
): Promise<HostedOpsMemberEmailResult> {
  const dependencies = resolveHostedOpsMemberEmailDependencies(input);
  requireHostedOpsMemberEmailPreviewFresh({
    now: input.now ?? new Date(),
    previewProof: input.previewProof,
  });
  const inspections = await inspectHostedOpsMemberEmailRecipients({
    memberIds: input.memberIds,
    prisma: dependencies.prisma,
  });

  if (
    countReadyHostedOpsMemberEmailRecipients(inspections) === 0 ||
    !verifyHostedOpsMemberEmailPreviewProof({
      env: dependencies.env,
      from: dependencies.from,
      inspections,
      memberIds: input.memberIds,
      previewProof: input.previewProof,
      subject: input.subject,
      text: input.text,
    })
  ) {
    throw new HostedOpsMemberEmailPreviewStaleError();
  }

  const readyRecipients = inspections.flatMap((inspection) =>
    inspection.result.status === "ready" && inspection.recipient
      ? [inspection.recipient]
      : []
  );
  const tokenParts = readHostedOpsMemberEmailPreviewTokenParts(
    input.previewProof.token,
  );

  await sendHostedResendPlainTextEmailBatch({
    config: dependencies.resend,
    emails: readyRecipients.map((recipient) => ({
      subject: input.subject,
      text: input.text,
      to: [recipient],
    })),
    fetchImpl: dependencies.fetchImpl,
    idempotencyKey: `hosted-ops-member-email/${tokenParts.digest}`,
  });

  return buildHostedOpsMemberEmailResult({
    inspections,
    outcome: "sent",
    previewProof: null,
  });
}

function resolveHostedOpsMemberEmailDependencies(
  input: HostedOpsMemberEmailDependencies,
) {
  const env = input.env ?? process.env;
  const resend = readHostedResendPlainTextEmailConfig(env);
  if (!resend) {
    throw new HostedOpsMemberEmailNotConfiguredError();
  }

  return {
    env,
    fetchImpl: input.fetchImpl,
    from: resend.from,
    prisma: input.prisma ?? getPrisma(),
    resend,
  };
}

async function inspectHostedOpsMemberEmailRecipients(input: {
  memberIds: readonly string[];
  prisma: Parameters<typeof readHostedMemberEmailSnapshots>[0]["prisma"];
}): Promise<HostedOpsMemberEmailInspection[]> {
  const snapshots = await readHostedMemberEmailSnapshots(input);
  const snapshotByMemberId = new Map(
    snapshots.map((snapshot) => [snapshot.core.id, snapshot]),
  );

  return input.memberIds.map((memberId) =>
    inspectHostedOpsMemberEmailRecipient({
      memberId,
      snapshot: snapshotByMemberId.get(memberId) ?? null,
    })
  );
}

function inspectHostedOpsMemberEmailRecipient(input: {
  memberId: string;
  snapshot: HostedMemberEmailSnapshot | null;
}): HostedOpsMemberEmailInspection {
  if (!input.snapshot) {
    return buildSkippedHostedOpsMemberEmailInspection(
      input.memberId,
      "member_not_found",
    );
  }
  if (input.snapshot.core.suspendedAt) {
    return buildSkippedHostedOpsMemberEmailInspection(
      input.memberId,
      "member_suspended",
    );
  }

  const recipient = input.snapshot.emailAuthorization?.verifiedEmail?.address
    ?? input.snapshot.emailAuthorization?.stripeCheckoutEmail?.address
    ?? null;
  if (!recipient) {
    return buildSkippedHostedOpsMemberEmailInspection(
      input.memberId,
      "no_email",
    );
  }

  return {
    recipient,
    result: {
      memberId: input.memberId,
      status: "ready",
    },
  };
}

function buildSkippedHostedOpsMemberEmailInspection(
  memberId: string,
  status: Exclude<
    HostedOpsMemberEmailRecipientStatus,
    "ready" | "sent"
  >,
): HostedOpsMemberEmailInspection {
  return {
    recipient: null,
    result: { memberId, status },
  };
}

function buildHostedOpsMemberEmailResult(input: {
  inspections: HostedOpsMemberEmailInspection[];
  outcome: HostedOpsMemberEmailResult["outcome"];
  previewProof: HostedOpsMemberEmailPreviewProof | null;
}): HostedOpsMemberEmailResult {
  const readyCount = countReadyHostedOpsMemberEmailRecipients(
    input.inspections,
  );
  const sentCount = input.outcome === "sent" ? readyCount : 0;
  const recipients = input.inspections.map(({ result }) => ({
    ...result,
    status: input.outcome === "sent" && result.status === "ready"
      ? "sent" as const
      : result.status,
  }));
  const requestedCount = recipients.length;
  const skippedCount = requestedCount - readyCount;

  return {
    message: input.outcome === "sent"
      ? `${sentCount} member email${sentCount === 1 ? " was" : "s were"} sent.`
      : readyCount > 0
      ? `${readyCount} of ${requestedCount} member${requestedCount === 1 ? " is" : "s are"} ready to receive this email.`
      : "No supplied member can receive this email.",
    outcome: input.outcome,
    previewProof: input.previewProof,
    recipients,
    summary: {
      readyCount: input.outcome === "preview" ? readyCount : 0,
      requestedCount,
      sentCount,
      skippedCount,
    },
  };
}

function countReadyHostedOpsMemberEmailRecipients(
  inspections: HostedOpsMemberEmailInspection[],
): number {
  return inspections.filter(
    ({ result }) => result.status === "ready",
  ).length;
}

function buildHostedOpsMemberEmailPreviewProof(input: {
  env: HostedOpsMemberEmailEnvironment;
  from: string;
  inspections: HostedOpsMemberEmailInspection[];
  memberIds: readonly string[];
  previewedAt: Date;
  subject: string;
  text: string;
}): HostedOpsMemberEmailPreviewProof {
  const previewedAt = input.previewedAt.toISOString();
  return {
    previewedAt,
    token: signHostedOpsMemberEmailPreview({
      ...input,
      previewedAt,
    }),
  };
}

function verifyHostedOpsMemberEmailPreviewProof(input: {
  env: HostedOpsMemberEmailEnvironment;
  from: string;
  inspections: HostedOpsMemberEmailInspection[];
  memberIds: readonly string[];
  previewProof: HostedOpsMemberEmailPreviewProof;
  subject: string;
  text: string;
}): boolean {
  let tokenParts: ReturnType<typeof readHostedOpsMemberEmailPreviewTokenParts>;
  try {
    tokenParts = readHostedOpsMemberEmailPreviewTokenParts(
      input.previewProof.token,
    );
  } catch {
    return false;
  }

  const expected = signHostedOpsMemberEmailPreview({
    env: input.env,
    from: input.from,
    inspections: input.inspections,
    keyVersion: tokenParts.keyVersion,
    memberIds: input.memberIds,
    previewedAt: input.previewProof.previewedAt,
    subject: input.subject,
    text: input.text,
  });
  const actualBuffer = Buffer.from(input.previewProof.token);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function signHostedOpsMemberEmailPreview(input: {
  env: HostedOpsMemberEmailEnvironment;
  from: string;
  inspections: HostedOpsMemberEmailInspection[];
  keyVersion?: string;
  memberIds: readonly string[];
  previewedAt: string;
  subject: string;
  text: string;
}): string {
  const keyring = readHostedContactPrivacyKeyring(input.env);
  const keyVersion = input.keyVersion ?? keyring.currentVersion;
  const sourceKey = keyring.keysByVersion[keyVersion];
  if (!sourceKey) {
    throw new HostedOpsMemberEmailPreviewStaleError();
  }
  const digest = createHmac(
    "sha256",
    createHash("sha256")
      .update(PREVIEW_HMAC_CONTEXT, "utf8")
      .update("\0", "utf8")
      .update(sourceKey)
      .digest(),
  )
    .update(JSON.stringify({
      from: input.from,
      memberIds: input.memberIds,
      previewedAt: input.previewedAt,
      recipients: input.inspections.map((inspection) => ({
        memberId: inspection.result.memberId,
        recipient: inspection.recipient,
        status: inspection.result.status,
      })),
      subject: input.subject,
      text: input.text,
    }), "utf8")
    .digest("base64url");

  return `${PREVIEW_TOKEN_PREFIX}.${keyVersion}.${digest}`;
}

function readHostedOpsMemberEmailPreviewTokenParts(token: string): {
  digest: string;
  keyVersion: string;
} {
  const match = new RegExp(
    `^${PREVIEW_TOKEN_PREFIX}\\.(v[0-9]+)\\.([A-Za-z0-9_-]{43})$`,
    "u",
  ).exec(token);
  if (!match?.[1] || !match[2]) {
    throw new HostedOpsMemberEmailPreviewStaleError();
  }
  return {
    digest: match[2],
    keyVersion: match[1],
  };
}

function requireHostedOpsMemberEmailPreviewFresh(input: {
  now: Date;
  previewProof: HostedOpsMemberEmailPreviewProof;
}): void {
  const previewedAt = new Date(input.previewProof.previewedAt);
  if (
    !Number.isFinite(previewedAt.getTime()) ||
    previewedAt.toISOString() !== input.previewProof.previewedAt ||
    input.now.getTime() < previewedAt.getTime() - PREVIEW_CLOCK_SKEW_MS ||
    input.now.getTime() - previewedAt.getTime() > PREVIEW_PROOF_TTL_MS
  ) {
    throw new HostedOpsMemberEmailPreviewStaleError();
  }
}
