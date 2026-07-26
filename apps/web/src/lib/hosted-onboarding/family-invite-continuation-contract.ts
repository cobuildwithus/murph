import type { HostedPlanCode } from "./billing-plans";

export interface HostedFamilyInviteContinuationPayload {
  addSeatIfNeeded: true;
  planCode: HostedPlanCode;
  targetEmail?: string;
  targetLabel?: string;
  targetPhoneNumber?: string;
  targetTelegramUsername?: string;
}

export interface HostedFamilyInvitePaymentContinuation {
  paymentUrl: string;
  payload: HostedFamilyInviteContinuationPayload;
}
