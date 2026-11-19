import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { modelAdmissionBinding, previousAdmissionDigest, productionAdmissionProof, retainedAdmissionVariables, stampAdmissionProof } from "../scripts/deploy-model-admission.ts";
import { measureModelRequestContract, modelRequestDigest } from "../src/deploy-model-request-contract.ts";
import { DEPLOY_MODEL_ADMISSION_PROBES, type DeployAdmissionTier } from "../src/deploy-smoke-live-model.ts";

const image = "data:image/png;base64,AA==";
const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const probe = { model: "gpt-6.2-sol", serviceTier: "default" as const };
function request(model: string, tier: DeployAdmissionTier, tool = "web") {
  return { model, service_tier: tier, input: [
    { type: "additional_tools", tools: [{ type: "namespace", name: tool, tools: [{ type: "function", name: "run", parameters: { type: "object" } }] }] },
    { type: "message", role: "user", content: [{ type: "input_image", image_url: image }, { type: "input_text", text: "synthetic" }] },
  ] };
}

describe("native admission contract", () => {
  it("normalizes ephemeral identities and preserves tools, images, tier settings and model flags", () => {
    const first = { ...request(probe.model, probe.serviceTier), client_metadata: { turn_id: id } };
    const hash = (value: unknown) => modelRequestDigest(JSON.stringify(value), probe);
    expect(hash(first)).toBe(hash({ ...first, client_metadata: { turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }));
    expect(hash({ ...first, parallel_tool_calls: false })).not.toBe(hash(first));
    expect(hash({ ...first, client_metadata: { turn_id: id, extra_setting: true } })).not.toBe(hash(first));
    expect(hash(JSON.parse(JSON.stringify(first).replace("AA==", "AQ==")))).not.toBe(hash(first));
    expect(() => hash(JSON.parse(JSON.stringify(first).replace('"run"', '"different"')))).toThrow();
    expect(() => hash({ ...first, service_tier: "flex" })).toThrow();
  });

  it("requires the native request from every probe before returning a digest", async () => {
    const capture = async (p: typeof DEPLOY_MODEL_ADMISSION_PROBES[number], url: string) => {
      const response = await fetch(url + "/responses", { method: "POST", body: JSON.stringify(request(p.model, p.serviceTier)) });
      expect(response.status).toBe(400);
    };
    expect(await measureModelRequestContract(capture)).toMatch(/^[a-f0-9]{64}$/u);
    await expect(measureModelRequestContract(async (p, url) => {
      if (p.model !== "gpt-6.2-astra") await capture(p, url);
    })).rejects.toThrow("Incomplete native admission");
  });
});

describe("protected full admission proof", () => {
  it("invalidates on a new UTC date, credential, workflow or transport change and refuses missing evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "admission-proof-"));
    try {
      const deployRoot = path.join(root, "apps/cloudflare");
      await mkdir(deployRoot, { recursive: true });
      const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
      git("init", "-q");
      const commit = () => {
        git("add", "Dockerfile.cloudflare-hosted-runner-base");
        return git("write-tree");
      };
      await writeFile(path.join(root, "Dockerfile.cloudflare-hosted-runner-base"), "FROM scratch\n");
      const secretsFile = path.join(root, "fixture.json");
      await writeFile(secretsFile, JSON.stringify({ OPENAI_API_KEY: "fixture-a" }));
      const input = { secretsFile, deployRoot, releaseSha: commit(), workflowSha: "a".repeat(40), day: "2030-01-01" };
      const prefix = await productionAdmissionProof(input);
      expect(prefix).toBeTruthy();
      const digest = "d".repeat(64);
      const config = path.join(root, "worker.json");
      await writeFile(config, '{"vars":{}}');
      await stampAdmissionProof(config, prefix + ":" + digest);
      const value = JSON.parse(await readFile(config, "utf8")).vars[modelAdmissionBinding];
      const version = { resources: { bindings: [{ name: modelAdmissionBinding, type: "plain_text", text: value }] } };
      expect(previousAdmissionDigest(version, prefix)).toBe(digest);
      const rendered = { ordinary: "retained", [modelAdmissionBinding]: "forged" };
      expect(retainedAdmissionVariables(rendered, {})).toEqual({ ordinary: "retained" });
      expect(retainedAdmissionVariables(rendered, version)).toEqual({ ordinary: "retained", [modelAdmissionBinding]: value });
      for (const changed of [{ day: "2030-01-02" }, { workflowSha: "b".repeat(40) }, { secretsFile: undefined }, { releaseSha: "absent" }]) {
        expect(previousAdmissionDigest(version, await productionAdmissionProof({ ...input, ...changed }))).toBeNull();
      }
      await writeFile(path.join(root, "Dockerfile.cloudflare-hosted-runner-base"), "FROM scratch AS changed\n");
      expect(previousAdmissionDigest(version, await productionAdmissionProof({ ...input, releaseSha: commit() }))).toBeNull();
      await writeFile(secretsFile, JSON.stringify({ OPENAI_API_KEY: "fixture-b" }));
      expect(previousAdmissionDigest(version, await productionAdmissionProof(input))).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
