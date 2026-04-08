import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type GatewayLocalPackageManifest = {
  exports?: Record<string, { default?: string; types?: string } | undefined>;
};

describe("@murphai/gateway-local package boundary", () => {
  it("publishes only the root entrypoint and exposes the intended local gateway helpers", async () => {
    const gatewayLocal = await import("@murphai/gateway-local");
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as GatewayLocalPackageManifest;
    const rootBarrel = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(packageJson.exports).toEqual({
      ".": {
        default: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    });
    expect(gatewayLocal.createLocalGatewayService).toBeTypeOf("function");
    expect(gatewayLocal.exportGatewayProjectionSnapshotLocal).toBeTypeOf("function");
    expect(gatewayLocal.sendGatewayMessageLocal).toBeTypeOf("function");
    expect("LocalGatewayProjectionStore" in gatewayLocal).toBe(false);
    expect("normalizeNullableString" in gatewayLocal).toBe(false);
    expect(rootBarrel).not.toContain("LocalGatewayProjectionStore");
    expect(rootBarrel).not.toContain("normalizeNullableString");
  });
});
