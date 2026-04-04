import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedLifecycleWranglerArgs,
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
  it("covers encrypted transient dispatch payloads, journals, and raw email artifacts", () => {
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

    expect(maxAgeByPrefix.get("transient/execution-journal/")).toBe(604800);
    expect(maxAgeByPrefix.get("transient/side-effects/")).toBe(604800);
    expect(maxAgeByPrefix.get("transient/dispatch-payloads/")).toBe(604800);
    expect(maxAgeByPrefix.get("transient/hosted-email/messages/")).toBe(604800);
    expect(maxAgeByPrefix.get("transient/hosted-email/threads/")).toBe(604800);
  });
});
