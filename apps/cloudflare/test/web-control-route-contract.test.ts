import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  HOSTED_RUNTIME_OPERATOR_TASK_CONTROL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  bindHostedRunnerWebControlRoutePath,
  createHostedRunnerDeviceSyncConnectLinkRoute,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  readHostedRunnerWebControlPolicy,
  type HostedRunnerWebControlRoute,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  fetchHostedWebControlPlaneJson,
} from "../src/runtime-platform/web-control-transport.ts";

type WebControlRequest = Parameters<typeof fetchHostedWebControlPlaneJson>[0];

const CLOUDFLARE_SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

async function listTypeScriptSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return await listTypeScriptSources(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return paths.flat().sort();
}

// @ts-expect-error An arbitrary method/path object cannot impersonate a registered route.
const UNREGISTERED_ROUTE: HostedRunnerWebControlRoute = {
  method: "POST",
  operation: "operator_task_control",
  path: "/api/internal/unregistered",
};
void UNREGISTERED_ROUTE;

describe("hosted runtime web-control route contract", () => {
  it("makes the registered route descriptor the only outbound call surface", () => {
    expectTypeOf<"route" extends keyof WebControlRequest ? true : false>()
      .toEqualTypeOf<true>();
    expectTypeOf<"path" extends keyof WebControlRequest ? true : false>()
      .toEqualTypeOf<false>();
    expectTypeOf<"method" extends keyof WebControlRequest ? true : false>()
      .toEqualTypeOf<false>();
  });

  it("keeps Web-control URL construction inside the audited owners", async () => {
    const sources = await listTypeScriptSources(CLOUDFLARE_SOURCE_ROOT);
    const baseUrlOwners: string[] = [];
    const rawHostLiteralOwners: string[] = [];
    for (const path of sources) {
      const source = await readFile(path, "utf8");
      const relativePath = path
        .slice(CLOUDFLARE_SOURCE_ROOT.length)
        .replace(/^\/+/, "");
      if (source.includes(
        "CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane",
      )) {
        baseUrlOwners.push(relativePath);
      }
      if (source.includes("web-control.worker")) {
        rawHostLiteralOwners.push(relativePath);
      }
    }

    expect(baseUrlOwners).toEqual([
      "runner-egress-intercept.ts",
      "runtime-bridge-mailbox-payload-decode.ts",
      "runtime-platform/web-control-transport.ts",
    ]);
    expect(rawHostLiteralOwners).toEqual(["internal-hosts.ts"]);
  });

  it("derives every static proxy allowlist entry from its callable route", () => {
    for (const route of Object.values(HOSTED_RUNNER_WEB_CONTROL_ROUTES)) {
      const pathname = new URL(
        route.path,
        "https://hosted-runtime.invalid/",
      ).pathname;
      expect(readHostedRunnerWebControlPolicy({
        method: route.method,
        path: pathname,
      })).toEqual({
        allowed: true,
        operation: route.operation,
      });
      expect(readHostedRunnerWebControlPolicy({
        method: route.method === "GET" ? "POST" : "GET",
        path: pathname,
      }).allowed).toBe(false);
      expect(readHostedRunnerWebControlPolicy({
        method: route.method,
        path: `${pathname}/arbitrary`,
      }).allowed).toBe(false);
    }
  });

  it("admits only the exact operator-task POST route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_OPERATOR_TASK_CONTROL_PATH,
    })).toEqual({
      allowed: true,
      operation: "operator_task_control",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_OPERATOR_TASK_CONTROL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_OPERATOR_TASK_CONTROL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("binds query strings without permitting a different pathname", () => {
    const route = bindHostedRunnerWebControlRoutePath(
      HOSTED_RUNNER_WEB_CONTROL_ROUTES.groupTool,
      `${HOSTED_RUNNER_WEB_CONTROL_ROUTES.groupTool.path}?version=1`,
    );
    expect(route.path).toBe(
      `${HOSTED_RUNNER_WEB_CONTROL_ROUTES.groupTool.path}?version=1`,
    );
    expect(() => bindHostedRunnerWebControlRoutePath(
      HOSTED_RUNNER_WEB_CONTROL_ROUTES.groupTool,
      "/api/internal/unregistered?version=1",
    )).toThrow(
      "Hosted runtime web-control route path must match its registered route.",
    );
  });

  it("constructs only the bounded device-sync connect-link path family", () => {
    const route = createHostedRunnerDeviceSyncConnectLinkRoute(
      "/api/internal/device-sync/connect-targets/whoop/connect-link",
    );
    expect(readHostedRunnerWebControlPolicy({
      method: route.method,
      path: route.path,
    })).toEqual({
      allowed: true,
      operation: "device_sync_connect_link",
    });
    expect(() => createHostedRunnerDeviceSyncConnectLinkRoute(
      "/api/internal/device-sync/connect-targets/whoop/connect-link/arbitrary",
    )).toThrow("Hosted runtime device-sync connect-link route is invalid.");
  });
});
