import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const wranglerPackagePath = createRequire(import.meta.url).resolve("wrangler/package.json");
const wranglerCli = path.join(path.dirname(wranglerPackagePath), "bin/wrangler.js");

it.each([
  ["namespace bootstrap", ["deploy", "--containers-rollout=none"]],
  ["staged version upload", ["versions", "upload"]],
])("the pinned CLI prepares %s without Docker or credentials", async (_name, command) => {
  const root = await mkdtemp(path.join(tmpdir(), "wrangler-bootstrap-"));
  try {
    const appPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const cliPackage = JSON.parse(await readFile(wranglerPackagePath, "utf8"));
    expect(cliPackage.version).toBe(appPackage.devDependencies.wrangler);
    await writeFile(path.join(root, "worker.js"), [
      "export class BootstrapContainer {}",
      "export default { fetch() { return new Response('synthetic'); } };",
    ].join("\n"));
    await writeFile(path.join(root, "Dockerfile"), "FROM scratch\n");
    const configPath = path.join(root, "wrangler.json");
    await writeFile(configPath, JSON.stringify({
      name: "synthetic-bootstrap",
      main: "worker.js",
      compatibility_date: "2026-03-27",
      durable_objects: { bindings: [{ name: "BOOTSTRAP", class_name: "BootstrapContainer" }] },
      migrations: [{ tag: "v1", new_sqlite_classes: ["BootstrapContainer"] }],
      containers: [{ class_name: "BootstrapContainer", image: "./Dockerfile", max_instances: 1 }],
    }));

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      wranglerCli, ...command, "--dry-run", "--config", configPath,
    ], {
      cwd: root,
      env: {
        CI: "true",
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: root,
        PATH: process.env.PATH,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: path.join(root, "wrangler.log"),
        WRANGLER_DOCKER_BIN: path.join(root, "docker-unavailable"),
      },
      timeout: 30_000,
    });
    expect(stdout).toContain("--dry-run: exiting now.");
    expect(stdout).toContain("BootstrapContainer");
    expect(stderr).not.toContain("ERROR");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
