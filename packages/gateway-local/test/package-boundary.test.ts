import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as gatewayLocal from "@murphai/gateway-local";
import * as localService from "../src/local-service.js";
import * as send from "../src/send.js";

type GatewayLocalPackageManifest = {
  exports?: Record<string, { default?: string; types?: string } | undefined>;
};

describe("@murphai/gateway-local package boundary", () => {
  it("publishes only the root entrypoint and exposes the intended local gateway helpers", async () => {
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
    expect(gatewayLocal.createLocalGatewayService).toBe(
      localService.createLocalGatewayService,
    );
    expect(gatewayLocal.sendGatewayMessage).toBe(localService.sendGatewayMessage);
    expect(gatewayLocal.sendGatewayMessageLocal).toBe(send.sendGatewayMessageLocal);
    expect("LocalGatewayProjectionStore" in gatewayLocal).toBe(false);
    expect("normalizeNullableString" in gatewayLocal).toBe(false);
    expect(rootBarrel).not.toContain("LocalGatewayProjectionStore");
    expect(rootBarrel).not.toContain("normalizeNullableString");
  });
});
