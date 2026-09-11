import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { prepareSmallRunnerNamespaceBootstrap } from "../scripts/stage-runner-release.ts";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const account = "0".repeat(32);
const versionId = "11111111-1111-4111-8111-111111111111";
const classes = ["RunnerContainer", "SmallRunnerContainer"];
const image = `registry.cloudflare.com/${account}/synthetic-runner:retained-release`;
const native = {
  id: "synthetic-application", name: "synthetic-worker-runnercontainer",
  durable_objects: { namespace_id: "ns-RunnerContainer" }, scheduling_policy: "default",
  configuration: { image, vcpu: 2, memory_mib: 6144, disk: { size_mb: 6000 },
    observability: { logs: { enabled: true } }, wrangler_ssh: { enabled: false },
    // A field outside the requested release identity can still trigger reconciliation.
    authorized_keys: ["synthetic-public-key"],
  },
  max_instances: 10, constraints: { tiers: [1, 2] }, rollout_active_grace_period: 300,
};

async function bootstrapConfig(directory: string): Promise<string> {
  const bindings = classes.map(class_name => ({ name: class_name.toUpperCase(), class_name }));
  const vars = { HOSTED_EXECUTION_SMALL_RUNNER_ENABLED: "true",
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "a".repeat(64),
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "b".repeat(64) };
  const configPath = path.join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "synthetic-worker", main: "worker.js", compatibility_date: "2026-01-01", account_id: account,
    workers_dev: false, preview_urls: false, observability: { logs: { enabled: true } }, vars,
    durable_objects: { bindings },
    migrations: [{ tag: "v8", new_sqlite_classes: ["RunnerContainer"] },
      { tag: "v9", new_sqlite_classes: ["SmallRunnerContainer"] }],
    containers: classes.map(class_name => ({ class_name, image,
      instance_type: { vcpu: 2, memory_mib: 6144, disk_mb: 6000 }, max_instances: 10,
      rollout_active_grace_period: 300, rollout_step_percentage: [100], ssh: { enabled: false } })),
  }));
  const output = await prepareSmallRunnerNamespaceBootstrap({ allowed: true, configPath,
    currentVersionId: versionId, listApplications: async () => [native],
    currentVersion: { resources: { bindings: [
      { type: "durable_object_namespace", ...bindings[0], namespace_id: "ns-RunnerContainer" },
      ...Object.entries(vars).map(([name, text]) => ({ type: "plain_text", name, text })),
    ] } },
  });
  if (!output) throw new Error("Synthetic bootstrap config was not produced");
  return output;
}

async function readUploadMetadata(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const form = await new Response(Buffer.concat(chunks), {
    headers: { "content-type": String(request.headers["content-type"]) },
  }).formData();
  const metadata = form.get("metadata");
  if (metadata === null) throw new Error("Worker upload omitted metadata");
  return JSON.parse(typeof metadata === "string" ? metadata : await metadata.text());
}

async function runWranglerBootstrap(skipContainers: boolean) {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-bootstrap-cli-"));
  const requests: string[] = [];
  let metadata: unknown;
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://localhost").pathname;
    const method = request.method;
    requests.push(`${method} ${route}`);
    let result: unknown;
    try {
      if (method === "PUT" && route.endsWith("/workers/scripts/synthetic-worker")) {
        metadata = await readUploadMetadata(request);
        result = { deployment_id: versionId, startup_time_ms: 0 };
      } else if (method === "GET" && route.endsWith("/workers/services/synthetic-worker")) {
        result = { default_environment: { environment: "production",
          script: { tag: "synthetic-tag", tags: [], last_deployed_from: "wrangler", migration_tag: "v8" } } };
      } else if (method === "GET" && route.endsWith("/deployments")) {
        result = { deployments: [{ id: "synthetic-deployment", versions: [{ version_id: versionId, percentage: 100 }] }] };
      } else if (method === "GET" && route.endsWith("/workers/scripts")) {
        result = [{ id: "synthetic-worker", migration_tag: "v8" }];
      } else if (method === "GET" && route.endsWith("/settings")) {
        result = { migration_tag: "v8", bindings: [] };
      } else if (method === "GET" && route.endsWith(`/versions/${versionId}`)) {
        result = { id: versionId, resources: { bindings: classes.map(class_name => ({
          type: "durable_object_namespace", class_name, namespace_id: `ns-${class_name}`,
        })) } };
      } else if (method === "GET" && route.endsWith("/containers/applications")) {
        result = [native];
      } else if ((method === "GET" || method === "POST") && route.endsWith("/subdomain")) {
        result = { enabled: false, previews_enabled: false };
      } else {
        throw new Error("Unexpected synthetic API operation");
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, errors: [], messages: [], result }));
    } catch {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Unexpected synthetic API operation" }] }));
    }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Synthetic API did not bind a TCP port");
    const configPath = await bootstrapConfig(directory);
    await writeFile(path.join(directory, "worker.js"),
      "export class RunnerContainer {}\nexport class SmallRunnerContainer {}\nexport default { fetch() { return new Response('synthetic'); } };\n");
    const packagePath = require.resolve("wrangler/package.json");
    const { bin } = JSON.parse(await readFile(packagePath, "utf8"));
    const command = execute(process.execPath, [path.resolve(path.dirname(packagePath), bin.wrangler),
      "deploy", "--config", configPath, ...(skipContainers ? ["--containers-rollout=none"] : [])], {
      cwd: directory, timeout: 30_000,
      env: { PATH: process.env.PATH, CI: "true", XDG_CONFIG_HOME: path.join(directory, "config"),
        CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: "synthetic-api-token",
        CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${address.port}/client/v4`,
        WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") },
    });
    const succeeded = await command.then(() => true, () => false);
    return { succeeded, requests, metadata };
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

describe("installed Wrangler namespace bootstrap", () => {
  it("uploads the new namespace with selection off and never enters the container API", async () => {
    const result = await runWranglerBootstrap(true);
    expect(result.succeeded).toBe(true);
    expect(result.metadata).toMatchObject({
      containers: [{ class_name: "RunnerContainer" }],
      migrations: { old_tag: "v8", new_tag: "v9", steps: [{ new_sqlite_classes: ["SmallRunnerContainer"] }] },
      bindings: expect.arrayContaining([
        { type: "durable_object_namespace", name: "SMALLRUNNERCONTAINER", class_name: "SmallRunnerContainer" },
        { type: "plain_text", name: "HOSTED_EXECUTION_SMALL_RUNNER_ENABLED", text: "false" },
      ]),
    });
    expect(result.requests.some(request => request.includes("/containers/"))).toBe(false);
  });

  it("shows why a normal deploy cannot promise to preserve every existing container setting", async () => {
    const result = await runWranglerBootstrap(false);
    expect(result.succeeded).toBe(false);
    expect(result.requests).toContain(`PATCH /client/v4/accounts/${account}/containers/applications/synthetic-application`);
  });
});
