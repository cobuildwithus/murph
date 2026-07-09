export interface CallCircleBridgePhoneCallState {
  analyzedAt: Date | null;
  endedAt: Date | null;
  providerCallId: string | null;
  providerStartAttemptedAt: Date | null;
  status: string;
}

export function isUnstartedCallCircleBridgePhoneCall(
  phoneCall: Omit<CallCircleBridgePhoneCallState, "endedAt"> | null,
): boolean {
  return phoneCall !== null
    && phoneCall.analyzedAt === null
    && phoneCall.providerCallId === null
    && phoneCall.providerStartAttemptedAt === null
    && phoneCall.status === "starting";
}

export function isPreProviderFailedCallCircleBridgePhoneCall(
  phoneCall: CallCircleBridgePhoneCallState | null,
): boolean {
  return phoneCall !== null
    && phoneCall.analyzedAt === null
    && phoneCall.endedAt === null
    && phoneCall.providerCallId === null
    && phoneCall.status === "failed";
}
