import "server-only";

import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";

/**
 * App-store reviewers cannot read a sign-in inbox, so one dedicated review
 * account signs in with a fixed code from production configuration. Every
 * other address keeps random codes; storage, expiry, attempt and rate limits
 * are unchanged for the review account too. Unset or malformed configuration
 * disables it.
 */
export function hostedAuthReviewSignInCode(email: string): string | undefined {
  const review = readHostedAuthReviewAccount();
  return review && email.trim().toLowerCase() === review.email ? review.code : undefined;
}

/**
 * Reviewers also cannot receive a text or own a spare Telegram account, so the
 * companion lets the configured review member past the messaging-setup step.
 * Only that member's verified email qualifies, and only while the fixed code is
 * configured.
 */
export async function isHostedAuthReviewMember(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  return (await readHostedAuthReviewMemberId(input)) === input.memberId;
}

/** The configured review member, or null while the fixed code is off or nobody verified that email. */
export async function readHostedAuthReviewMemberId(input: {
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const review = readHostedAuthReviewAccount();
  if (!review) return null;
  const match = await lookupHostedMemberByVerifiedEmailAddress({
    address: review.email,
    prisma: input.prisma,
    projection: "core",
  });
  return match?.core.id ?? null;
}

function readHostedAuthReviewAccount(): { code: string; email: string } | null {
  const email = process.env.HOSTED_AUTH_REVIEW_EMAIL?.trim().toLowerCase();
  const code = process.env.HOSTED_AUTH_REVIEW_CODE?.trim();
  return email && code && /^\d{6}$/u.test(code) ? { code, email } : null;
}
