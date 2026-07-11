import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

export interface HostedPhoneCallRuntimeRecord {
  brief: HostedPhoneCallBrief;
  id: string;
  memberId: string;
  transferNumber: string | null;
}

export interface PhoneCallRuntimeStartResult {
  providerCallId: string;
}

const phoneCallRuntimeNoActiveEffectErrors = new WeakSet<object>();

export function markPhoneCallRuntimeNoActiveEffect<TError>(error: TError): TError {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    phoneCallRuntimeNoActiveEffectErrors.add(error);
  }
  return error;
}

export function hasPhoneCallRuntimeNoActiveEffect(error: unknown): boolean {
  return ((typeof error === "object" && error !== null) || typeof error === "function")
    && phoneCallRuntimeNoActiveEffectErrors.has(error);
}

export interface PhoneCallRuntime {
  start(
    call: HostedPhoneCallRuntimeRecord,
    options?: { signal?: AbortSignal },
  ): Promise<PhoneCallRuntimeStartResult>;
}
