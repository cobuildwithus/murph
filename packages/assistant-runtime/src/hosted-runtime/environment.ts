import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeHostedEmailBaseUrl } from "../hosted-email.ts";
import type {
  HostedAssistantRuntimeConfig,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";

const HOSTED_RUNNER_COMMIT_BASE_URL = "http://commit.worker";
const HOSTED_RUNNER_SIDE_EFFECTS_BASE_URL = "http://side-effects.worker";

export function normalizeHostedAssistantRuntimeConfig(
  input: HostedAssistantRuntimeConfig | undefined,
): NormalizedHostedAssistantRuntimeConfig {
  return {
    commitBaseUrl: normalizeCallbackBaseUrl(
      input?.commitBaseUrl,
      HOSTED_RUNNER_COMMIT_BASE_URL,
    ),
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    emailBaseUrl: normalizeHostedEmailBaseUrl(input?.emailBaseUrl),
    forwardedEnv: { ...(input?.forwardedEnv ?? {}) },
    sharePackBaseUrl: normalizeOptionalCallbackBaseUrl(
      input?.sharePackBaseUrl
        ?? input?.forwardedEnv?.HOSTED_ONBOARDING_PUBLIC_BASE_URL
        ?? null,
    ),
    sharePackToken: normalizeOptionalString(
      input?.sharePackToken
        ?? input?.forwardedEnv?.HOSTED_SHARE_INTERNAL_TOKEN
        ?? null,
    ),
    sideEffectsBaseUrl: normalizeCallbackBaseUrl(
      input?.sideEffectsBaseUrl ?? input?.outboxBaseUrl,
      HOSTED_RUNNER_SIDE_EFFECTS_BASE_URL,
    ),
    userEnv: { ...(input?.userEnv ?? {}) },
  };
}

export function resolveHostedRuntimeChildEntry(): string {
  const builtPath = fileURLToPath(new URL("../hosted-runtime-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("../hosted-runtime-child.ts", import.meta.url));
}

export function resolveHostedRuntimeTsconfigPath(): string {
  return fileURLToPath(new URL("../../../../tsconfig.base.json", import.meta.url));
}

export async function withHostedProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  hostedMemberId: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  const nextValues: Record<string, string> = {
    ...input.envOverrides,
    HOSTED_MEMBER_ID: input.hostedMemberId,
    HOME: input.operatorHomeRoot,
    VAULT: input.vaultRoot,
  };

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

function normalizeOptionalCallbackBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? new URL(normalized).toString() : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCallbackBaseUrl(value: string | null | undefined, fallback: string): string {
  const candidate = value && value.trim().length > 0 ? value : fallback;
  return new URL(candidate).toString();
}
