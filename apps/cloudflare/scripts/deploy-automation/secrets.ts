import {
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
} from "./worker-secret-names.ts";
export {
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
} from "./worker-secret-names.ts";

import { normalizeOptionalString, requireConfiguredString } from "./shared.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function buildHostedWorkerSecretsPayload(
  source: EnvSource = process.env,
): Record<string, string> {
  return {
    ...readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES),
    ...readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_SECRET_NAMES),
  };
}

function readPresentStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  const entries = keys.flatMap((key) => {
    const value = normalizeOptionalString(source[key]);
    return value ? [[key, value] as const] : [];
  });

  return Object.fromEntries(entries);
}

function readRequiredStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => [key, requireConfiguredString(source[key], key)]),
  );
}
