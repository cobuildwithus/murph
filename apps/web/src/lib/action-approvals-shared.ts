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

export interface HostedActionApprovalView {
  approvalId: string;
  expiresAt: string;
  presentation: HostedActionApprovalPresentation;
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  status: HostedActionApprovalStatus;
}

export interface HostedActionApprovalDecisionResponse
  extends HostedActionApprovalView {
  redirectTo: string | null;
}
