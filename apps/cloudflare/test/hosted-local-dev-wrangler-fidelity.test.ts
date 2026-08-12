import { readFile } from "node:fs/promises";

import { buildWranglerLocalDevConfig } from "@murphai/hosted-local-harness/dev-hosted-local/environment";
import { describe, expect, it } from "vitest";

import { parseJsoncObject } from "./helpers/jsonc.js";

// Keys the checked-in production scaffold carries that have no local dev
// meaning. Anything else present in wrangler.jsonc must also be present in the
// harness-generated local dev config so `pnpm dev` cannot silently lose a
// production binding again (the Workers AI binding regressed exactly this way
// when transcription moved to Workers AI).
const DEPLOY_ONLY_TOP_LEVEL_KEYS = new Set(["$schema", "placement"]);

async function readCheckedInWranglerConfig(): Promise<Record<string, unknown>> {
  return parseJsoncObject(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
}

describe("hosted-local dev wrangler config fidelity", () => {
  it("keeps every production top-level config key in the generated dev config", async () => {
    const production = await readCheckedInWranglerConfig();
    const dev = buildWranglerLocalDevConfig({});

    const missingFromDev = Object.keys(production)
      .filter((key) => !DEPLOY_ONLY_TOP_LEVEL_KEYS.has(key))
      .filter((key) => !(key in dev));
    expect(missingFromDev).toEqual([]);

    const unexplainedDevOnly = Object.keys(dev).filter((key) => !(key in production));
    expect(unexplainedDevOnly).toEqual([]);
  });

  it("matches the production runtime compatibility surface and binding names", async () => {
    const production = await readCheckedInWranglerConfig();
    const dev = buildWranglerLocalDevConfig({});

    expect(dev.compatibility_date).toEqual(production.compatibility_date);
    expect(dev.compatibility_flags).toEqual(production.compatibility_flags);
    expect(dev.ai).toEqual(production.ai);
    expect(dev.analytics_engine_datasets).toEqual(
      production.analytics_engine_datasets,
    );
    expect(dev.send_email).toEqual(production.send_email);
    expect(dev.version_metadata).toEqual(production.version_metadata);
    expect(dev.durable_objects).toEqual(production.durable_objects);
    expect(dev.migrations).toEqual(production.migrations);

    const devBuckets = dev.r2_buckets as Array<{ binding: string }>;
    const productionBuckets = production.r2_buckets as Array<{ binding: string }>;
    expect(devBuckets.map((bucket) => bucket.binding)).toEqual(
      productionBuckets.map((bucket) => bucket.binding),
    );

    // Container sizing, instance caps, and rollout staging are deploy-only
    // concerns; class identity and operator-access policy must match.
    type ContainerRuntimeSurface = {
      authorized_keys?: unknown;
      class_name: string;
      ssh?: unknown;
    };
    const devContainers = dev.containers as ContainerRuntimeSurface[];
    const productionContainers = production.containers as ContainerRuntimeSurface[];
    const runtimeSurface = (container: ContainerRuntimeSurface) => ({
      authorized_keys: container.authorized_keys,
      class_name: container.class_name,
      ssh: container.ssh,
    });
    expect(devContainers.map(runtimeSurface)).toEqual(
      productionContainers.map(runtimeSurface),
    );
  });

  it("diverges from production observability only on local invocation log verbosity", async () => {
    const production = await readCheckedInWranglerConfig();
    const dev = buildWranglerLocalDevConfig({}) as {
      observability: { logs: { invocation_logs: boolean } };
    };

    expect({
      ...dev.observability,
      logs: {
        ...dev.observability.logs,
        // Local dev keeps request-level invocation logs for debugging.
        invocation_logs: false,
      },
    }).toEqual(production.observability);
  });
});
