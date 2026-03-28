import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedLifecycleWranglerArgs,
  createHostedLifecycleWranglerError,
  resolveHostedLifecycleBucketNames,
} from "../src/r2-lifecycle.js";

describe("r2 lifecycle helpers", () => {
  it("requires at least one configured bundles bucket", () => {
    expect(() => resolveHostedLifecycleBucketNames({})).toThrowError(
      "CF_BUNDLES_BUCKET or CF_BUNDLES_PREVIEW_BUCKET must be configured.",
    );
  });

  it("dedupes identical primary and preview buckets", () => {
    expect(resolveHostedLifecycleBucketNames({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles",
    })).toEqual(["hosted-bundles"]);
  });

  it("returns distinct primary and preview buckets in order", () => {
    expect(resolveHostedLifecycleBucketNames({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
    })).toEqual(["hosted-bundles", "hosted-bundles-preview"]);
  });

  it("builds the wrangler lifecycle command with the checked-in config path", () => {
    expect(buildHostedLifecycleWranglerArgs({
      bucketName: "hosted-bundles",
      lifecycleConfigPath: path.join("apps", "cloudflare", "r2-bundles-lifecycle.json"),
    })).toEqual([
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "lifecycle",
      "set",
      "hosted-bundles",
      "--file",
      path.join("apps", "cloudflare", "r2-bundles-lifecycle.json"),
    ]);
  });

  it("formats non-zero exit and signal failures", () => {
    expect(createHostedLifecycleWranglerError({
      code: 1,
      signal: null,
    }).message).toBe("wrangler exited with code 1.");
    expect(createHostedLifecycleWranglerError({
      code: null,
      signal: "SIGTERM",
    }).message).toBe("wrangler exited from signal SIGTERM.");
  });
});
