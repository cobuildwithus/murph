import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseJsoncObject } from "./helpers/jsonc.js";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const account = "0".repeat(32);
const versionId = "11111111-1111-4111-8111-111111111111";
const classes = ["RunnerContainer", "SmallRunnerContainer"];
const image = `registry.cloudflare.com/${account}/synthetic-runner:retained-release`;
async function retainedConfig(directory: string): Promise<string> {
  const scaffold = parseJsoncObject(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const configPath = path.join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "synthetic-worker", main: "worker.js", compatibility_date: "2026-01-01", account_id: account,
    workers_dev: false, preview_urls: false,
    durable_objects: { bindings: classes.map(class_name => ({ name: class_name, class_name })) },
    migrations: scaffold.migrations,
    containers: classes.map(class_name => ({ class_name, image,
      instance_type: { vcpu: 2, memory_mib: 6144, disk_mb: 6000 }, max_instances: 10,
      rollout_active_grace_period: 300, rollout_step_percentage: [100], ssh: { enabled: false } })),
  }));
  return configPath;
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

async function runWranglerUpload() {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-retirement-cli-"));
  const requests: string[] = [];
  let metadata: unknown;
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://localhost").pathname;
    const method = request.method;
    requests.push(`${method} ${route}`);
    let result: unknown;
    try {
      if (method === "POST" && route.endsWith("/workers/scripts/synthetic-worker/versions")) {
        metadata = await readUploadMetadata(request);
        result = { id: versionId, metadata: { created_on: "2026-01-01T00:00:00Z" }, resources: {} };
      } else if (method === "GET" && route.endsWith("/workers/services/synthetic-worker")) {
        result = { default_environment: { environment: "production",
          script: { tag: "synthetic-tag", tags: [], last_deployed_from: "wrangler", migration_tag: "v10" } } };
      } else if (method === "GET" && route.endsWith("/deployments")) {
        result = { deployments: [{ id: "synthetic-deployment", versions: [{ version_id: versionId, percentage: 100 }] }] };
      } else if (method === "GET" && route.endsWith("/workers/scripts")) {
        result = [{ id: "synthetic-worker", migration_tag: "v10" }];
      } else if (method === "GET" && route.endsWith("/settings")) {
        result = { migration_tag: "v10", bindings: [] };
      } else if (method === "GET" && route.endsWith(`/versions/${versionId}`)) {
        result = { id: versionId, resources: { bindings: classes.map(class_name => ({
          type: "durable_object_namespace", class_name, namespace_id: `ns-${class_name}`,
        })) } };

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
    const configPath = await retainedConfig(directory);
    await writeFile(path.join(directory, "worker.js"),
      "export class RunnerContainer {}\nexport class SmallRunnerContainer {}\nexport default { fetch() { return new Response('synthetic'); } };\n");
    const packagePath = require.resolve("wrangler/package.json");
    const { bin } = JSON.parse(await readFile(packagePath, "utf8"));
    const command = execute(process.execPath, [path.resolve(path.dirname(packagePath), bin.wrangler),
      "versions", "upload", "--config", configPath], {
      cwd: directory, timeout: 30_000,
      env: { PATH: process.env.PATH, CI: "true", XDG_CONFIG_HOME: path.join(directory, "config"),
        CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: "synthetic-api-token",
        CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${address.port}/client/v4`,
        WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
    });
    const succeeded = await command.then(() => true, () => false);
    return { succeeded, requests, metadata };
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

describe("installed Wrangler after namespace retirement", () => {
  it("uploads an ordinary version after deletion without another migration or container reconciliation", async () => {
    const result = await runWranglerUpload();
    expect(result.succeeded).toBe(true);
    expect(result.metadata).toMatchObject({
      containers: classes.map(class_name => ({ class_name })),
      bindings: expect.arrayContaining([
        { type: "durable_object_namespace", name: "SmallRunnerContainer", class_name: "SmallRunnerContainer" },
      ]),
    });
    expect(result.metadata).not.toHaveProperty("migrations");
    expect(result.requests.some(request => request.includes("/containers/"))).toBe(false);
    expect(result.requests.filter(request => request.startsWith("POST "))).toEqual([
      `POST /client/v4/accounts/${account}/workers/scripts/synthetic-worker/versions`,
    ]);
  });
});
