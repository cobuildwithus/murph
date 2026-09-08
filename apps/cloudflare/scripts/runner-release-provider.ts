import { setTimeout as delay } from "node:timers/promises";
import { redactHostedRuntimeDiagnosticText } from "@murphai/hosted-execution";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import { runnerApplicationMatches, type RunnerApplicationSpecification } from "./runner-release-application.ts";

/** Native admission and release evidence. Provider failures never permit a Worker switch. */
export function createRunnerReleaseProvider(input: {
  accountId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async (operation: string, pathname: string, method = "GET", body?: unknown, privateRequestValues: readonly string[] = []): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}${pathname}`,
        {
          method,
          headers: { Authorization: `Bearer ${input.apiToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch { throw unavailable(`${operation}: request failed before a response.`); }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw unavailable(`${operation}: HTTP ${response.status}; invalid JSON response.`); }
    if (!response.ok || !isObjectRecord(value) || value.success !== true) {
      const requestBody = isObjectRecord(body) ? body : {};
      const configuration = isObjectRecord(requestBody.configuration) ? requestBody.configuration : {};
      const privateValues = [input.apiToken, input.accountId, requestBody.name, configuration.image, ...privateRequestValues]
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
      throw unavailable(`${operation}: HTTP ${response.status}; errors=${providerErrorSummary(value, privateValues)}.`);
    }
    return value;
  };
  const readDrainedInstances = async (applicationId: string, deadline: number): Promise<boolean> => {
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    let rows = 0;
    for (let page = 0; page < 100; page++) {
      if (Date.now() >= deadline) throw unavailable("Inactive instance inspection exceeded its deadline.");
      const query = new URLSearchParams({ per_page: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const response = await request("Read inactive instances",
        `/containers/dash/applications/${encodeURIComponent(applicationId)}/instances?${query}`,
        "GET", undefined, [applicationId, pageToken ?? ""]);
      const instances = isObjectRecord(response.result) ? response.result.instances : undefined;
      if (!Array.isArray(instances) || (rows += instances.length) > 10_000) throw unavailable();
      // Historical Durable Object identities are not running native instances.
      const stopped = instances.every((instance: unknown) => {
        if (!isObjectRecord(instance) || !isObjectRecord(instance.current_placement)
          || !isObjectRecord(instance.current_placement.status)) return false;
        const status = instance.current_placement.status;
        return (status.container_status ?? status.health) === "stopped";
      });
      if (!stopped) return false;
      const info = response.result_info;
      if (info !== undefined && !isObjectRecord(info)) throw unavailable();
      const next = isObjectRecord(info) ? info.next_page_token : undefined;
      if (next === undefined || next === null || next === "") return true;
      if (typeof next !== "string" || !next.trim() || next.length > 2048 || tokens.has(next)) throw unavailable();
      tokens.add(next);
      pageToken = next;
    }
    throw unavailable("Inactive instance inspection exceeded its page bound.");
  };
  return {
    async readAccountLimits(): Promise<{ vcpu: number; memoryMiB: number; diskMB: number }> {
      const response = await request("Read account limits", "/containers/me");
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
      const response = await request("Read Worker version", `/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(versionId)}`);
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
        const response = await request("Create inactive application", "/containers/applications", "POST", { ...desired, instances: 0 });
        if (!isObjectRecord(response.result) || typeof response.result.id !== "string") throw unavailable();
        return "created";
      }
      const pathname = `/containers/applications/${encodeURIComponent(input.applicationId)}`;
      const response = await request("Read inactive application", pathname);
      const live = response.result;
      if (!isObjectRecord(live) || live.name !== input.name
        || !isObjectRecord(live.durable_objects) || live.durable_objects.namespace_id !== input.namespaceId) throw unavailable();
      if (live.active_rollout_id) throw new Error("Candidate native rollout is still in progress; active Worker is unchanged.");
      // PATCH updates the target for new deployments; an interrupted PATCH/rollout
      // pair must still roll prefetched instances before readiness is accepted.
      await request("Modify inactive application", pathname, "PATCH", input.specification);
      await request("Start inactive rollout", `${pathname}/rollouts`, "POST", {
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
      // Use the paginated Containers instance endpoint used by Wrangler.
      const deadline = Date.now() + 20 * 60_000;
      do {
        const drained = await readDrainedInstances(applicationId, deadline);
        if (drained) return;
        if (Date.now() >= deadline) break;
        await delay(10_000);
      } while (true);
      throw new Error("Previous runner target still has live containers; deployment left the active target serving.");
    },
  };
}

// Preserve bounded explanations at the provider boundary, never raw response details.
function providerErrorSummary(value: unknown, privateValues: readonly string[]): string {
  if (!isObjectRecord(value) || !Array.isArray(value.errors)) return "unavailable";
  return JSON.stringify(value.errors.slice(0, 5).filter(isObjectRecord).map((error) => {
    let message = typeof error.message === "string" ? error.message : "unavailable";
    for (const privateValue of privateValues) message = message.split(privateValue).join("<redacted>");
    message = redactHostedRuntimeDiagnosticText(message)
      .replace(/\b(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/giu, "<redacted-resource>")
      .replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320);
    return { code: typeof error.code === "number" && Number.isSafeInteger(error.code) ? error.code : null, message };
  }));
}

function unavailable(detail?: string): Error {
  return new Error(`Authoritative runner release state is unavailable; deployment stopped.${detail ? ` ${detail}` : ""}`);
}
