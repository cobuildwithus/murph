import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

export interface HostedPhoneCallRuntimeRecord {
  brief: HostedPhoneCallBrief;
  id: string;
  memberId: string;
}

export interface PhoneCallRuntimeStartResult {
  providerCallId: string;
}

export interface PhoneCallRuntime {
  start(call: HostedPhoneCallRuntimeRecord): Promise<PhoneCallRuntimeStartResult>;
}
