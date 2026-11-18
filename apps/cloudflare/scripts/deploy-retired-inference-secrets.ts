import { readFile } from "node:fs/promises";

import { isObjectRecord } from "./deploy-automation/shared.ts";

/**
 * Worker secrets each deploy removes from the uploaded version. Named for the
 * retired inference keys it first covered; any secret listed here is deleted
 * even though omitted optional secrets otherwise stay live.
 * HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID: operator pages run with the
 * primary chat only. To restore a second operator, drop it from this list, put
 * it back in HOSTED_WORKER_OPTIONAL_SECRET_NAMES, and set the secret.
 */
export const RETIRED_WORKER_SECRET_NAMES = [
  "BRAVE_API_KEY",
  "CLOUDFLARE_IMAGES_API_KEY",
  "EXA_API_KEY",
  "GARMIN_CLIENT_ID",
  "GARMIN_CLIENT_SECRET",
  "HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_KEY_ID",
  "HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_SECRET",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_SMALL_RUNNER_MEMBER_SHA256",
  "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "STRAVA_WEBHOOK_SIGNING_SECRET",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
  "VENICE_API_KEY",
  "VERCEL_AI_API_KEY",
] as const;
const retiredSecrets: ReadonlySet<string> = new Set(RETIRED_WORKER_SECRET_NAMES);

/** Omitted optional secrets remain live configuration; deletion is a native version patch. */
export async function readExpectedWorkerSecrets(input: {
  configPath: string;
  currentVersion: unknown;
  currentVersionId: string;
  secretsFilePath?: string;
}): Promise<Map<string, string>> {
  const expectedSecrets = readSecretInventory(input.currentVersion, input.currentVersionId);
  for (const name of retiredSecrets) expectedSecrets.delete(name);
  const config = await readJson(input.configPath);
  if (!isObjectRecord(config)) throw invalid();
  if (input.secretsFilePath) {
    const payload = await readJson(input.secretsFilePath);
    if (!isObjectRecord(payload)) throw invalid();
    for (const [name, value] of Object.entries(payload)) {
      if (!name.trim() || name !== name.trim() || retiredSecrets.has(name)
        || typeof value !== "string" || !value.trim()) throw invalid();
      expectedSecrets.set(name, "secret_text");
    }
  }
  if (config.secrets !== undefined) {
    if (!isObjectRecord(config.secrets) || !Array.isArray(config.secrets.required)
      || config.secrets.required.some(name => typeof name !== "string" || !expectedSecrets.has(name))) throw invalid();
  }
  return expectedSecrets;
}

/** A rollback must inherit opaque retained values from the version serving traffic.
 * Explicit synchronized values are already on the freshly uploaded version. */
export async function readRollbackSecretSources(currentVersion: unknown, currentVersionId: string, secretsFilePath: string) {
  const synced = await readJson(secretsFilePath);
  if (!isObjectRecord(synced)) throw invalid();
  return Object.fromEntries([...readSecretInventory(currentVersion, currentVersionId).keys()]
    .filter(name => !retiredSecrets.has(name) && !Object.hasOwn(synced, name))
    .map(name => [name, { type: "inherit" as const, version_id: currentVersionId }]));
}

export function hasRetiredInferenceSecrets(version: unknown, versionId: string): boolean {
  const inventory = readSecretInventory(version, versionId);
  return [...retiredSecrets].some(name => inventory.has(name));
}

export function assertRecoveryWorkerVersion(input: {
  currentVersion: unknown;
  currentVersionId: string;
  currentDeploymentCreatedOn: string;
  recoveryVersion: unknown;
  recoveryVersionId: string;
  recoveryVersionTag: string;
}): void {
  assertRecoveryWorkerInventory(input);
  assertNeverDeployedRecovery(input);
}

export function assertRecoveryWorkerInventory(input: { currentVersion: unknown; currentVersionId: string;
  recoveryVersion: unknown; recoveryVersionId: string; recoveryVersionTag: string }) {
  const current = readSecretInventory(input.currentVersion, input.currentVersionId);
  const recovery = readSecretInventory(input.recoveryVersion, input.recoveryVersionId);
  if (input.currentVersionId === input.recoveryVersionId || !input.recoveryVersionTag.trim()
    || !isObjectRecord(input.recoveryVersion) || !isObjectRecord(input.recoveryVersion.annotations)
    || input.recoveryVersion.annotations["workers/tag"] !== input.recoveryVersionTag) {
    throw new Error("Cannot safely recover Worker version: version identity or tag differs.");
  }
  if (current.size !== recovery.size || [...current].some(([name, type]) => recovery.get(name) !== type)) {
    throw new Error("Recovery Worker secret inventory differs from the current Worker secrets.");
  }
}

function assertNeverDeployedRecovery(input: { recoveryVersion: unknown; currentDeploymentCreatedOn: string }) {
  // A version newer than the latest deployment cannot have served traffic.
  // Merely being inactive also describes a previously activated rollback target.
  const createdOn = isObjectRecord(input.recoveryVersion) && isObjectRecord(input.recoveryVersion.metadata) ? input.recoveryVersion.metadata.created_on : undefined;
  const uploadedAt = typeof createdOn === "string" ? Date.parse(createdOn) : NaN;
  const deployedAt = Date.parse(input.currentDeploymentCreatedOn);
  if (!Number.isFinite(uploadedAt) || !Number.isFinite(deployedAt) || uploadedAt <= deployedAt) {
    throw new Error("Recovery Worker must have been uploaded after the current deployment; never-activated provenance is unproven.");
  }
}

export function assertRetiredInferenceSecretsRemoved(
  version: unknown,
  versionId: string,
  expectedSecrets: ReadonlyMap<string, string>,
): void {
  const actual = readSecretInventory(version, versionId);
  if (actual.size !== expectedSecrets.size
    || [...actual].some(([name, type]) => retiredSecrets.has(name) || expectedSecrets.get(name) !== type)) {
    throw new Error("Uploaded Worker secret inventory differs from the retained and synchronized secrets.");
  }
}

function readSecretInventory(version: unknown, versionId: string): Map<string, string> {
  if (!versionId.trim() || versionId !== versionId.trim() || !isObjectRecord(version) || version.id !== versionId
    || !isObjectRecord(version.resources) || !Array.isArray(version.resources.bindings)) throw invalid();
  const names = new Set<string>();
  const secrets = new Map<string, string>();
  for (const binding of version.resources.bindings) {
    if (!isObjectRecord(binding) || typeof binding.name !== "string"
      || !binding.name.trim() || binding.name !== binding.name.trim() || names.has(binding.name)
      || typeof binding.type !== "string" || !binding.type.trim() || binding.type !== binding.type.trim()) throw invalid();
    names.add(binding.name);
    if (binding.type === "secret_text" || binding.type === "secret_key") secrets.set(binding.name, binding.type);
    else if (retiredSecrets.has(binding.name)) throw invalid();
  }
  return secrets;
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  try { return JSON.parse(content); } catch { throw invalid(); }
}

function invalid(): Error {
  return new Error("Cannot safely retire inference secrets: invalid Worker binding inventory or upload configuration.");
}
