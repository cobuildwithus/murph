import { readHostedExecutionWorkerEnvironment } from "@healthybob/hosted-execution";

import { decodeBase64Key } from "./base64.js";

export interface HostedExecutionEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeyId: string;
  cloudflareBaseUrl: string | null;
  controlToken: string | null;
  defaultAlarmDelayMs: number;
  dispatchSigningSecret: string;
  maxEventAttempts: number;
  retryDelayMs: number;
  runnerControlToken: string | null;
  runnerTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionEnvironment(
  source: EnvSource = process.env,
): HostedExecutionEnvironment {
  const environment = readHostedExecutionWorkerEnvironment(source);

  return {
    allowedUserEnvKeys: environment.allowedUserEnvKeys,
    allowedUserEnvPrefixes: environment.allowedUserEnvPrefixes,
    bundleEncryptionKey: decodeBase64Key(environment.bundleEncryptionKeyBase64),
    bundleEncryptionKeyId: environment.bundleEncryptionKeyId,
    cloudflareBaseUrl: environment.cloudflareBaseUrl,
    controlToken: environment.controlToken,
    defaultAlarmDelayMs: environment.defaultAlarmDelayMs,
    dispatchSigningSecret: environment.dispatchSigningSecret,
    maxEventAttempts: environment.maxEventAttempts,
    retryDelayMs: environment.retryDelayMs,
    runnerControlToken: environment.runnerControlToken,
    runnerTimeoutMs: environment.runnerTimeoutMs,
  };
}
