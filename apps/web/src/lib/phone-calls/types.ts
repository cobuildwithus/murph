import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

export interface HostedPhoneCallRuntimeRecord {
  brief: HostedPhoneCallBrief;
  id: string;
  memberId: string;
  openingLine?: string | null;
  retellAgentId?: string | null;
  retellAgentVersion?: string | null;
  transferNumber: string | null;
}

export interface PhoneCallRuntimeStartResult {
  providerCallId: string;
}

export interface PhoneCallRuntime {
  validateStart?(call: HostedPhoneCallRuntimeRecord): Promise<void> | void;
  start(call: HostedPhoneCallRuntimeRecord): Promise<PhoneCallRuntimeStartResult>;
}
