import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readHostedRunnerDeployment,
  type HostedRunnerDeployment,
  type HostedRunnerRelease,
} from "../src/hosted-runner-release.ts";
import { isObjectRecord } from "./deploy-automation/shared.ts";
import type { ListCloudflareContainerApplications } from "./container-release-receipt.ts";

export interface StagedRunnerRelease {
  activeApplicationName: string;
  candidateApplicationId: string | null;
  configPath: string;
  deployment: HostedRunnerDeployment;
  mustDrainCandidate: boolean;
  promotionConfigPath: string;
}

/** Derive the inactive target from the live version, never from local release history. */
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
    bank: "primary",
    id: input.currentVersionId,
    bundleFingerprint: requiredString(liveVars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT),
    sourceFingerprint: requiredString(liveVars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT),
  };
  const bank = active.bank === "primary" ? "next" : "primary";
  const candidate: HostedRunnerRelease = {
    bank,
    id: `${bank}-${randomUUID()}`,
    bundleFingerprint: requiredString(config.vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT),
    sourceFingerprint: requiredString(config.vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT),
  };
  const deployment: HostedRunnerDeployment = { active, candidate, previous: null };
  const activeClassName = active.bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
  const candidateClassName = bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
  let activeApplicationName = "";
  let candidateApplicationId: string | null = null;
  const containers = await Promise.all(config.containers.map(async (value: unknown) => {
    if (!isObjectRecord(value)) throw invalid();
    const className = requiredString(value.class_name);
    const name = typeof value.name === "string" ? value.name
      : `${config.name}-${className}`.toLowerCase();
    if (className === "DeploySmokeRunnerContainer") return value;
    const result = await input.listApplications(name);
    if (!Array.isArray(result) || result.length > 1) throw invalid();
    const live = result[0];
    if (className === candidateClassName) {
      if (live !== undefined) {
        if (!isObjectRecord(live) || live.name !== name) throw invalid();
        candidateApplicationId = requiredString(live.id);
      }
      return value;
    }
    if (!isObjectRecord(live) || live.name !== name || !isObjectRecord(live.configuration)) {
      throw invalid();
    }
    if (className === activeClassName) activeApplicationName = name;
    // Wrangler's per-application rollout control leaves this image and every
    // running instance untouched, including when the next release changes sizing.
    return {
      ...value,
      image: requiredString(live.configuration.image),
      max_instances: live.max_instances,
      rollout_kind: "none",
    };
  }));
  if (!activeApplicationName || !containers.some((item) => item.class_name === candidateClassName)) {
    throw invalid();
  }
  // Validate the same contract the live runtime will read before any activation.
  readHostedRunnerDeployment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment) });
  const configPath = path.join(path.dirname(input.configPath), `wrangler.stage-${candidate.id}.jsonc`);
  const promotionConfigPath = path.join(path.dirname(input.configPath), `wrangler.promote-${candidate.id}.jsonc`);
  const render = (release: HostedRunnerDeployment, promote = false) => `${JSON.stringify({
    ...config,
    containers: promote ? containers.map((container) => ({ ...container, rollout_kind: "none" })) : containers,
    vars: { ...vars, HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(release) },
  }, null, 2)}\n`;
  await writeFile(configPath, render(deployment), { encoding: "utf8", flag: "wx" });
  await writeFile(promotionConfigPath, render({ active: candidate, candidate: null, previous: active }, true), {
    encoding: "utf8", flag: "wx",
  });
  return {
    activeApplicationName,
    candidateApplicationId,
    configPath,
    deployment,
    mustDrainCandidate: liveDeployment?.previous?.bank === bank,
    promotionConfigPath,
  };
}

function readReleaseVariables(version: unknown): Record<string, string> {
  if (!isObjectRecord(version) || !isObjectRecord(version.resources)
    || !Array.isArray(version.resources.bindings)) throw invalid();
  const names = new Set([
    "HOSTED_EXECUTION_RUNNER_DEPLOYMENT",
    "HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT",
    "HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT",
  ]);
  const result: Record<string, string> = {};
  for (const binding of version.resources.bindings) {
    if (!isObjectRecord(binding) || typeof binding.name !== "string" || !names.has(binding.name)) continue;
    if (binding.type !== "plain_text" || typeof binding.text !== "string" || binding.name in result) {
      throw invalid();
    }
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
