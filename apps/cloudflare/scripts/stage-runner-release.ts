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

/** Resume an admitted artifact before a rebuild can change timestamp-only image bytes. */
export async function readReusableHostedRunnerImage(input: {
  config: Record<string, unknown>;
  currentVersion: unknown;
  releaseSha: string;
  listApplications: ListCloudflareContainerApplications;
}): Promise<string | null> {
  const deployment = readHostedRunnerDeployment(readReleaseVariables(input.currentVersion));
  if (!deployment || isLegacyCandidate(deployment.candidate)) return null;
  const release = deployment.candidate ?? deployment.active;
  const className = release.bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
  const config = input.config;
  if (!Array.isArray(config.containers) || !isObjectRecord(config.vars)) throw invalid();
  const container = config.containers.find((entry: unknown) => isObjectRecord(entry) && entry.class_name === className);
  if (!isObjectRecord(container)) throw invalid();
  const name = typeof container.name === "string" ? container.name : `${config.name}-${className}`.toLowerCase();
  const live = await readNativeApplication(input.listApplications, name);
  if (!live) return null;
  if (!isObjectRecord(live.configuration)) throw invalid();
  const image = requiredString(live.configuration.image);
  const specification = runnerApplicationSpecification({ ...container, image }, readLogsEnabled(config));
  const matches = matchesRunnerArtifact(release, {
    releaseSha: input.releaseSha,
    bundleFingerprint: config.vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT,
    sourceFingerprint: config.vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT,
  })
    && release.executionIdentity === runnerApplicationExecutionIdentity(specification)
    && runnerApplicationMatches(live, specification);
  if (!matches) {
    if (deployment.candidate) throw new Error("A different candidate release is pending; reconcile it before preparing another image.");
    return null;
  }
  if (!isObjectRecord(live.durable_objects)
    || live.durable_objects.namespace_id !== readNamespaceId(input.currentVersion, className)) throw invalid();
  return image;
}

