import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readHostedRunnerDeployment, type HostedRunnerDeployment, type HostedRunnerRelease } from "../src/hosted-runner-release.ts";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import type { ListCloudflareContainerApplications } from "./container-release-receipt.ts";
import { runnerApplicationExecutionIdentity, runnerApplicationMatches, runnerApplicationSpecification, type RunnerApplicationSpecification } from "./runner-release-application.ts";

export interface RunnerApplicationPreparation {
  applicationId: string | null;
  className: string;
  name: string;
  namespaceId: string;
  specification: RunnerApplicationSpecification;
}

export interface StagedRunnerRelease {
  activeApplicationName: string;
  applications: RunnerApplicationPreparation[];
  configPath: string;
  deployment: HostedRunnerDeployment;
  promotionConfigPath: string;
  workerOnly: boolean;
}

/** Derive execution identity and the inactive target from live authority, never a deploy attempt. */
export async function stageHostedRunnerRelease(input: {
  configPath: string;
  currentVersion: unknown;
  currentVersionId: string;
  listApplications: ListCloudflareContainerApplications;
}): Promise<StagedRunnerRelease> {
  const config: unknown = JSON.parse(await readFile(input.configPath, "utf8"));
  if (!isObjectRecord(config) || !isObjectRecord(config.vars)
    || !Array.isArray(config.containers) || typeof config.name !== "string") throw invalid();
  const vars = config.vars;
  const liveVars = readReleaseVariables(input.currentVersion);
  const liveDeployment = readHostedRunnerDeployment(liveVars);
  const active: HostedRunnerRelease = liveDeployment?.active ?? {
    bank: "primary", id: input.currentVersionId,
    bundleFingerprint: requiredString(liveVars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT),
    sourceFingerprint: requiredString(liveVars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT),
  };
  const activeClass = active.bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
  const candidateClass = active.bank === "primary" ? "NextRunnerContainer" : "RunnerContainer";
  const logsEnabled = isObjectRecord(config.observability) && (isObjectRecord(config.observability.logs)
    ? config.observability.logs.enabled === true : config.observability.enabled === true);
  const entries = await Promise.all(config.containers.map(async (value: unknown) => {
    if (!isObjectRecord(value)) throw invalid();
    const className = requiredString(value.class_name);
    const name = typeof value.name === "string" ? value.name : `${config.name}-${className}`.toLowerCase();
    const result = await input.listApplications(name);
    if (!Array.isArray(result) || result.length > 1) throw invalid();
    const live = result[0];
    if (live !== undefined && (!isObjectRecord(live) || live.name !== name)) throw invalid();
    return { rendered: value, className, name, live, specification: runnerApplicationSpecification(value, logsEnabled) };
  }));
  const serving = entries.find((entry) => entry.className === activeClass);
  const target = entries.find((entry) => entry.className === candidateClass);
  const smoke = entries.find((entry) => entry.className === "DeploySmokeRunnerContainer");
  if (!serving || !target || !smoke || !isObjectRecord(serving.live)) throw invalid();
  const bundleFingerprint = requiredString(vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT);
  const sourceFingerprint = requiredString(vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT);
  const executionIdentity = runnerApplicationExecutionIdentity(target.specification);
  const { deployment, candidate, workerOnly, resumeAdmittedCandidate } = selectDeployment({
    active, liveDeployment, executionIdentity, bundleFingerprint, sourceFingerprint,
    servingMatches: runnerApplicationMatches(serving.live, serving.specification), candidateExists: target.live !== undefined,
  });
  const applications = workerOnly ? [] : [target, smoke]
    .filter((entry) => !(resumeAdmittedCandidate && isObjectRecord(entry.live)
      && !entry.live.active_rollout_id && runnerApplicationMatches(entry.live, entry.specification)))
    .map((entry): RunnerApplicationPreparation => ({
    applicationId: isObjectRecord(entry.live) ? requiredString(entry.live.id) : null,
    className: entry.className, name: entry.name,
    namespaceId: readNamespaceId(input.currentVersion, entry.className), specification: entry.specification,
  }));
  const effectiveContainers = entries.map((entry) => {
    if (entry.className === candidateClass || entry.className === "DeploySmokeRunnerContainer") return entry.rendered;
    if (!isObjectRecord(entry.live) || !isObjectRecord(entry.live.configuration)
      || !Number.isSafeInteger(entry.live.max_instances) || Number(entry.live.max_instances) < 0) throw invalid();
    return { ...entry.rendered, image: requiredString(entry.live.configuration.image), max_instances: entry.live.max_instances };
  });
  readHostedRunnerDeployment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment) });
  const attempt = randomUUID();
  const configPath = path.join(path.dirname(input.configPath), `wrangler.stage-${attempt}.jsonc`);
  const promotionConfigPath = path.join(path.dirname(input.configPath), `wrangler.promote-${attempt}.jsonc`);
  const render = (release: HostedRunnerDeployment) => `${JSON.stringify({
    ...config, containers: effectiveContainers, vars: { ...vars, HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(release) },
  }, null, 2)}\n`;
  await writeFile(configPath, render(deployment), { encoding: "utf8", flag: "wx" });
  await writeFile(promotionConfigPath, render(workerOnly ? deployment : { active: candidate, candidate: null, previous: active }), { encoding: "utf8", flag: "wx" });
  return { activeApplicationName: serving.name, applications, configPath, deployment, promotionConfigPath, workerOnly };
}

