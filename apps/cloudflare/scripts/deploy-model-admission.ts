import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isObjectRecord } from "./deploy-automation/shared.ts";

const git = promisify(execFile);
export const modelAdmissionBinding = "HOSTED_DEPLOY_MODEL_ADMISSION_PROOF";

// The candidate separately fingerprints every serialized native request (including
// all tools and input modalities). These owners also invalidate on image, model
// routing and Worker transport changes outside the local serializer.
const contractPaths = [
  "Dockerfile.cloudflare-hosted-runner", "Dockerfile.cloudflare-hosted-runner-base", "patches",
  "apps/cloudflare/codex-model-catalog.6.2.json", "apps/cloudflare/src/runner-egress-intercept.ts",
  "apps/cloudflare/src/runner-egress-openai-image-request.ts", "apps/cloudflare/src/deploy-model-request-contract.ts",
  "apps/cloudflare/src/deploy-smoke-live-model.ts", "apps/cloudflare/scripts/deploy-model-admission.ts",
  "packages/hosted-execution/src/assistant-model.ts", "packages/assistant-engine/src/assistant-codex/config.ts",
];

export async function productionAdmissionProof(input: {
  deployRoot: string; releaseSha: string; workflowSha?: string; secretsFile?: string; day: string;
}): Promise<string | null> {
  if (!input.secretsFile || !/^[a-f0-9]{40}$/.test(input.workflowSha ?? "")) return null;
  try {
    const { stdout } = await git("git", ["-C", path.resolve(input.deployRoot, "../.."), "ls-tree", "-rz", "--full-tree",
      input.releaseSha, "--", ...contractPaths], { maxBuffer: 8 * 1024 * 1024 });
    const secrets: unknown = JSON.parse(await readFile(input.secretsFile, "utf8"));
    if (!stdout || !isObjectRecord(secrets) || typeof secrets.OPENAI_API_KEY !== "string" || !secrets.OPENAI_API_KEY.trim()) return null;
    // A rotated key can belong to another project with different model entitlements.
    const signature = createHmac("sha256", secrets.OPENAI_API_KEY)
      .update(JSON.stringify([input.day, input.workflowSha, stdout])).digest("hex");
    return `${input.day}:${signature}`;
  } catch {
    // Missing provenance is a full live check, never an implicit cache hit.
    return null;
  }
}

function readLiveProof(liveVersion: unknown): string | null {
  if (!isObjectRecord(liveVersion) || !isObjectRecord(liveVersion.resources)
    || !Array.isArray(liveVersion.resources.bindings)) return null;
  const bindings = liveVersion.resources.bindings.filter(binding => isObjectRecord(binding) && binding.name === modelAdmissionBinding);
  const value = bindings.length === 1 && bindings[0].type === "plain_text" ? bindings[0].text : null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}:[a-f0-9]{64}:[a-f0-9]{64}$/u.test(value) ? value : null;
}

export function retainedAdmissionVariables(vars: Record<string, unknown>, currentVersion: unknown): Record<string, unknown> {
  const { [modelAdmissionBinding]: _rendered, ...rest } = vars;
  const live = readLiveProof(currentVersion);
  return live ? { ...rest, [modelAdmissionBinding]: live } : rest;
}

export function previousAdmissionDigest(liveVersion: unknown, proof: string | null): string | null {
  const value = readLiveProof(liveVersion);
  if (!proof || !value?.startsWith(proof + ":")) return null;
  return value.slice(proof.length + 1);
}

/** Only a successfully admitted production candidate reaches the promotion upload. */
export async function stampAdmissionProof(configPath: string, proof: string): Promise<void> {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.vars[modelAdmissionBinding] = proof;
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