/** Derive execution identity and the inactive target from live authority, never a deploy attempt. */
export async function stageHostedRunnerRelease(input: {
  configPath: string;
  currentVersion: unknown;
  currentVersionId: string;
  retainServingRunner?: boolean;
  releaseSha: string;
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
  const logsEnabled = readLogsEnabled(config);
  const entries = await Promise.all(config.containers.map(async (value: unknown) => {
    if (!isObjectRecord(value)) throw invalid();
    const className = requiredString(value.class_name);
    const name = typeof value.name === "string" ? value.name : `${config.name}-${className}`.toLowerCase();
    const live = await readNativeApplication(input.listApplications, name);
    return { rendered: value, className, name, live, specification: runnerApplicationSpecification(value, logsEnabled) };
  }));
  const serving = entries.find((entry) => entry.className === activeClass);
  const target = entries.find((entry) => entry.className === candidateClass);
  const smoke = entries.find((entry) => entry.className === "DeploySmokeRunnerContainer");
  if (!serving || !target || !smoke || !isObjectRecord(serving.live)) throw invalid();
  if (input.retainServingRunner) assertBoundedSmoke(smoke.live, smoke.specification);
  const bundleFingerprint = requiredString(vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT);
  const sourceFingerprint = requiredString(vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT);
  const executionIdentity = runnerApplicationExecutionIdentity(target.specification);
  const { deployment, promoted, workerOnly, resumeAdmittedCandidate } = input.retainServingRunner
    ? retainDeployment(active, liveDeployment, target.live !== undefined)
    : selectDeployment({
    active, liveDeployment, executionIdentity, bundleFingerprint, sourceFingerprint, releaseSha: input.releaseSha,
    servingMatches: runnerApplicationMatches(serving.live, serving.specification), candidateExists: target.live !== undefined,
  });
  const applications = (input.retainServingRunner ? [smoke] : workerOnly ? [] : [target, smoke])
    .filter((entry) => !(resumeAdmittedCandidate && isObjectRecord(entry.live)
      && !entry.live.active_rollout_id && runnerApplicationMatches(entry.live, entry.specification)))
    .map((entry): RunnerApplicationPreparation => ({
    applicationId: isObjectRecord(entry.live) ? requiredString(entry.live.id) : null,
    className: entry.className, name: entry.name,
    namespaceId: readNamespaceId(input.currentVersion, entry.className), specification: entry.specification,
  }));
  const effectiveContainers = entries
    .filter((entry) => !input.retainServingRunner || entry.live || entry.className === "DeploySmokeRunnerContainer")
    .map((entry) => {
    if ((!input.retainServingRunner && entry.className === candidateClass) || entry.className === "DeploySmokeRunnerContainer") return entry.rendered;
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
  await writeFile(promotionConfigPath, render(promoted), { encoding: "utf8", flag: "wx" });
  return { activeApplicationName: serving.name, applications, configPath, deployment, promotionConfigPath, workerOnly };
}

function assertBoundedSmoke(live: unknown, specification: RunnerApplicationSpecification): void {
  if (!isObjectRecord(live) || live.max_instances !== 1 || specification.max_instances !== 1) throw invalid();
}

function retainDeployment(active: HostedRunnerRelease, live: HostedRunnerDeployment | null, candidateExists: boolean) {
  if (live?.previous && !candidateExists) throw invalid();
  // Retain an existing pending namespace as history so its next reuse proves drain.
  const deployment: HostedRunnerDeployment = {
    active, candidate: null,
    previous: live?.previous ?? (candidateExists ? live?.candidate ?? null : null),
  };
  return { deployment, promoted: deployment, workerOnly: true, resumeAdmittedCandidate: false };
}

function selectDeployment(input: {
  active: HostedRunnerRelease;
  liveDeployment: HostedRunnerDeployment | null;
  executionIdentity: string;
  bundleFingerprint: string;
  sourceFingerprint: string;
  servingMatches: boolean;
  candidateExists: boolean;
  releaseSha: string;
}) {
  const { active, liveDeployment, executionIdentity, bundleFingerprint, sourceFingerprint } = input;
  const sameExecution = (release: HostedRunnerRelease) => release.executionIdentity === executionIdentity
    && matchesRunnerArtifact(release, input);
  const workerOnly = sameExecution(active);
  if (workerOnly && (liveDeployment?.candidate || !input.servingMatches)) throw invalid();
  let candidate = liveDeployment?.candidate ?? null;
  if (candidate && !sameExecution(candidate)) {
    // A legacy staging pointer is not an immutable admission receipt. Native
    // creation may have committed before its response or Worker publication was lost.
    // Reconcile that inactive namespace through the existing drain/admission path.
    if (input.candidateExists && !isLegacyCandidate(candidate)) throw new Error("A different candidate release is pending; reconcile it before preparing another image.");
    candidate = null;
  }
  candidate ??= {
    bank: active.bank === "primary" ? "next" : "primary", id: `${active.bank === "primary" ? "next" : "primary"}-${randomUUID()}`,
    bundleFingerprint, sourceFingerprint, executionIdentity,
    releaseSha: input.releaseSha,
  };
  const deployment: HostedRunnerDeployment = workerOnly
    ? liveDeployment ?? { active, candidate: null, previous: null }
    : { active, candidate, previous: null };
  const resumeAdmittedCandidate = liveDeployment?.candidate ? sameExecution(liveDeployment.candidate) : false;
  const promoted: HostedRunnerDeployment = workerOnly ? deployment : { active: candidate, candidate: null, previous: active };
  return { deployment, promoted, workerOnly, resumeAdmittedCandidate };
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

function readLogsEnabled(config: Record<string, unknown>): boolean {
  return isObjectRecord(config.observability) && (isObjectRecord(config.observability.logs)
    ? config.observability.logs.enabled === true : config.observability.enabled === true);
}

function isLegacyCandidate(release: HostedRunnerRelease | null): boolean {
  return release !== null && release.executionIdentity === undefined && release.releaseSha === undefined;
}

async function readNativeApplication(listApplications: ListCloudflareContainerApplications, name: string) {
  const result = await listApplications(name);
  if (!Array.isArray(result) || result.length > 1) throw invalid();
  const live: unknown = result[0];
  if (live === undefined) return undefined;
  if (!isObjectRecord(live) || live.name !== name) throw invalid();
  return live;
}

function matchesRunnerArtifact(release: HostedRunnerRelease, expected: {
  releaseSha: unknown; bundleFingerprint: unknown; sourceFingerprint: unknown;
}): boolean {
  return release.releaseSha === expected.releaseSha && release.bundleFingerprint === expected.bundleFingerprint
    && release.sourceFingerprint === expected.sourceFingerprint;
}

function invalid(): Error {
  return new Error("Cannot stage runner release from authoritative live configuration.");
}
