export interface HostedInviteStatusPayload {
  capabilities: {
    billingReady: boolean;
    passkeyReady: boolean;
  };
  invite: {
    code: string;
    expiresAt: string;
    phoneHint: string;
    status: string;
  } | null;
  member: {
    billingStatus: string;
    hasPasskeys: boolean;
    phoneHint: string;
    status: string;
  } | null;
  session: {
    authenticated: boolean;
    expiresAt: string | null;
    matchesInvite: boolean;
  };
  stage: "invalid" | "expired" | "register" | "authenticate" | "checkout" | "active";
}
