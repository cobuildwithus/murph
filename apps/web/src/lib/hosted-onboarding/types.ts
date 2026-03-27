export interface HostedInviteStatusPayload {
  capabilities: {
    billingReady: boolean;
    phoneAuthReady: boolean;
  };
  invite: {
    code: string;
    expiresAt: string;
    phoneHint: string;
    status: string;
  } | null;
  member: {
    billingStatus: string;
    hasWallet: boolean;
    phoneHint: string;
    phoneVerified: boolean;
    status: string;
    walletAddress: string | null;
    walletChainType: string | null;
  } | null;
  session: {
    authenticated: boolean;
    expiresAt: string | null;
    matchesInvite: boolean;
  };
  stage: "invalid" | "expired" | "register" | "authenticate" | "checkout" | "active";
}

export interface HostedPrivyCompletionPayload {
  inviteCode: string;
  joinUrl: string;
  stage: "checkout" | "active";
}