function selectDeployment(input: {
  active: HostedRunnerRelease;
  liveDeployment: HostedRunnerDeployment | null;
  executionIdentity: string;
  bundleFingerprint: string;
  sourceFingerprint: string;
  servingMatches: boolean;
  candidateExists: boolean;
}) {
  const { active, liveDeployment, executionIdentity, bundleFingerprint, sourceFingerprint } = input;
  const sameExecution = (release: HostedRunnerRelease) => release.executionIdentity === executionIdentity
    && release.bundleFingerprint === bundleFingerprint && release.sourceFingerprint === sourceFingerprint;
  const workerOnly = sameExecution(active);
  if (workerOnly && (liveDeployment?.candidate || !input.servingMatches)) throw invalid();
  let candidate = liveDeployment?.candidate ?? null;
  if (candidate && !sameExecution(candidate)) {
    // The interrupted bootstrap uploaded a candidate pointer before native creation.
    // An absent application has never admitted execution and can be replaced safely.
    if (input.candidateExists) throw new Error("A different candidate release is pending; reconcile it before preparing another image.");
    candidate = null;
  }
  candidate ??= {
    bank: active.bank === "primary" ? "next" : "primary", id: `${active.bank === "primary" ? "next" : "primary"}-${randomUUID()}`,
    bundleFingerprint, sourceFingerprint, executionIdentity,
  };
  const deployment: HostedRunnerDeployment = workerOnly
    ? liveDeployment ?? { active, candidate: null, previous: null }
    : { active, candidate, previous: null };
  const resumeAdmittedCandidate = liveDeployment?.candidate !== null && liveDeployment?.candidate !== undefined
    && sameExecution(liveDeployment.candidate);
  return { deployment, candidate, workerOnly, resumeAdmittedCandidate };
}

function readVersionBindings(version: unknown): unknown[] {
  if (!isObjectRecord(version) || !isObjectRecord(version.resources)
    || !Array.isArray(version.resources.bindings)) throw invalid();
  return version.resources.bindings;
}

function readNamespaceId(version: unknown, className: string): string {
  const matches = readVersionBindings(version).filter((binding) => isObjectRecord(binding)
    && binding.type === "durable_object_namespace" && binding.class_name === className);
  if (matches.length !== 1 || !isObjectRecord(matches[0])) throw invalid();
  // Namespace migrations are a separate bootstrap step, never an incidental image rollout.
  return requiredString(matches[0].namespace_id);
}

function readReleaseVariables(version: unknown): Record<string, string> {
  const names = new Set(["HOSTED_EXECUTION_RUNNER_DEPLOYMENT", "HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT", "HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT"]);
  const result: Record<string, string> = {};
  for (const binding of readVersionBindings(version)) {
    if (!isObjectRecord(binding) || typeof binding.name !== "string" || !names.has(binding.name)) continue;
    if (binding.type !== "plain_text" || typeof binding.text !== "string" || binding.name in result) throw invalid();
    result[binding.name] = binding.text;
  }
  return result;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value) throw invalid();
  return value;
}

function invalid(): Error {
  return new Error("Cannot stage runner release from authoritative live configuration.");
}
