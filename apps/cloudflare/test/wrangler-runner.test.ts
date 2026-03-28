import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  runWranglerJson,
  runWranglerLogged,
} from "../scripts/wrangler-runner.js";

describe("wrangler runner helpers", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("runs logged wrangler commands with inherited stdio and optional env overrides", async () => {
    const child = createSpawnedChild();
    spawnMock.mockReturnValue(child);

    const command = runWranglerLogged(["deploy", "--name", "worker"], {
      cwd: "/tmp/cloudflare-app",
      envOverrides: {
        WRANGLER_OUTPUT_FILE_PATH: "/tmp/out.jsonl",
      },
    });

    child.emit("close", 0);
    await command;

    expect(spawnMock).toHaveBeenCalledWith("pnpm", ["exec", "wrangler", "deploy", "--name", "worker"], {
      cwd: "/tmp/cloudflare-app",
      env: expect.objectContaining({
        WRANGLER_OUTPUT_FILE_PATH: "/tmp/out.jsonl",
      }),
      stdio: "inherit",
    });
  });

  it("captures trimmed stdout for JSON wrangler commands", async () => {
    const child = createSpawnedChild();
    spawnMock.mockReturnValue(child);

    const command = runWranglerJson(["deployments", "status", "--json"], {
      cwd: "/tmp/cloudflare-app",
    });

    child.stdout.write("{\"ok\":true}\n");
    child.emit("close", 0);

    await expect(command).resolves.toBe("{\"ok\":true}");
    expect(spawnMock).toHaveBeenCalledWith("pnpm", ["exec", "wrangler", "deployments", "status", "--json"], {
      cwd: "/tmp/cloudflare-app",
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
  });

  it("appends stderr to JSON command failures but not logged command failures", async () => {
    const jsonChild = createSpawnedChild();
    spawnMock.mockReturnValueOnce(jsonChild);

    const jsonCommand = runWranglerJson(["containers", "images", "list", "--json"]);
    jsonChild.stderr.write("Request failed");
    jsonChild.emit("close", 1);

    await expect(jsonCommand).rejects.toThrow(
      "wrangler containers images list --json exited with code 1. Request failed",
    );

    const loggedChild = createSpawnedChild();
    spawnMock.mockReturnValueOnce(loggedChild);

    const loggedCommand = runWranglerLogged(["versions", "deploy"]);
    loggedChild.emit("close", 1);

    await expect(loggedCommand).rejects.toThrow("wrangler versions deploy exited with code 1.");
  });
});

function createSpawnedChild(): EventEmitter & {
  stderr: PassThrough;
  stdout: PassThrough;
} {
  const child = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    stdout: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}
