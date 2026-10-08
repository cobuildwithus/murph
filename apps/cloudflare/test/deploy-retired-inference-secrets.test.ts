import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRetiredInferenceSecretsRemoved,
  prepareRetiredInferenceSecretsUpload,
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
    const result = await prepareRetiredInferenceSecretsUpload({
      ...input, currentVersion: baseline, currentVersionId: baseline.id,
      secretsFilePath: synchronize ? input.secretsFilePath : undefined,
    });
    const { unsafe, ...config } = JSON.parse(await readFile(result.configPath, "utf8"));
    expect(config).toEqual(input.config);
    expect(JSON.parse(await readFile(input.configPath, "utf8"))).toEqual(input.config);
    expect(path.dirname(result.configPath)).toBe(path.dirname(input.configPath));
    expect(unsafe).toEqual({
      bindings: retained.map(({ name }) => ({ name, type: "inherit", version_id: baseline.id })),
      metadata: { keep_bindings: [] },
    });
    const bindings = synchronize ? [...retained, { name: "NEW_SECRET", type: "secret_text" }] : retained;
    expect(() => assertRetiredInferenceSecretsRemoved({ id: "uploaded-version", resources: { bindings } }, "uploaded-version", result.expectedSecrets)).not.toThrow();
  });

  it("uses pinned Wrangler's actual upload serializer for inheritance and rotations", async () => {
    const input = await fixture();
    await writeFile(input.secretsFilePath, JSON.stringify({ OPENAI_API_KEY: "synthetic-rotation", NEW_SECRET: "synthetic-new" }));
    const result = await prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: baseline, currentVersionId: baseline.id });
    const outfile = path.join(path.dirname(input.configPath), "upload.multipart");
    await promisify(execFile)(process.execPath, [
      createRequire(import.meta.url).resolve("wrangler/bin/wrangler.js"),
      "versions", "upload", "--dry-run", "--config", result.configPath,
      "--secrets-file", input.secretsFilePath, "--outfile", outfile,
    ], {
      cwd: path.dirname(input.configPath),
      env: { PATH: process.env.PATH, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
    });
    const multipart = await readFile(outfile, "utf8");
    const boundary = multipart.slice(2, multipart.indexOf("\r\n"));
    const form = await new Response(multipart, { headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }).formData();
    const metadata = JSON.parse(String(form.get("metadata")));
    expect(metadata.keep_bindings).toEqual([]);
    expect(metadata.bindings).toEqual(expect.arrayContaining([
      { name: "OPENAI_API_KEY", type: "secret_text", text: "synthetic-rotation" },
      { name: "NEW_SECRET", type: "secret_text", text: "synthetic-new" },
      ...retained.filter(binding => binding.name !== "OPENAI_API_KEY").map(({ name }) => ({ name, type: "inherit", version_id: baseline.id })),
      { name: "SOURCE_RECEIPT", type: "plain_text", text: "synthetic-source" },
    ]));
    expect(metadata.bindings.some((binding: { name: string }) => retired.some(entry => entry.name === binding.name))).toBe(false);
    expect(metadata.containers).toEqual([{ class_name: "RunnerContainer" }]);
    expect(metadata.main_module).toBe("worker.js");
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
    await expect(prepareRetiredInferenceSecretsUpload({ ...input, currentVersion, currentVersionId: baseline.id })).rejects.toThrow("Cannot safely retire");
    expect((await readdir(path.dirname(input.configPath))).some(name => name.includes(".retired-secrets-"))).toBe(false);
  });

  it.each(["VENICE_API_KEY", "VERCEL_AI_API_KEY"])("rejects reintroducing %s in the synchronized payload", async name => {
    const input = await fixture();
    await writeFile(input.secretsFilePath, JSON.stringify({ [name]: "synthetic-retired" }));
    await expect(prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: baseline, currentVersionId: baseline.id })).rejects.toThrow("Cannot safely retire");
  });

  it.each(["null", "[]", '{"OPENAI_API_KEY":null}', '{"OPENAI_API_KEY":"synthetic-private-fragment"'])
    ("rejects malformed synchronized payloads without exposing their content %#", async content => {
      const input = await fixture();
      await writeFile(input.secretsFilePath, content);
      await expect(prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: baseline, currentVersionId: baseline.id }))
        .rejects.toThrow(/^Cannot safely retire inference secrets: invalid Worker binding inventory or upload configuration\.$/u);
    });

  it("rejects unexpected unsafe overrides instead of replacing configuration", async () => {
    const input = await fixture();
    await writeFile(input.configPath, JSON.stringify({ ...input.config, unsafe: { metadata: { keep_assets: true } } }));
    await expect(prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: baseline, currentVersionId: baseline.id })).rejects.toThrow("Cannot safely retire");
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
    const result = await prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: { ...baseline, resources: { bindings: retained } }, currentVersionId: baseline.id });
    expect([...result.expectedSecrets]).toEqual(retained.map(binding => [binding.name, binding.type]));
  });

  it("can prepare the same canonical artifact again after an interrupted attempt", async () => {
    const input = await fixture();
    const first = await prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: baseline, currentVersionId: baseline.id });
    const retry = await prepareRetiredInferenceSecretsUpload({ ...input, currentVersion: baseline, currentVersionId: baseline.id });
    expect(retry.configPath).not.toBe(first.configPath);
    expect(await readFile(retry.configPath, "utf8")).toBe(await readFile(first.configPath, "utf8"));
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
    send_email: [{ name: "EMAIL", allowed_sender_addresses: ["sender@example.com"] }],
  };
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(secretsFilePath, "{}");
  await writeFile(path.join(directory, "worker.js"), "export class RunnerContainer {}\nexport default { fetch() { return new Response('synthetic'); } };\n");
  return { config, configPath, secretsFilePath };
}
