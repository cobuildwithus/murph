import { buildHostedExecutionUserRunPath } from "@healthybob/hosted-execution";

import { resolveSmokeWorkerBaseUrl } from "./smoke-hosted-deploy.shared.js";

function requireValue(value: string | undefined, label: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${label} must be configured.`);
  }

  return value.trim();
}

const workerBaseUrl = resolveSmokeWorkerBaseUrl();
const smokeUserId = process.env.HOSTED_EXECUTION_SMOKE_USER_ID?.trim() || null;
const controlToken = process.env.HOSTED_EXECUTION_CONTROL_TOKEN?.trim() || null;
const smokeVersionId = process.env.HOSTED_EXECUTION_SMOKE_VERSION_ID?.trim() || null;
const workerName = smokeVersionId
  ? requireValue(
      process.env.HOSTED_EXECUTION_SMOKE_WORKER_NAME
        ?? process.env.CF_WORKER_NAME,
      "HOSTED_EXECUTION_SMOKE_WORKER_NAME or CF_WORKER_NAME",
    )
  : null;

await assertHealth(new URL("/health", `${workerBaseUrl}/`).toString(), "worker");

if (smokeUserId) {
  if (!controlToken) {
    throw new Error("HOSTED_EXECUTION_CONTROL_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.");
  }

  await invokeManualRun({
    controlToken,
    url: new URL(buildHostedExecutionUserRunPath(smokeUserId), `${workerBaseUrl}/`).toString(),
  });

  console.log(`Manual smoke run accepted for ${smokeUserId}.`);
} else {
  console.log("Skipping manual smoke run because HOSTED_EXECUTION_SMOKE_USER_ID is not configured.");
}

console.log("Cloudflare hosted execution smoke checks passed.");

async function assertHealth(url: string, label: string): Promise<void> {
  const response = await fetch(url, {
    headers: buildVersionOverrideHeaders(),
  });

  if (!response.ok) {
    throw new Error(`${label} health check failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as { ok?: unknown };

  if (payload.ok !== true) {
    throw new Error(`${label} health check did not return ok=true.`);
  }
}

async function invokeManualRun(input: {
  controlToken: string;
  url: string;
}): Promise<void> {
  const response = await fetch(input.url, {
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${input.controlToken}`,
      "content-type": "application/json; charset=utf-8",
      ...buildVersionOverrideHeaders(),
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Manual smoke run failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}.`);
  }
}

function buildVersionOverrideHeaders(): Record<string, string> | undefined {
  if (!smokeVersionId || !workerName) {
    return undefined;
  }

  return {
    "Cloudflare-Workers-Version-Overrides": `${workerName}="${smokeVersionId}"`,
  };
}
