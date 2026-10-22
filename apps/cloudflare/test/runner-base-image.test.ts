import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hostedRunnerBaseImageBuildCacheTag,
  hostedRunnerBaseImageFingerprintTag,
  hostedRunnerBaseImageRemoteTag,
  hostedLocalRunnerBaseImageTag,
  runnerBaseImageSourceFingerprintLabel,
} from "../scripts/runner-base-image-contract.ts";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const dockerfileText = [
  "FROM node:24.22.1",
  "RUN codex app-server --help",
  "",
].join("\n");
const codexPatchText = "synthetic native compatibility patch\n";

describe("runner base image preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockImplementation(async (sourcePath, options) => {
      const encoding =
        typeof options === "string"
          ? options
          : typeof options === "object" && options !== null && "encoding" in options
            ? options.encoding
            : null;

      const content = String(sourcePath).endsWith("codex-public-live.patch")
        ? codexPatchText
        : dockerfileText;
      return encoding ? content : Buffer.from(content);
    });
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", 0, null));
      return child as ReturnType<typeof spawn>;
    });
  });

  it("invalidates a prepared image when only the native patch changes", async () => {
    const { computeRunnerBaseImageSourceFingerprint } = await import("../scripts/runner-base-image.ts");
    const before = await computeRunnerBaseImageSourceFingerprint();
    vi.mocked(readFile).mockImplementation(async (sourcePath) => Buffer.from(
      String(sourcePath).endsWith("codex-public-live.patch")
        ? `${codexPatchText}new shutdown fix\n`
        : dockerfileText,
    ));
    expect(await computeRunnerBaseImageSourceFingerprint()).not.toBe(before);
  });

  it("invalidates the final image when only the runtime Node pin changes", async () => {
    const { computeRunnerBaseImageSourceFingerprint } = await import("../scripts/runner-base-image.ts");
    const before = await computeRunnerBaseImageSourceFingerprint();
    vi.mocked(readFile).mockImplementation(async (sourcePath) => Buffer.from(
      String(sourcePath).endsWith("codex-public-live.patch")
        ? codexPatchText
        : dockerfileText.replace("24.22.1", "24.22.2"),
    ));
    expect(await computeRunnerBaseImageSourceFingerprint()).not.toBe(before);
  });

  it("keeps the native stage graph independent of runtime Node pins", async () => {
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const dockerfile = await fs.readFile(new URL("../../../Dockerfile.cloudflare-hosted-runner-base", import.meta.url), "utf8");
    const nativeStages = dockerfile.slice(dockerfile.indexOf("FROM "), dockerfile.indexOf(" AS typst-installer")).split("\nFROM node:")[0];
    expect(nativeStages).toContain(" AS codex-package");
    expect(nativeStages).toContain(" AS codex-builder");
    expect(nativeStages).not.toMatch(/NODE_VERSION|NODE_IMAGE_DIGEST|npm install/u);
    expect(nativeStages).toContain("ADD --checksum=sha256:30efc97738b975940d78b59a9bea115fa34040b732807d54ec35ae6b7528de94");
    expect(nativeStages).toContain("https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_CLI_VERSION}-linux-x64.tgz");
  });

  it("cannot reuse an image when the pinned native patch is missing", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    vi.mocked(readFile).mockImplementation(async (sourcePath) => {
      if (String(sourcePath).endsWith("codex-public-live.patch")) {
        throw new Error("native patch missing");
      }
      return Buffer.from(dockerfileText);
    });
    await expect(prepareRunnerBaseImage()).rejects.toThrow("native patch missing");
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("skips the Docker build when the prepared image fingerprint is current", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    const fingerprint = expectedFingerprint();
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: `${fingerprint}\n`,
    } as ReturnType<typeof spawnSync>);

    const result = await prepareRunnerBaseImage();

    expect(result).toEqual({
      fingerprint,
      imageTag: hostedLocalRunnerBaseImageTag,
      status: "current",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("builds and labels the Docker image when the prepared image is stale", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    const fingerprint = expectedFingerprint();
    mockDockerSyncResults([
      { status: 0, stdout: "old-fingerprint\n" },
      { status: 1, stderr: "manifest unknown\n" },
      { status: 1, stderr: "manifest unknown\n" },
    ]);

    const result = await prepareRunnerBaseImage();

    expect(result.status).toBe("built");
    const args = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(args).toEqual(expect.arrayContaining([
      "--cache-from", `type=registry,ref=${hostedRunnerBaseImageBuildCacheTag}`,
    ]));
    expect(args).not.toContain("--cache-to");
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "buildx",
        "build",
        "--load",
        "-t",
        hostedLocalRunnerBaseImageTag,
        "--build-arg",
        "CODEX_CARGO_JOBS",
        "--label",
        `${runnerBaseImageSourceFingerprintLabel}=${fingerprint}`,
        "--label",
        "org.opencontainers.image.source=https://github.com/cobuildwithus/murph",
      ]),
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("pulls and retags the fingerprinted GHCR image when it matches the source", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    const fingerprint = expectedFingerprint();
    mockDockerSyncResults([
      { status: 1, stderr: "No such image\n" },
      { status: 0 },
      { status: 0, stdout: `${fingerprint}\n` },
      { status: 0 },
      { status: 0, stdout: `${fingerprint}\n` },
    ]);

    const result = await prepareRunnerBaseImage();

    expect(result).toEqual({
      fingerprint,
      imageTag: hostedLocalRunnerBaseImageTag,
      status: "pulled",
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      ["pull", "--platform", "linux/amd64", hostedRunnerBaseImageFingerprintTag(fingerprint)],
      expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"] }),
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      ["tag", hostedRunnerBaseImageFingerprintTag(fingerprint), hostedLocalRunnerBaseImageTag],
      expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"] }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uses the stable GHCR tag directly without self-retagging when it matches the source", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    const fingerprint = expectedFingerprint();
    mockDockerSyncResults([
      { status: 1, stderr: "No such image\n" },
      { status: 1, stderr: "manifest unknown\n" },
      { status: 0 },
      { status: 0, stdout: `${fingerprint}\n` },
      { status: 0, stdout: `${fingerprint}\n` },
    ]);

    const result = await prepareRunnerBaseImage();

    expect(result).toEqual({
      fingerprint,
      imageTag: hostedLocalRunnerBaseImageTag,
      status: "pulled",
    });
    expect(hostedLocalRunnerBaseImageTag).toBe(hostedRunnerBaseImageRemoteTag);
    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      ["pull", "--platform", "linux/amd64", hostedRunnerBaseImageRemoteTag],
      expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"] }),
    );
    expect(spawnSync).not.toHaveBeenCalledWith(
      "docker",
      ["tag", hostedRunnerBaseImageRemoteTag, hostedLocalRunnerBaseImageTag],
      expect.anything(),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not retag a pulled GHCR image when the remote fingerprint is stale", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    const fingerprint = expectedFingerprint();
    mockDockerSyncResults([
      { status: 0, stdout: "old-fingerprint\n" },
      { status: 1, stderr: "manifest unknown\n" },
      { status: 0 },
      { status: 0, stdout: "old-fingerprint\n" },
      { status: 0 },
    ]);

    const result = await prepareRunnerBaseImage();

    expect(result.status).toBe("built");
    expect(spawnSync).not.toHaveBeenCalledWith(
      "docker",
      ["tag", hostedRunnerBaseImageRemoteTag, hostedLocalRunnerBaseImageTag],
      expect.anything(),
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("pushes stable and fingerprinted GHCR image tags when publishing", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    const fingerprint = expectedFingerprint();

    const result = await prepareRunnerBaseImage({ push: true });

    expect(result.status).toBe("pushed");
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "buildx",
        "build",
        "--push",
        "--cache-from", `type=registry,ref=${hostedRunnerBaseImageBuildCacheTag}`,
        "--cache-to", `type=registry,ref=${hostedRunnerBaseImageBuildCacheTag},mode=max`,
        "-t",
        hostedRunnerBaseImageRemoteTag,
        "-t",
        hostedRunnerBaseImageFingerprintTag(fingerprint),
      ]),
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("rebuilds the Docker image when forced even if the fingerprint matches", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");

    const result = await prepareRunnerBaseImage({ force: true });

    expect(result.status).toBe("built");
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(args).toContain("--cache-from");
    expect(args).not.toContain("--cache-to");
  });

  it("propagates source-build failure after a cache miss", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", 1, null));
      return child as ReturnType<typeof spawn>;
    });
    await expect(prepareRunnerBaseImage({ force: true })).rejects.toThrow("docker buildx build exited with code 1");
  });

  it.each([true, false])("native cache proof accepts only a cached Cargo vertex (cached=%s)", async (cached) => {
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const { spawnSync: actualSpawnSync } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "runner-native-cache-proof-"));
    try {
      await fs.writeFile(path.join(directory, "docker"), `#!/usr/bin/env node
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
assert.equal(args[args.indexOf("--target") + 1], "codex-builder");
assert.equal(args[args.indexOf("--output") + 1], "type=cacheonly");
assert(args.includes("NODE_VERSION=unused-native-cache-proof"));
assert(!args.includes("--cache-to"));
console.log("#19 [codex-builder 8/8] RUN git apply --check patch && cargo build --locked --release");
console.log("#19 ${cached ? "CACHED" : "DONE 2700.0s"}");
`, { mode: 0o755 });
      const result = actualSpawnSync("bash", ["apps/cloudflare/scripts/runner-base-image-cache-proof.sh"], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`, GITHUB_STEP_SUMMARY: "" },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(result.status).toBe(cached ? 0 : 1);
      expect(result.stdout + result.stderr).toContain(cached
        ? "Native Cargo layer reused with changed Node pins"
        : "Native Cargo build was not reused");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("publishes native source with the Dockerfile's two-job default", async () => {
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const { execFileSync } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const workflow = await fs.readFile(path.join(repoRoot, ".github/workflows/cloudflare-runner-base-image.yml"), "utf8");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("--driver docker-container --use");
    const step = workflow.split("      - name: Publish runner base image\n")[1]?.split(/\n      - /u)[0] ?? "";
    const run = step.match(/^        run: (.+)$/mu)?.[1];
    expect(run).toBeDefined();
    const env = { ...process.env };
    delete env.CODEX_CARGO_JOBS;
    for (const [, key, value] of step.matchAll(/^          (\w+): "?([^"\n]+)"?$/gmu)) {
      env[key] = value;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "runner-base-publisher-"));
    try {
      const trace = path.join(directory, "docker.jsonl");
      await fs.writeFile(path.join(directory, "docker"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MURPH_TEST_DOCKER_TRACE, JSON.stringify({
  args, jobs: process.env.CODEX_CARGO_JOBS ?? null,
}) + "\\n");
require("node:assert/strict").deepEqual(args.slice(0, 2), ["buildx", "build"]);
`, { mode: 0o755 });
      // Run the checked-in workflow command through the real package script and
      // helper CLI. Only Docker is replaced; no image is built or published.
      execFileSync("bash", ["--noprofile", "--norc", "-eu", "-c", run!], {
        cwd: repoRoot,
        env: { ...env, PATH: `${directory}${path.delimiter}${env.PATH ?? ""}`, MURPH_TEST_DOCKER_TRACE: trace },
        encoding: "utf8",
        timeout: 30_000,
      });
      const builds: Array<{ args: string[]; jobs: string | null }> =
        (await fs.readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(builds).toHaveLength(1);
      const [build] = builds;
      expect(build.args.slice(0, 3)).toEqual(["buildx", "build", "--push"]);
      expect(build.args[build.args.indexOf("--build-arg") + 1]).toBe("CODEX_CARGO_JOBS");
      const dockerfilePath = path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner-base");
      expect(build.args[build.args.indexOf("-f") + 1]).toBe(dockerfilePath);
      vi.mocked(readFile).mockImplementation(fs.readFile);
      const { computeRunnerBaseImageSourceFingerprint } = await import("../scripts/runner-base-image.ts");
      const fingerprint = await computeRunnerBaseImageSourceFingerprint();
      expect(build.args).toEqual(expect.arrayContaining([
        "--cache-from", `type=registry,ref=${hostedRunnerBaseImageBuildCacheTag}`,
        "--cache-to", `type=registry,ref=${hostedRunnerBaseImageBuildCacheTag},mode=max`,
        "--platform", "linux/amd64",
        "-t", hostedRunnerBaseImageRemoteTag,
        "-t", hostedRunnerBaseImageFingerprintTag(fingerprint),
        "--label", `${runnerBaseImageSourceFingerprintLabel}=${fingerprint}`,
      ]));
      const dockerfile = await fs.readFile(dockerfilePath, "utf8");
      const defaultJobs = dockerfile.match(/^ARG CODEX_CARGO_JOBS=(\d+)$/mu)?.[1];
      const cargoCommand = dockerfile.match(/^\s*&& (cargo build .+) \\$/mu)?.[1];
      expect(defaultJobs).toBeDefined();
      expect(cargoCommand).toBeDefined();
      // A bare Docker build arg inherits the child environment when set and
      // otherwise uses ARG's default. Execute the real Cargo command with a spy.
      const cargoArgs = execFileSync("bash", ["--noprofile", "--norc", "-eu", "-c",
        `cargo() { printf '%s\\n' "$@"; }\n${cargoCommand}`,
      ], {
        env: { PATH: env.PATH, CODEX_CARGO_JOBS: build.jobs ?? defaultJobs },
        encoding: "utf8",
        timeout: 10_000,
      }).trim().split("\n");
      expect(cargoArgs[cargoArgs.indexOf("--jobs") + 1]).toBe("2");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

function mockDockerSyncResults(results: Array<Partial<ReturnType<typeof spawnSync>>>): void {
  for (const result of results) {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: "",
      stderr: "",
      ...result,
    } as ReturnType<typeof spawnSync>);
  }
}

function expectedFingerprint(): string {
  return createHash("sha256")
    .update(`Dockerfile.cloudflare-hosted-runner-base\0${Buffer.byteLength(dockerfileText)}\0`)
    .update(Buffer.from(dockerfileText))
    .update(`patches/codex-public-live.patch\0${Buffer.byteLength(codexPatchText)}\0`)
    .update(Buffer.from(codexPatchText))
    .digest("hex");
}
