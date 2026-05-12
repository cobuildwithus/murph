import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
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

const dockerfileText = "FROM node:24.14.1\nRUN codex app-server --help\n";

describe("runner base image preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue(Buffer.from(dockerfileText));
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
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: "old-fingerprint\n",
    } as ReturnType<typeof spawnSync>);

    const result = await prepareRunnerBaseImage();

    expect(result.status).toBe("built");
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "buildx",
        "build",
        "-t",
        hostedLocalRunnerBaseImageTag,
        "--label",
        `${runnerBaseImageSourceFingerprintLabel}=${fingerprint}`,
      ]),
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("rebuilds the Docker image when forced even if the fingerprint matches", async () => {
    const { prepareRunnerBaseImage } = await import("../scripts/runner-base-image.ts");
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: `${expectedFingerprint()}\n`,
    } as ReturnType<typeof spawnSync>);

    const result = await prepareRunnerBaseImage({ force: true });

    expect(result.status).toBe("built");
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

function expectedFingerprint(): string {
  return createHash("sha256")
    .update("Dockerfile.cloudflare-hosted-runner-base\0")
    .update(Buffer.from(dockerfileText))
    .digest("hex");
}
