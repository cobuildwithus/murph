import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
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
  "FROM node:24.14.1",
  "RUN codex app-server --help",
  "",
].join("\n");

describe("runner base image preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockImplementation(async (_path, options) => {
      const encoding =
        typeof options === "string"
          ? options
          : typeof options === "object" && options !== null && "encoding" in options
            ? options.encoding
            : null;

      return encoding ? dockerfileText : Buffer.from(dockerfileText);
    });
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", 0, null));
      return child as ReturnType<typeof spawn>;
    });
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
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "buildx",
        "build",
        "--load",
        "-t",
        hostedLocalRunnerBaseImageTag,
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
    .update("Dockerfile.cloudflare-hosted-runner-base\0")
    .update(Buffer.from(dockerfileText))
    .digest("hex");
}
