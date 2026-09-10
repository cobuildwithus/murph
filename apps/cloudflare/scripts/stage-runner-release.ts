import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readHostedRunnerDeployment, type HostedRunnerDeployment, type HostedRunnerRelease } from "../src/hosted-runner-release.ts";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import type { ListCloudflareContainerApplications } from "./container-release-receipt.ts";
import { runnerApplicationExecutionIdentity, runnerApplicationMatches, runnerApplicationResources, runnerApplicationSpecification, type RunnerApplicationSpecification } from "./runner-release-application.ts";
import { readSmallRunnerEnabled } from "../src/small-runner-profile.ts";

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
  retirements: Array<{ applicationId: string; name: string; namespaceId: string }>;
  configPath: string;
  deployment: HostedRunnerDeployment;
  promotionConfigPath: string;
  workerOnly: boolean;
}

/** Namespace migrations require deploy, so retain every native application and
 * disable new selection for this one-time infrastructure publication. */
export async function prepareSmallRunnerNamespaceBootstrap(input: {
  allowed: boolean;
  configPath: string;
  currentVersion: unknown;
  currentVersionId: string;
  listApplications: ListCloudflareContainerApplications;
}): Promise<string | null> {
  const config: unknown = JSON.parse(await readFile(input.configPath, "utf8"));
  if (!isObjectRecord(config) || !isObjectRecord(config.vars) || !Array.isArray(config.containers)) throw invalid();
  if (!config.containers.some(entry => isObjectRecord(entry) && entry.class_name === "SmallRunnerContainer")) return null;
  const exists = readVersionBindings(input.currentVersion).some(binding => isObjectRecord(binding)
    && binding.type === "durable_object_namespace" && binding.class_name === "SmallRunnerContainer");
  if (exists) { readNamespaceId(input.currentVersion, "SmallRunnerContainer"); return null; }
  if (!input.allowed) throw new Error("Small runner namespace provisioning requires CF_BOOTSTRAP_SMALL_RUNNER=true in the protected deployment.");
  const liveVars = readReleaseVariables(input.currentVersion);
  const deployment = readHostedRunnerDeployment(liveVars) ?? { active: {
    bank: "primary", id: input.currentVersionId,
    bundleFingerprint: requiredString(liveVars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT),
    sourceFingerprint: requiredString(liveVars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT),
  }, candidate: null, previous: null };
  if (deployment.candidate) throw pendingConflict();
  const containers: Record<string, unknown>[] = [];
  const logsEnabled = readLogsEnabled(config);
  for (const value of config.containers) {
    if (!isObjectRecord(value)) throw invalid();
    const className = requiredString(value.class_name);
    if (className === "SmallRunnerContainer") continue;
    const live = await readNativeApplication(input.listApplications, applicationName(config, value));
    if (!live) {
      if (isOptionalBootstrapApplication(className, deployment)) continue;
      throw invalid();
    }
    if (!isObjectRecord(live.configuration) || !isObjectRecord(live.durable_objects)
      || live.durable_objects.namespace_id !== readNamespaceId(input.currentVersion, className)
      || live.active_rollout != null) throw invalid();
    const retained = retainNativeContainer(value, live);
    if (!runnerApplicationMatches(live, runnerApplicationSpecification(
      retained, logsEnabled, requiredString(live.configuration.image),
    ))) throw invalid();
    containers.push(retained);
  }
  const output = path.join(path.dirname(input.configPath), `wrangler.bootstrap-small-${randomUUID()}.jsonc`);
  await writeFile(output, `${JSON.stringify({ ...config, containers, vars: {
    ...config.vars, ...liveVars, HOSTED_EXECUTION_SMALL_RUNNER_ENABLED: "false",
    HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment),
  } }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return output;
}

function isOptionalBootstrapApplication(className: string, deployment: HostedRunnerDeployment): boolean {
  return className === "StandbyRunnerContainer"
    || (className === "NextRunnerContainer" && deployment.active.bank !== "next");
}

/** The renderer declares one budget; live authority chooses its physical namespace. */
function memberContainer(config: Record<string, unknown>, className: string): Record<string, unknown> {
  if (!Array.isArray(config.containers)) throw invalid();
  const budget = config.containers.find((entry: unknown) => isObjectRecord(entry) && entry.class_name === "RunnerContainer");
  const target = config.containers.find((entry: unknown) => isObjectRecord(entry) && entry.class_name === className);
  if (!isObjectRecord(budget) || !isObjectRecord(target)) throw invalid();
  return { ...target, max_instances: budget.max_instances,
    rollout_step_percentage: budget.rollout_step_percentage };
}

/** Pending image identity survives publication before the first native mutation. */
export async function readReusableHostedRunnerImage(input: {
  config: Record<string, unknown>;
  currentVersion: unknown;
  releaseSha: string;
  listApplications: ListCloudflareContainerApplications;
}): Promise<string | null> {
  const deployment = readHostedRunnerDeployment(readReleaseVariables(input.currentVersion));
  if (!deployment) return null;
  const release = deployment.candidate ?? deployment.active;
  if (!release.releaseSha || !release.executionIdentity) return null;
  const className = release.bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
  const container = memberContainer(input.config, className);
  if (!isObjectRecord(input.config.vars)) throw invalid();
  if (!matchesRunnerArtifact(release, { releaseSha: input.releaseSha,
    bundleFingerprint: input.config.vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT,
    sourceFingerprint: input.config.vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT })) {
    if (deployment.candidate) throw pendingConflict();
    return null;
  }
  const name = applicationName(input.config, container);
  const live = await readNativeApplication(input.listApplications, name);
  if (!live || !isObjectRecord(live.configuration) || !isObjectRecord(live.durable_objects)
    || live.durable_objects.namespace_id !== readNamespaceId(input.currentVersion, className)) throw invalid();
  const image = release.image ?? requiredString(live.configuration.image);
  // Legacy pointers predate immutable image receipts.
  if (!/@sha256:[a-f0-9]{64}$/u.test(image)) return null;
  const specification = runnerApplicationSpecification({ ...container, image }, readLogsEnabled(input.config));
  if (deployment.candidate && release.executionIdentity !== runnerApplicationExecutionIdentity(specification)) throw pendingConflict();
  return image;
}

/** Keep slot ownership stable; only the admitted image changes during normal releases. */
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
  if (!input.retainServingRunner && liveDeployment?.candidate
    && liveDeployment.candidate.bank !== active.bank) throw pendingConflict();
  const activeClass = active.bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
  const inactiveClass = active.bank === "primary" ? "NextRunnerContainer" : "RunnerContainer";
  const logsEnabled = readLogsEnabled(config);
  const entries = await Promise.all(config.containers.map(async (value: unknown) => {
    if (!isObjectRecord(value)) throw invalid();
    const className = requiredString(value.class_name);
    const rendered = className === activeClass ? memberContainer(config, className) : value;
    const name = applicationName(config, rendered);
    const live = await readNativeApplication(input.listApplications, name);
    if (live && (!isObjectRecord(live.configuration) || !Number.isSafeInteger(live.max_instances)
      || Number(live.max_instances) < 0 || !isObjectRecord(live.durable_objects)
      || live.durable_objects.namespace_id !== readNamespaceId(input.currentVersion, className))) throw invalid();
    const updateImage = className === "DeploySmokeRunnerContainer"
      || (!input.retainServingRunner && (className === activeClass || className === "SmallRunnerContainer"));
    return { rendered, className, name, live, updateImage };
  }));
  const serving = entries.find(entry => entry.className === activeClass);
  const smoke = entries.find(entry => entry.className === "DeploySmokeRunnerContainer");
  const small = entries.find(entry => entry.className === "SmallRunnerContainer");
  assertSmallRunnerDeploymentMode({ small, currentVersion: input.currentVersion,
    workerOnly: !!input.retainServingRunner, vars });
  if (!serving?.live || !smoke?.live || smoke.live.max_instances !== 1 || smoke.rendered.max_instances !== 1) throw invalid();
  const specification = runnerApplicationSpecification(serving.rendered, logsEnabled);
  const artifact = {
    releaseSha: input.releaseSha,
    bundleFingerprint: requiredString(vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT),
    sourceFingerprint: requiredString(vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT),
  };
  const { deployment, promoted } = prepareImageTransition({ active, liveDeployment,
    artifact, specification, liveConfiguration: serving.live.configuration,
    retainServingRunner: !!input.retainServingRunner });
  const retirements: StagedRunnerRelease["retirements"] = [];
  const effectiveContainers = entries.filter(entry => entry.live || entry.updateImage).map(entry => {
    if (entry.updateImage) return entry.rendered;
    if (!entry.live || !isObjectRecord(entry.live.configuration)) throw invalid();
    const retire = !input.retainServingRunner && entry.className === inactiveClass;
    if (retire && Number(entry.live.max_instances) > 0) retirements.push({
      applicationId: requiredString(entry.live.id), name: entry.name,
      namespaceId: readNamespaceId(input.currentVersion, entry.className),
    });
    const maxInstances = retire ? 0 : entry.live.max_instances;
    return retainNativeContainer(entry.rendered, entry.live, maxInstances);
  });
  const applications = [smoke, ...entries.filter(entry => entry.updateImage && entry !== smoke)].map(entry => ({
    applicationId: entry.live ? requiredString(entry.live.id) : null, className: entry.className, name: entry.name,
    namespaceId: readNamespaceId(input.currentVersion, entry.className),
    specification: runnerApplicationSpecification(entry.rendered, logsEnabled),
  }));
  readHostedRunnerDeployment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment) });
  const attempt = randomUUID();
  const configPath = path.join(path.dirname(input.configPath), `wrangler.stage-${attempt}.jsonc`);
  const promotionConfigPath = path.join(path.dirname(input.configPath), `wrangler.promote-${attempt}.jsonc`);
  const render = (release: HostedRunnerDeployment, staging = false) => `${JSON.stringify({
    ...config, containers: effectiveContainers, vars: { ...vars,
      ...(!input.retainServingRunner && staging && small ? { HOSTED_EXECUTION_SMALL_RUNNER_ENABLED: "false" } : {}),
      HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(release) },
  }, null, 2)}\n`;
  await writeFile(configPath, render(deployment, true), { encoding: "utf8", flag: "wx" });
  await writeFile(promotionConfigPath, render(promoted), { encoding: "utf8", flag: "wx" });
  return { activeApplicationName: serving.name, applications, retirements, configPath, deployment,
    promotionConfigPath, workerOnly: !!input.retainServingRunner };
}

function assertSmallRunnerDeploymentMode(input: {
  small: { className: string; live: Record<string, unknown> | undefined } | undefined;
  currentVersion: unknown;
  workerOnly: boolean;
  vars: Record<string, unknown>;
}): void {
  if (!input.small) return;
  if (!input.workerOnly) readNamespaceId(input.currentVersion, input.small.className);
  else if (!input.small.live && readSmallRunnerEnabled(input.vars)) {
    throw new Error("Enabling small runners requires a full container deployment.");
  }
}

/** Both bootstrap and retained releases use native resource ownership. */
function retainNativeContainer(rendered: Record<string, unknown>, live: Record<string, unknown>, maxInstances: unknown = live.max_instances): Record<string, unknown> {
  if (!isObjectRecord(live.configuration)) throw invalid();
  const resources = runnerApplicationResources(live.configuration);
  const { rollout_step_percentage: steps, constraints: _constraints, ...rest } = rendered;
  const constraints = isObjectRecord(live.constraints) ? live.constraints : {};
  return { ...rest, image: requiredString(live.configuration.image), max_instances: maxInstances,
    instance_type: { vcpu: resources.vcpu, memory_mib: resources.memoryMiB, disk_mb: resources.diskMB },
    rollout_active_grace_period: live.rollout_active_grace_period,
    ...(Array.isArray(constraints.regions) ? { constraints: { regions: constraints.regions } } : {}),
    ...(Number(maxInstances) > 0 && steps !== undefined ? { rollout_step_percentage: steps } : {}),
  };
}

function prepareImageTransition({ active, liveDeployment, artifact, specification, liveConfiguration, retainServingRunner }: {
  active: HostedRunnerRelease;
  liveDeployment: HostedRunnerDeployment | null;
  artifact: Pick<HostedRunnerRelease, "bundleFingerprint" | "sourceFingerprint"> & { releaseSha: string };
  specification: RunnerApplicationSpecification;
  liveConfiguration: unknown;
  retainServingRunner: boolean;
}): { deployment: HostedRunnerDeployment; promoted: HostedRunnerDeployment } {
  const sameImage = matchesRunnerArtifact(active, artifact)
    && isObjectRecord(liveConfiguration) && liveConfiguration.image === specification.configuration.image;
  const pending = liveDeployment?.candidate ?? null;
  if (!retainServingRunner && pending && (!matchesRunnerArtifact(pending, artifact)
    || pending.image !== specification.configuration.image
    || pending.executionIdentity !== runnerApplicationExecutionIdentity(specification))) throw pendingConflict();
  const candidate: HostedRunnerRelease | null = retainServingRunner ? pending : pending ?? (sameImage ? null : {
    ...active, ...artifact, image: specification.configuration.image,
    executionIdentity: runnerApplicationExecutionIdentity(specification),
  });
  const deployment: HostedRunnerDeployment = {
    active, candidate, previous: liveDeployment?.previous ?? null,
  };
  const promoted: HostedRunnerDeployment = retainServingRunner ? deployment : {
    active: candidate ?? { ...active, ...artifact, image: specification.configuration.image,
      executionIdentity: runnerApplicationExecutionIdentity(specification) },
    candidate: null, previous: deployment.previous,
  };
  return { deployment, promoted };
}

function readVersionBindings(version: unknown): unknown[] {
  if (!isObjectRecord(version) || !isObjectRecord(version.resources)
    || !Array.isArray(version.resources.bindings)) throw invalid();
  return version.resources.bindings;
}
function readNamespaceId(version: unknown, className: string): string {
  const matches = readVersionBindings(version).filter(binding => isObjectRecord(binding)
    && binding.type === "durable_object_namespace" && binding.class_name === className);
  if (matches.length !== 1 || !isObjectRecord(matches[0])) throw invalid();
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
function applicationName(config: Record<string, unknown>, container: Record<string, unknown>): string {
  return typeof container.name === "string" ? container.name : `${config.name}-${container.class_name}`.toLowerCase();
}
function readLogsEnabled(config: Record<string, unknown>): boolean {
  return isObjectRecord(config.observability) && (isObjectRecord(config.observability.logs)
    ? config.observability.logs.enabled === true : config.observability.enabled === true);
}
function matchesRunnerArtifact(release: HostedRunnerRelease, artifact: {
  releaseSha: string; bundleFingerprint: unknown; sourceFingerprint: unknown;
}): boolean {
  return release.releaseSha === artifact.releaseSha && release.bundleFingerprint === artifact.bundleFingerprint
    && release.sourceFingerprint === artifact.sourceFingerprint;
}
async function readNativeApplication(list: ListCloudflareContainerApplications, name: string): Promise<Record<string, unknown> | undefined> {
  const result = await list(name);
  if (!Array.isArray(result) || result.length > 1 || (result.length === 1 && !isObjectRecord(result[0]))) throw invalid();
  const app = result[0];
  if (app && app.name !== name) throw invalid();
  return app;
}
function pendingConflict(): Error {
  return new Error("A different candidate release is pending; reconcile it before preparing another image.");
}
function invalid(): Error {
  return new Error("Runner staging requires authoritative live configuration and native application identity.");
}
