import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  assertHostedR2Bucket,
  createWranglerR2BucketInfoReader,
} from "../scripts/r2-bucket.js";

const appDir = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

beforeEach(() => {
  spawnMock.mockReset();
});

describe("Wrangler R2 bucket metadata reader", () => {
  it("requires the configured bucket to match its expected location and use Standard", () => {
    expect(() => assertHostedR2Bucket({
      bucket: {
        defaultStorageClass: "Standard",
        location: "ENAM",
        name: "hosted-bundles",
      },
      bucketName: "hosted-bundles",
      label: "runtime",
      location: "ENAM",
    })).not.toThrow();
    expect(() => assertHostedR2Bucket({
      bucket: {
        defaultStorageClass: "Standard",
        location: "OC",
        name: "hosted-bundles-retiring",
      },
      bucketName: "hosted-bundles-retiring",
      label: "retiring runtime",
      location: "OC",
    })).not.toThrow();
    expect(() => assertHostedR2Bucket({
      bucket: {
        defaultStorageClass: "Standard",
        location: "OC",
        name: "hosted-bundles",
      },
      bucketName: "hosted-bundles",
      label: "runtime",
      location: "ENAM",
    })).toThrow("runtime bucket must report ENAM");
    expect(() => assertHostedR2Bucket({
      bucket: {
        defaultStorageClass: "InfrequentAccess",
        location: "ENAM",
        name: "hosted-bundles",
      },
      bucketName: "hosted-bundles",
      label: "runtime",
      location: "ENAM",
    })).toThrow("runtime bucket must use Standard");
  });

  it("uses the exact command and allowlisted deploy environment", async () => {
    const child = createSpawnedChild();
    spawnMock.mockReturnValue(child);
    const readBucketInfo = createWranglerR2BucketInfoReader({
      CLOUDFLARE_API_TOKEN: "cloudflare-token-fixture",
      DATABASE_URL: "must-not-reach-wrangler",
      PATH: "/fixture/bin",
      R2_MIGRATION_SECRET_ACCESS_KEY: "must-not-reach-wrangler",
    });

    const result = readBucketInfo("hosted-bundles");
    child.stdout.write(JSON.stringify({
      default_storage_class: "Standard",
      location: "OC",
      name: "hosted-bundles",
    }));
    child.emit("close", 0);

    await expect(result).resolves.toEqual({
      defaultStorageClass: "Standard",
      location: "OC",
      name: "hosted-bundles",
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "pnpm",
      [
        "exec",
        "wrangler",
        "r2",
        "bucket",
        "info",
        "hosted-bundles",
        "--json",
      ],
      {
        cwd: appDir,
        env: {
          CI: "1",
          CLOUDFLARE_API_TOKEN: "cloudflare-token-fixture",
          NO_COLOR: "1",
          PATH: "/fixture/bin",
          WRANGLER_HIDE_BANNER: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  });

  it("fails closed on invalid metadata and nonzero Wrangler exit", async () => {
    const invalidChild = createSpawnedChild();
    const failedChild = createSpawnedChild();
    spawnMock.mockReturnValueOnce(invalidChild).mockReturnValueOnce(failedChild);
    const readBucketInfo = createWranglerR2BucketInfoReader({});

    const invalidResult = readBucketInfo("hosted-bundles");
    invalidChild.stdout.write("not-json");
    invalidChild.emit("close", 0);
    await expect(invalidResult).rejects.toThrow(
      "Wrangler returned an invalid R2 bucket-info response.",
    );

    const failedResult = readBucketInfo("hosted-bundles");
    failedChild.stderr.write("private provider detail");
    failedChild.emit("close", 9);
    await expect(failedResult).rejects.toThrow(
      /^Hosted deploy R2 bucket-info check failed with exit code 9\.$/u,
    );
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
