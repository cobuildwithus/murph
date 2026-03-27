function requireBaseUrl(value: string | undefined, label: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${label} must be configured.`);
  }

  return value.replace(/\/$/u, "");
}

const workerBaseUrl = requireBaseUrl(
  process.env.HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL
    ?? process.env.HOSTED_EXECUTION_CLOUDFLARE_BASE_URL,
  "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL",
);
const runnerBaseUrl = requireBaseUrl(
  process.env.HOSTED_EXECUTION_SMOKE_RUNNER_BASE_URL
    ?? process.env.HOSTED_EXECUTION_RUNNER_BASE_URL,
  "HOSTED_EXECUTION_SMOKE_RUNNER_BASE_URL",
);
const smokeUserId = process.env.HOSTED_EXECUTION_SMOKE_USER_ID?.trim() || null;
const controlToken = process.env.HOSTED_EXECUTION_CONTROL_TOKEN?.trim() || null;

await assertHealth(`${workerBaseUrl}/health`, "worker");
await assertHealth(`${runnerBaseUrl}/health`, "runner");

if (smokeUserId) {
  if (!controlToken) {
    throw new Error("HOSTED_EXECUTION_CONTROL_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.");
  }

  const response = await fetch(`${workerBaseUrl}/internal/users/${encodeURIComponent(smokeUserId)}/run`, {
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${controlToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Manual smoke run failed with HTTP ${response.status}: ${await response.text()}`);
  }

  console.log(`Manual smoke run accepted for ${smokeUserId}.`);
} else {
  console.log("Skipping manual smoke run because HOSTED_EXECUTION_SMOKE_USER_ID is not configured.");
}

console.log("Cloudflare hosted execution smoke checks passed.");

async function assertHealth(url: string, label: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label} health check failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as { ok?: unknown };

  if (payload.ok !== true) {
    throw new Error(`${label} health check did not return ok=true.`);
  }
}
