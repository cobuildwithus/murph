import { applyHostedSessionCookie } from "./session";

export { createHostedBillingCheckout } from "./billing-service";
export {
  buildHostedInvitePageData,
  completeHostedPrivyVerification,
  getHostedInviteStatus,
  issueHostedInviteForPhone,
} from "./member-service";
export {
  handleHostedOnboardingLinqWebhook,
  handleHostedOnboardingTelegramWebhook,
  handleHostedStripeWebhook,
} from "./webhook-service";

export function attachHostedSessionCookie(input: {
  expiresAt: Date;
  response: import("next/server").NextResponse;
  token: string;
}): void {
  applyHostedSessionCookie(input.response, input.token, input.expiresAt);
}
