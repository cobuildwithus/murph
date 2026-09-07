import { setTimeout as delay } from "node:timers/promises";
import { isObjectRecord } from "./deploy-automation/shared.ts";

/** Read-only deployment preconditions. Provider failures never permit a switch. */
export function createRunnerReleaseProvider(input: {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const read = async (pathname: string): Promise<Record<string, unknown>> => {
    let value: unknown;
    try {
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}${pathname}`,
        {
          headers: { Authorization: `Bearer ${input.apiToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw unavailable();
      value = await response.json();
    } catch { throw unavailable(); }
    if (!isObjectRecord(value) || value.success !== true) throw unavailable();
    return value;
  };
  return {
    async readWorkerVersion(workerName: string, versionId: string): Promise<unknown> {
      const response = await read(`/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(versionId)}`);
      return response.result;
    },
    async assertDrained(applicationId: string): Promise<void> {
      // This waits in CI, while the active target continues serving messages.
      // Never stop a running member invocation to make a deployment progress.
      // The application deployment list contains native instances, not the
      // paginated historical Durable Object identities shown by the dashboard.
      const deadline = Date.now() + 20 * 60_000;
      do {
        const response = await read(`/containers/applications/${encodeURIComponent(applicationId)}/deployments`);
        if (!Array.isArray(response.result)) throw unavailable();
        const info = response.result_info;
        if (isObjectRecord(info) && info.next_page_token) throw unavailable();
        const drained = response.result.every((instance: unknown) => {
          if (!isObjectRecord(instance) || !isObjectRecord(instance.current_placement)
            || !isObjectRecord(instance.current_placement.status)) return false;
          const status = instance.current_placement.status;
          return (status.container_status ?? status.health) === "stopped";
        });
        if (drained) return;
        if (Date.now() >= deadline) break;
        await delay(10_000);
      } while (true);
      throw new Error("Previous runner target still has live containers; deployment left the active target serving.");
    },
  };
}

function unavailable(): Error {
  return new Error("Authoritative runner release state is unavailable; deployment stopped.");
}
