export interface TrustedVerificationRequest {
  commandArgs: string[];
  verificationCommand: "test:diff" | "verify:acceptance";
}

export function buildTrustedVerificationEnvironment(
  source?: NodeJS.ProcessEnv,
): Record<string, string>;

export function parseTrustedVerificationRequest(
  argv: string[],
): TrustedVerificationRequest;

export function runTrustedVerification(
  argv: string[],
  sourceEnvironment?: NodeJS.ProcessEnv,
): Promise<number>;
