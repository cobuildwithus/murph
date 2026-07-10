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
  stop(providerCallId: string): Promise<void>;
}

export class PhoneCallRuntimeStartRejectedError extends Error {
  readonly providerCallId: string | null;

  constructor(
    message: string,
    options?: ErrorOptions & { providerCallId?: string },
  ) {
    super(message, options);
    this.name = "PhoneCallRuntimeStartRejectedError";
    this.providerCallId = options?.providerCallId ?? null;
  }
}

export function isPhoneCallRuntimeStartRejectedError(
  error: unknown,
): error is PhoneCallRuntimeStartRejectedError {
  return error instanceof PhoneCallRuntimeStartRejectedError;
}
