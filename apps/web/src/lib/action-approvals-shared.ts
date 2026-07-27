import type { HostedActionApprovalReturnContactKind } from "@murphai/hosted-execution/action-approval";

export interface HostedActionApprovalPresentation {
  body: string;
  title: string;
}

export type HostedActionApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export type HostedActionApprovalContinuation =
  | "automatic"
  | "return-to-conversation";

export type HostedActionApprovalPresentationKind =
  | "fact-rows"
  | "prose";

export interface HostedActionApprovalView {
  approvalId: string;
  continuation: HostedActionApprovalContinuation;
  expiresAt: string;
  presentation: HostedActionApprovalPresentation;
  presentationKind: HostedActionApprovalPresentationKind;
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  status: HostedActionApprovalStatus;
}

export interface HostedActionApprovalDecisionResponse
  extends HostedActionApprovalView {
  redirectTo: string | null;
}
