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

export type PhoneCallRuntimeStartResult =
  | {
      cleanupRequired?: false;
      providerCallId: string;
    }
  | {
      cleanupRequired: true;
      error: unknown;
      providerCallId: string;
    };

export type PhoneCallRuntimeReconciliationResult =
  | {
      providerCallId: string;
      state: "found" | "cleanup_required";
    }
  | {
      state: "not_found";
    };

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
  validateStart?(call: HostedPhoneCallRuntimeRecord): Promise<void> | void;
  resolveProviderCall(
    murphPhoneCallId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PhoneCallRuntimeReconciliationResult>;
  start(
    call: HostedPhoneCallRuntimeRecord,
    options?: { signal?: AbortSignal },
  ): Promise<PhoneCallRuntimeStartResult>;
  stopIfActive(
    providerCallId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}
