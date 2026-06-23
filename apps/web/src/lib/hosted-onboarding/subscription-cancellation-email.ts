import { HostedBillingStatus, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { normalizeNullableString } from "../primitives";
import {
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
} from "./hosted-member-store";
import {
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
  type HostedResendPlainTextEmailConfig,
} from "./resend-plain-text-email";

const HOSTED_SUBSCRIPTION_CANCELLATION_EMAIL_SUBJECT =
  "Quick question about your Murph subscription";

type HostedSubscriptionCancellationEmailEnv = Readonly<Record<string, string | undefined>>;

export type HostedSubscriptionCancellationEmailResult =
  | {
      reason:
        | "member_not_canceled"
        | "member_not_found"
        | "no_cancellation_email_recipient"
        | "not_configured";
      status: "skipped";
    }
  | {
      status: "sent";
    };

export async function sendHostedSubscriptionCancellationEmailForMember(input: {
  env?: HostedSubscriptionCancellationEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  prisma?: PrismaClient;
  stripeSubscriptionId: string;
}): Promise<HostedSubscriptionCancellationEmailResult> {
  const prisma = input.prisma ?? getPrisma();
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma,
  });

  if (!member) {
    return {
      reason: "member_not_found",
      status: "skipped",
    };
  }

  if (member.billingStatus !== HostedBillingStatus.canceled || member.suspendedAt) {
    return {
      reason: "member_not_canceled",
      status: "skipped",
    };
  }

  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma,
  });
  const recipient = emailAuthorization?.verifiedEmail?.address
    ?? emailAuthorization?.stripeCheckoutEmail?.address
    ?? null;

  if (!recipient) {
    return {
      reason: "no_cancellation_email_recipient",
      status: "skipped",
    };
  }

  const config = readHostedSubscriptionCancellationEmailConfig(input.env ?? process.env);

  if (!config) {
    return {
      reason: "not_configured",
      status: "skipped",
    };
  }

  await sendHostedResendPlainTextEmail({
    config: config.resend,
    fetchImpl: input.fetchImpl,
    idempotencyKey: buildHostedSubscriptionCancellationEmailIdempotencyKey(
      input.stripeSubscriptionId,
    ),
    subject: HOSTED_SUBSCRIPTION_CANCELLATION_EMAIL_SUBJECT,
    text: buildHostedSubscriptionCancellationEmailText({
      founderName: config.founderName,
    }),
    to: [recipient],
  });

  return {
    status: "sent",
  };
}

type HostedSubscriptionCancellationEmailConfig = {
  founderName: string;
  resend: HostedResendPlainTextEmailConfig;
};

function readHostedSubscriptionCancellationEmailConfig(
  source: HostedSubscriptionCancellationEmailEnv,
): HostedSubscriptionCancellationEmailConfig | null {
  const resend = readHostedResendPlainTextEmailConfig(source);
  const founderName = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME);

  if (!resend || !founderName) {
    return null;
  }

  return {
    founderName,
    resend,
  };
}

function buildHostedSubscriptionCancellationEmailText(input: {
  founderName: string;
}): string {
  return [
    "Hey,",
    "",
    `I'm ${input.founderName}, the founder of Murph. I saw your subscription was canceled and wanted to check in personally.`,
    "",
    "If something went wrong or you didn't mean to cancel, just reply and I'll help fix it.",
    "",
    "If Murph fell short, I'd be grateful for a sentence or two on what didn't work, or a screenshot of where it performed poorly. It helps us improve.",
    "",
    "If you want a refund, reply here and I'll take care of it.",
    "",
    "Best,",
    input.founderName,
  ].join("\n");
}

function buildHostedSubscriptionCancellationEmailIdempotencyKey(
  stripeSubscriptionId: string,
): string {
  return `hosted-subscription-cancellation/${stripeSubscriptionId}`.slice(0, 256);
}
