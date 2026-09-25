import { setTimeout as delay } from "node:timers/promises";
import { redactHostedRuntimeDiagnosticText } from "@murphai/hosted-execution";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import { runnerApplicationMatches, runnerApplicationResources, type RunnerApplicationSpecification } from "./runner-release-application.ts";

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
      // Reduce historical-object cursor traversal without relaxing drain proof.
      const query = new URLSearchParams({ per_page: "1000" });
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
      // Report only fixed categories and bounded counts, never opaque cursors.
      const paginationFailure = (reason: string) => unavailable(
        `Inactive instance pagination rejected: ${reason}; page=${page + 1}; nativeRows=${rows}.`,
      );
      if (typeof next !== "string") throw paginationFailure("non-string token");
      if (!next.trim()) throw paginationFailure("blank token");
      if (next.length > 2048) throw paginationFailure(`oversized token (length=${next.length})`);
      if (tokens.has(next)) throw paginationFailure("repeated token");
      tokens.add(next);
      pageToken = next;
    }
    throw unavailable("Inactive instance inspection exceeded its page bound.");
  };
  const readMatchingRollout = async (applicationId: string, live: Record<string, unknown>, specification: RunnerApplicationSpecification): Promise<Record<string, unknown> | null> => {
    const pathname = `/containers/applications/${encodeURIComponent(applicationId)}/rollouts`;
    const validate = (value: unknown): Record<string, unknown> => {
      if (!isObjectRecord(value) || !Number.isSafeInteger(value.target_version)
        || !runnerApplicationMatches(value.target_configuration, specification.configuration)
        || !["pending", "progressing", "completed"].includes(String(value.status))) {
        throw unavailable("Native rollout does not match the pending image.");
      }
      return value;
    };
    if (typeof live.active_rollout_id === "string" && live.active_rollout_id) {
      const result = (await request("Read active rollout", `${pathname}/${encodeURIComponent(live.active_rollout_id)}`)).result;
      const rollout = validate(result);
      if (rollout.id !== live.active_rollout_id || (rollout.current_version !== live.version
        && rollout.target_version !== live.version)) throw unavailable();
      return rollout;
    }
    let last: string | undefined;
    const cursors = new Set<string>();
    let matching: Record<string, unknown> | null = null;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: "100", ...(last ? { last } : {}) });
      const result = (await request("Read rollout history", `${pathname}?${query}`)).result;
      if (!Array.isArray(result) || result.length > 100 || result.some(value => !isObjectRecord(value))) throw unavailable();
      for (const rollout of result) {
        if (rollout.target_version !== live.version
          || !runnerApplicationMatches(rollout.target_configuration, specification.configuration)) continue;
        if (matching) throw unavailable("Multiple rollouts claim the pending image version.");
        matching = validate(rollout);
      }
      if (result.length < 100) return matching;
      const cursor: unknown = result.at(-1)?.id;
      if (typeof cursor !== "string" || !/^\S{1,2048}$/u.test(cursor) || cursors.has(cursor)) throw unavailable();
      cursors.add(cursor);
      last = cursor;
    }
    throw unavailable("Rollout history exceeded its page bound.");
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
    async retireApplication(input: { applicationId: string; name: string; namespaceId: string }): Promise<void> {
      const pathname = `/containers/applications/${encodeURIComponent(input.applicationId)}`;
      const live = (await request("Read retiring application", pathname)).result;
      assertApplicationIdentity(live, input);
      if (live.active_rollout_id) throw unavailable("Retiring application has an active rollout.");
      if (live.max_instances === 0) return;
      if (!await readDrainedInstances(input.applicationId, Date.now() + 30_000)) throw unavailable("Retiring application is not drained.");
      await request("Retire application capacity", pathname, "PATCH", { max_instances: 0 });
      const after = (await request("Verify retired application", pathname)).result;
      assertApplicationIdentity(after, input);
      if (after.max_instances !== 0 || after.active_rollout_id
        || !runnerApplicationMatches(after.configuration, live.configuration)) throw unavailable("Retired capacity verification differs; no rollback attempted.");
    },
    async assertCapacity(input: { applicationId: string; specification: RunnerApplicationSpecification }): Promise<void> {
      const limits = await this.readAccountLimits();
      const response = await request("Read account application budget", "/containers/applications");
      const applications = exhaustive(response);
      let found = false;
      const total = { vcpu: 0, memoryMiB: 0, diskMB: 0 };
      for (const application of applications) {
        if (!isObjectRecord(application)) throw unavailable();
        const target = application.id === input.applicationId;
        if (target && found) throw unavailable();
        found ||= target;
        const app = target ? input.specification : application;
        const resources = runnerApplicationResources(app.configuration);
        if (!Number.isSafeInteger(app.max_instances) || Number(app.max_instances) < 0) throw unavailable();
        const count = Number(app.max_instances);
        total.vcpu += count * resources.vcpu;
        total.memoryMiB += count * resources.memoryMiB;
        total.diskMB += count * resources.diskMB;
      }
      if (!found) throw unavailable();
      if (total.vcpu > limits.vcpu || total.memoryMiB > limits.memoryMiB || total.diskMB > limits.diskMB) {
        throw unavailable("Requested single-fleet capacity exceeds the measured account resource budget.");
      }
    },
    async admitApplication(input: {
      applicationId: string | null;
      name: string;
      namespaceId: string;
      specification: RunnerApplicationSpecification;
      rolloutStepPercentage?: number | readonly number[];
    }): Promise<"created" | "modified" | "unchanged"> {
      const desired = { ...input.specification, name: input.name, durable_objects: { namespace_id: input.namespaceId } };
      if (input.applicationId === null) {
        const response = await request("Create inactive application", "/containers/applications", "POST", { ...desired, instances: 0 });
        if (!isObjectRecord(response.result) || typeof response.result.id !== "string") throw unavailable();
        return "created";
      }
      const pathname = `/containers/applications/${encodeURIComponent(input.applicationId)}`;
      const live = (await request("Read application", pathname)).result;
      assertApplicationIdentity(live, input);
      const matches = runnerApplicationMatches(live, input.specification);
      if (live.active_rollout_id || matches) {
        const rollout = await readMatchingRollout(input.applicationId, live, input.specification);
        const { configuration: _configuration, ...settings } = input.specification;
        if (rollout && !runnerApplicationMatches(live, settings)) throw unavailable("Pending application settings differ from the requested release.");
        if (rollout) return rollout.status === "completed" && !live.active_rollout_id ? "unchanged" : "modified";
      }
      // A matching application target without distribution evidence is a lost
      // PATCH/POST pair. Preserve its version and complete the existing target.
      if (!matches) await request("Modify application", pathname, "PATCH", input.specification);
      const steps = input.rolloutStepPercentage ?? 100;
      await request("Start application rollout", `${pathname}/rollouts`, "POST", {
        description: "Update runner image", strategy: "rolling", kind: "full_auto",
        ...(typeof steps === "number" ? { step_percentage: steps }
          : { steps: steps.map(percentage => ({ step_size: { percentage }, description: `Roll out to ${percentage}% of instances` })) }),
        target_configuration: input.specification.configuration,
      });
      return "modified";
    },
    async assertApplicationReady(input: {
      name: string;
      specification: RunnerApplicationSpecification;
      listApplications: (name: string) => Promise<unknown>;
      rolloutStepCount?: number;
    }): Promise<void> {
      // Each native step can spend fifteen minutes draining, plus grace/startup.
      const steps = input.rolloutStepCount ?? 1;
      if (!Number.isInteger(steps) || steps < 1 || steps > 4) throw unavailable();
      const attempts = 150 * steps;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const result = await input.listApplications(input.name);
        if (!Array.isArray(result) || result.length !== 1 || !isObjectRecord(result[0])) throw unavailable();
        const live = result[0];
        if (!live.active_rollout_id && runnerApplicationMatches(live, input.specification)) {
          if (typeof live.id !== "string") throw unavailable();
          const rollout = await readMatchingRollout(live.id, live, input.specification);
          if (rollout?.status === "completed" || (!rollout && live.version === 1)) return;
        }
        if (attempt < attempts - 1) await delay(10_000);
      }
      throw new Error("Native runner rollout did not converge; the compatible Worker and pending image remain selected.");
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

function assertApplicationIdentity(value: unknown, input: { name: string; namespaceId: string }): asserts value is Record<string, unknown> {
  if (!isObjectRecord(value) || value.name !== input.name || !isObjectRecord(value.configuration)
    || !isObjectRecord(value.durable_objects) || value.durable_objects.namespace_id !== input.namespaceId) throw unavailable();
}

function exhaustive(envelope: Record<string, unknown>): unknown[] {
  if (!Array.isArray(envelope.result) || envelope.result.length > 10_000) throw unavailable();
  const info = envelope.result_info;
  if (info !== undefined && (!isObjectRecord(info) || info.next_page_token || info.cursor
    || (info.total_count !== undefined && info.total_count !== envelope.result.length))) throw unavailable();
  return envelope.result;
}
