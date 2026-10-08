import { readFile } from "node:fs/promises";

import { isObjectRecord } from "./deploy-automation/shared.ts";

const retiredSecrets = new Set(["VENICE_API_KEY", "VERCEL_AI_API_KEY"]);

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

export function hasRetiredInferenceSecrets(version: unknown, versionId: string): boolean {
  const inventory = readSecretInventory(version, versionId);
  return [...retiredSecrets].some(name => inventory.has(name));
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
