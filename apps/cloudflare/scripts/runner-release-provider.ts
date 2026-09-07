import { setTimeout as delay } from "node:timers/promises";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import { runnerApplicationMatches, type RunnerApplicationSpecification } from "./runner-release-application.ts";

/** Native admission and release evidence. Provider failures never permit a Worker switch. */
export function createRunnerReleaseProvider(input: {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async (pathname: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> => {
    let value: unknown;
    try {
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}${pathname}`,
        {
          method,
          headers: { Authorization: `Bearer ${input.apiToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    async readAccountLimits(): Promise<{ vcpu: number; memoryMiB: number; diskMB: number }> {
      const response = await request("/containers/me");
      const account = response.result;
      if (!isObjectRecord(account) || !isObjectRecord(account.limits)) throw unavailable();
      const limits = account.limits;
      const positive = (value: unknown): number => {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw unavailable();
        return value;
      };
      // Return only resource limits, never account identity, defaults or credentials.
      return {
        vcpu: positive(limits.total_vcpu),
        memoryMiB: positive(limits.total_memory_mib),
        diskMB: positive(limits.total_disk_mb),
      };
    },
    async readWorkerVersion(workerName: string, versionId: string): Promise<unknown> {
      const response = await request(`/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(versionId)}`);
      return response.result;
    },
    async admitApplication(input: {
      applicationId: string | null;
      name: string;
      namespaceId: string;
      specification: RunnerApplicationSpecification;
    }): Promise<"created" | "modified" | "unchanged"> {
      const desired = { ...input.specification, name: input.name, durable_objects: { namespace_id: input.namespaceId } };
      if (input.applicationId === null) {
        const response = await request("/containers/applications", "POST", { ...desired, instances: 0 });
        if (!isObjectRecord(response.result) || typeof response.result.id !== "string") throw unavailable();
        return "created";
      }
      const pathname = `/containers/applications/${encodeURIComponent(input.applicationId)}`;
      const response = await request(pathname);
      const live = response.result;
      if (!isObjectRecord(live) || live.name !== input.name
        || !isObjectRecord(live.durable_objects) || live.durable_objects.namespace_id !== input.namespaceId) throw unavailable();
      if (live.active_rollout_id) throw new Error("Candidate native rollout is still in progress; active Worker is unchanged.");
      // PATCH updates the target for new deployments; an interrupted PATCH/rollout
      // pair must still roll prefetched instances before readiness is accepted.
      await request(pathname, "PATCH", input.specification);
      await request(`${pathname}/rollouts`, "POST", {
        description: "Prepare inactive runner release", strategy: "rolling", kind: "full_auto",
        step_percentage: 100, target_configuration: input.specification.configuration,
      });
      return "modified";
    },
    async assertApplicationReady(input: {
      name: string;
      specification: RunnerApplicationSpecification;
      listApplications: (name: string) => Promise<unknown>;
    }): Promise<void> {
      // Distribution waits belong in CI; member requests never poll native release state.
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await input.listApplications(input.name);
        if (!Array.isArray(result) || result.length !== 1 || !isObjectRecord(result[0])) throw unavailable();
        const live = result[0];
        if (!live.active_rollout_id && runnerApplicationMatches(live, input.specification)) return;
        if (attempt < 59) await delay(10_000);
      }
      throw new Error("Candidate native application did not converge; active Worker is unchanged.");
    },
    async assertDrained(applicationId: string): Promise<void> {
      // This waits in CI, while the active target continues serving messages.
      // Never stop a running member invocation to make a deployment progress.
      // The application deployment list contains native instances, not the
      // paginated historical Durable Object identities shown by the dashboard.
      const deadline = Date.now() + 20 * 60_000;
      do {
        const response = await request(`/containers/applications/${encodeURIComponent(applicationId)}/deployments`);
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
