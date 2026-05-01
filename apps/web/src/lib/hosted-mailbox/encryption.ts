import { decryptHostedWebString, encryptHostedWebString } from "../hosted-crypto/secure-box";

export class HostedMailboxConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: { code: string; httpStatus: number; message: string }) {
    super(input.message);
    this.name = "HostedMailboxConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedMailboxConfigurationError(input: {
  code: string;
  httpStatus: number;
  message: string;
}): HostedMailboxConfigurationError {
  return new HostedMailboxConfigurationError(input);
}

export function isHostedMailboxConfigurationError(error: unknown): error is HostedMailboxConfigurationError {
  return error instanceof HostedMailboxConfigurationError;
}

export async function encryptHostedMailboxNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  return encryptHostedWebString({
    aad: {
      field: input.field,
      purpose: "hosted-mailbox-payload",
    },
    lane: "mailbox-payload",
    scope: `hosted-mailbox-payload:${input.field}`,
    userId: input.userId,
    value: input.value,
  });
}

export async function decryptHostedMailboxNullableString(input: {
  field: string;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  return decryptHostedWebString({
    aad: {
      field: input.field,
      purpose: "hosted-mailbox-payload",
    },
    lane: "mailbox-payload",
    scope: `hosted-mailbox-payload:${input.field}`,
    userId: input.userId,
    value: input.value,
  });
}
