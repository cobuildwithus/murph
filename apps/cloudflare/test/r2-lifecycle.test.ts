import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedLifecycleWranglerArgs,
  resolveHostedLifecycleBucketNames,
} from "../scripts/r2-lifecycle.js";

describe("r2 lifecycle helpers", () => {
  it("requires at least one configured bundles bucket", () => {
    expect(() => resolveHostedLifecycleBucketNames({})).toThrowError(
      "CF_BUNDLES_BUCKET or CF_BUNDLES_PREVIEW_BUCKET must be configured to apply execution-transient lifecycle rules.",
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
      "r2",
      "bucket",
      "lifecycle",
      "set",
      "hosted-bundles",
      "--file",
      path.join("apps", "cloudflare", "r2-bundles-lifecycle.json"),
    ]);
  });
});

describe("R2 transient lifecycle rules", () => {
  it("adds only the hosted-email raw-message recovery backstop", () => {
    const config = JSON.parse(
      readFileSync(new URL("../r2-bundles-lifecycle.json", import.meta.url), "utf8"),
    ) as {
      rules: Array<{
        conditions: {
          prefix: string;
        };
        deleteObjectsTransition: {
          condition: {
            maxAge: number;
          };
        };
      }>;
    };
    const maxAgeByPrefix = new Map(
      config.rules.map((rule) => [
        rule.conditions.prefix,
        rule.deleteObjectsTransition.condition.maxAge,
      ]),
    );

    expect(config.rules).toHaveLength(1);
    expect(maxAgeByPrefix.get("hosted-email/messages/")).toBe(86_400);
    expect(maxAgeByPrefix.has("transient/hosted-email/threads/")).toBe(false);
    expect(maxAgeByPrefix.has("transient/execution-journal/")).toBe(false);
    expect(maxAgeByPrefix.has("transient/side-effects/")).toBe(false);
  });
});
