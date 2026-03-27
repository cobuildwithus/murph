import {
  readHostedExecutionWorkerEnvironment,
  type HostedExecutionWorkerEnvironment,
} from "@healthybob/hosted-execution";

import { decodeBase64Key } from "./base64.js";

export type HostedExecutionEnvironment = Omit<
  HostedExecutionWorkerEnvironment,
  "bundleEncryptionKeyBase64"
> & {
  bundleEncryptionKey: Uint8Array;
};

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionEnvironment(
  source: EnvSource = process.env,
): HostedExecutionEnvironment {
  const {
    bundleEncryptionKeyBase64,
    ...environment
  } = readHostedExecutionWorkerEnvironment(source);

  return {
    ...environment,
    bundleEncryptionKey: decodeBase64Key(bundleEncryptionKeyBase64),
  };
}
