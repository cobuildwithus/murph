import "server-only";

/**
 * App-store reviewers cannot read a sign-in inbox, so one dedicated review
 * account signs in with a fixed code from production configuration. Every
 * other address keeps random codes; storage, expiry, attempt and rate limits
 * are unchanged for the review account too. Unset or malformed configuration
 * disables it.
 */
export function hostedAuthReviewSignInCode(email: string): string | undefined {
  const reviewEmail = process.env.HOSTED_AUTH_REVIEW_EMAIL?.trim().toLowerCase();
  const code = process.env.HOSTED_AUTH_REVIEW_CODE?.trim();
  if (!reviewEmail || !code || !/^\d{6}$/u.test(code)) return undefined;
  return email.trim().toLowerCase() === reviewEmail ? code : undefined;
}
