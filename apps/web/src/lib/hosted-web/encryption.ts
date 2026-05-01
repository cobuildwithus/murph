import { decryptHostedWebString, encryptHostedWebString } from "../hosted-crypto/secure-box";

export class HostedWebConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: { code: string; httpStatus: number; message: string }) {
    super(input.message);
    this.name = "HostedWebConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedWebConfigurationError(input: {
  code: string;
  httpStatus: number;
  message: string;
}): HostedWebConfigurationError {
  return new HostedWebConfigurationError(input);
}

export function isHostedWebConfigurationError(error: unknown): error is HostedWebConfigurationError {
  return error instanceof HostedWebConfigurationError;
}

export async function encryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  return encryptHostedWebString({
    aad: {
      field: input.field,
      purpose: "hosted-member-private-field",
    },
    lane: "hosted-member-private-field",
    scope: `hosted-member-private-field:${input.field}`,
    userId: input.memberId,
    value: input.value,
  });
}

export async function decryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  return decryptHostedWebString({
    aad: {
      field: input.field,
      purpose: "hosted-member-private-field",
    },
    lane: "hosted-member-private-field",
    scope: `hosted-member-private-field:${input.field}`,
    userId: input.memberId,
    value: input.value,
  });
}
