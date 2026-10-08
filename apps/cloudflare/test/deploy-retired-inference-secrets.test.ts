import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRetiredInferenceSecretsRemoved,
  hasRetiredInferenceSecrets,
  readExpectedWorkerSecrets,
} from "../scripts/deploy-retired-inference-secrets.ts";

const directories: string[] = [];
const retained = [
  { name: "OPENAI_API_KEY", type: "secret_text" },
  { name: "OPTIONAL_UNDECLARED_SECRET", type: "secret_text" },
  { name: "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET", type: "secret_text" },
  { name: "CRYPTO_KEY", type: "secret_key" },
];
const retired = ["VENICE_API_KEY", "VERCEL_AI_API_KEY"].map(name => ({ name, type: "secret_text" }));
const baseline = { id: "baseline-version", resources: { bindings: [...retained, ...retired] } };

afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe("retired inference secret upload", () => {
  it.each([false, true])("preserves canonical config and every retained secret with synchronization=%s", async synchronize => {
    const input = await fixture();
    const payload = { OPENAI_API_KEY: "synthetic-rotation", NEW_SECRET: "synthetic-new" };
    await writeFile(input.secretsFilePath, JSON.stringify(payload));
    const result = await readExpectedWorkerSecrets({
      ...input, currentVersion: baseline, currentVersionId: baseline.id,
      secretsFilePath: synchronize ? input.secretsFilePath : undefined,
    });
    expect(JSON.parse(await readFile(input.configPath, "utf8"))).toEqual(input.config);
    const bindings = synchronize ? [...retained, { name: "NEW_SECRET", type: "secret_text" }] : retained;
    expect(() => assertRetiredInferenceSecretsRemoved({ id: "uploaded-version", resources: { bindings } }, "uploaded-version", result)).not.toThrow();
  });

  it.each(["disabled", "empty", "partial", "full"] as const)("uses pinned Wrangler's actual upload serializer with required secrets and %s synchronization", async mode => {
    const input = await fixture();
    const payload: Record<string, string> = mode === "disabled" || mode === "empty" ? {} : {
      OPENAI_API_KEY: "synthetic-rotation", NEW_SECRET: "synthetic-new",
      ...(mode === "full" ? { HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET: "synthetic-signing-rotation" } : {}),
    };
    if (mode === "full") input.config.secrets.required.push("NEW_SECRET");
    await writeFile(input.configPath, JSON.stringify(input.config));
    await writeFile(input.secretsFilePath, JSON.stringify(payload));
    const secretsFilePath = mode === "disabled" ? undefined : input.secretsFilePath;
    await readExpectedWorkerSecrets({ ...input, secretsFilePath, currentVersion: baseline, currentVersionId: baseline.id });
    const outfile = path.join(path.dirname(input.configPath), "upload.multipart");
    await promisify(execFile)(process.execPath, [
      createRequire(import.meta.url).resolve("wrangler/bin/wrangler.js"),
      "versions", "upload", "--dry-run", "--config", input.configPath,
      ...(secretsFilePath ? ["--secrets-file", secretsFilePath] : []), "--outfile", outfile,
    ], {
      cwd: path.dirname(input.configPath),
      env: { PATH: process.env.PATH, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
    });
    const multipart = await readFile(outfile, "utf8");
    const boundary = multipart.slice(2, multipart.indexOf("\r\n"));
    const form = await new Response(multipart, { headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }).formData();
    const metadata = JSON.parse(String(form.get("metadata")));
    expect(metadata.keep_bindings).toEqual(["secret_text", "secret_key"]);
    expect(metadata.bindings.every((binding: object) => !("version_id" in binding))).toBe(true);
    expect(metadata.bindings).toEqual(expect.arrayContaining([
      ...Object.entries(payload).map(([name, text]) => ({ name, type: "secret_text", text })),
      ...input.config.secrets.required.filter(name => !(name in payload)).map(name => ({ name, type: "inherit" })),
      { name: "SOURCE_RECEIPT", type: "plain_text", text: "synthetic-source" },
    ]));
    expect(metadata.bindings.some((binding: { name: string }) => retired.some(entry => entry.name === binding.name))).toBe(false);
    expect(metadata.containers).toEqual([{ class_name: "RunnerContainer" }]);
    expect(metadata.main_module).toBe("worker.js");
    expect(JSON.parse(await readFile(input.configPath, "utf8"))).toEqual(input.config);
  });

  it.each([
    undefined,
    { id: baseline.id, resources: {} },
    { ...baseline, id: "different-version" },
    { id: baseline.id, resources: { bindings: [null] } },
    { id: baseline.id, resources: { bindings: [{ name: "BAD", type: 1 }] } },
    { id: baseline.id, resources: { bindings: [{ name: "BAD", type: "secret_text " }] } },
    { id: baseline.id, resources: { bindings: [{ name: " ", type: "secret_text" }] } },
    { id: baseline.id, resources: { bindings: [retained[0], retained[0]] } },
  ])("rejects malformed or mismatched baseline metadata %#", async currentVersion => {
    const input = await fixture();
    await expect(readExpectedWorkerSecrets({ ...input, currentVersion, currentVersionId: baseline.id })).rejects.toThrow("Cannot safely retire");
  });

  it.each(["VENICE_API_KEY", "VERCEL_AI_API_KEY"])("rejects reintroducing %s in the synchronized payload", async name => {
    const input = await fixture();
    await writeFile(input.secretsFilePath, JSON.stringify({ [name]: "synthetic-retired" }));
    await expect(readExpectedWorkerSecrets({ ...input, currentVersion: baseline, currentVersionId: baseline.id })).rejects.toThrow("Cannot safely retire");
  });

  it.each(["null", "[]", '{"OPENAI_API_KEY":null}', '{"OPENAI_API_KEY":"synthetic-private-fragment"'])
    ("rejects malformed synchronized payloads without exposing their content %#", async content => {
      const input = await fixture();
      await writeFile(input.secretsFilePath, content);
      await expect(readExpectedWorkerSecrets({ ...input, currentVersion: baseline, currentVersionId: baseline.id }))
        .rejects.toThrow(/^Cannot safely retire inference secrets: invalid Worker binding inventory or upload configuration\.$/u);
    });

  it.each(["MISSING_REQUIRED_SECRET", "VENICE_API_KEY", "VERCEL_AI_API_KEY"])("rejects required %s before publishing a config that requires an absent or retired secret", async name => {
    const input = await fixture();
    input.config.secrets.required.push(name);
    await writeFile(input.configPath, JSON.stringify(input.config));
    await expect(readExpectedWorkerSecrets({ ...input, currentVersion: baseline, currentVersionId: baseline.id })).rejects.toThrow("Cannot safely retire");
  });

  it.each([
    [...retained, ...retired],
    retained.slice(1),
    [...retained, { name: "UNEXPECTED_SECRET", type: "secret_text" }],
    retained.map(binding => ({ ...binding, type: "plain_text" })),
  ].map(bindings => ({ bindings })))("rejects uploaded secret loss, reintroduction, or drift %#", ({ bindings }) => {
    expect(() => assertRetiredInferenceSecretsRemoved({ id: "uploaded-version", resources: { bindings } }, "uploaded-version", new Map(retained.map(binding => [binding.name, binding.type])))).toThrow("inventory differs");
  });

  it("accepts an already-clean baseline without inventing missing retired keys", async () => {
    const input = await fixture();
    const result = await readExpectedWorkerSecrets({ ...input, currentVersion: { ...baseline, resources: { bindings: retained } }, currentVersionId: baseline.id });
    expect([...result]).toEqual(retained.map(binding => [binding.name, binding.type]));
  });

  it("identifies retired bindings without treating retained optional or crypto secrets as retired", () => {
    expect(hasRetiredInferenceSecrets(baseline, baseline.id)).toBe(true);
    expect(hasRetiredInferenceSecrets({ ...baseline, resources: { bindings: retained } }, baseline.id)).toBe(false);
  });
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-retired-secrets-"));
  directories.push(directory);
  const configPath = path.join(directory, "wrangler.jsonc");
  const secretsFilePath = path.join(directory, "secrets.json");
  const config = {
    name: "synthetic-worker", main: "worker.js", compatibility_date: "2026-05-18",
    containers: [{ class_name: "RunnerContainer", image: "docker.io/library/alpine:3.23", max_instances: 1 }],
    durable_objects: { bindings: [{ name: "RUNNER", class_name: "RunnerContainer" }] },
    vars: { SOURCE_RECEIPT: "synthetic-source" },
    secrets: { required: ["OPENAI_API_KEY", "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET"] },
    send_email: [{ name: "EMAIL", allowed_sender_addresses: ["sender@example.com"] }],
  };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(secretsFilePath, "{}");
  await writeFile(path.join(directory, "worker.js"), "export class RunnerContainer {}\nexport default { fetch() { return new Response('synthetic'); } };\n");
  return { config, configPath, secretsFilePath };
}
