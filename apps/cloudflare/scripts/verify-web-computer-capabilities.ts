import { pathToFileURL } from "node:url";

import { requireConfiguredString } from "./deploy-automation/shared.ts";
import {
  normalizeHostedWebControlBaseUrl,
} from "../src/web-control-plane.ts";

const HOSTED_WEB_HEALTH_PATH = "/api/internal/health";
const DEPLOY_COMPUTER_CAPABILITY_CHECK_TIMEOUT_MS = 15_000;

type EnvSource = Readonly<Record<string, string | undefined>>;

export async function verifyHostedWebComputerCapabilities(input: {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  const env = input.env ?? process.env;
  const baseUrl = requireHostedWebBaseUrl(
    requireConfiguredString(
      env.HOSTED_WEB_PRODUCTION_BASE_URL,
      "HOSTED_WEB_PRODUCTION_BASE_URL",
    ),
  );
  const targetUrl = new URL(HOSTED_WEB_HEALTH_PATH.replace(/^\/+/u, ""), `${baseUrl}/`);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(targetUrl.toString(), {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(DEPLOY_COMPUTER_CAPABILITY_CHECK_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Hosted web computer-use capability check failed with HTTP ${response.status}; deploy hosted web first.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `Hosted web computer-use capability check returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!hasMemberScopedComputerUseProfileCapability(payload)) {
    throw new Error(
      "Hosted web computer-use capability check is missing computerUse.profileMode=member; deploy hosted web first.",
    );
  }
  console.log("Hosted web computer-use capabilities verified.");
}

function requireHostedWebBaseUrl(value: string): string {
  const normalized = normalizeHostedWebControlBaseUrl(value);

  if (!normalized) {
    throw new TypeError("HOSTED_WEB_PRODUCTION_BASE_URL must be an origin URL.");
  }

  return normalized;
}

function hasMemberScopedComputerUseProfileCapability(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || record.service !== "hosted-web") {
    return false;
  }
  const computerUse = record.computerUse;
  if (typeof computerUse !== "object" || computerUse === null || Array.isArray(computerUse)) {
    return false;
  }

  return (computerUse as Record<string, unknown>).profileMode === "member";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyHostedWebComputerCapabilities();
}
