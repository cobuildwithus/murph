import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HOSTED_MACHINE_ROUTE_PREFIX, HOSTED_RUNTIME_DATA_API_PATHS } from "@murphai/hosted-execution/routes";
import { checkVercelMachineRoutes } from "../scripts/check-vercel-machine-routes.ts";
import { evaluateMachineRouteFirewall } from "../scripts/vercel-machine-route-firewall.ts";
import { BROWSER_CALLBACK_ROUTES, readProtectedMachineRoutes, readWebRoutes, routeMethods } from "../scripts/vercel-machine-routes.ts";
import { AUGUST_PHONE_BARRIERS, PUBLIC_FIREWALL_V8 } from "./fixtures/vercel-machine-route-firewall.ts";

const routes = [
  { path: "/api/internal/phone-calls", methods: ["POST"] },
  { path: "/api/retell/webhook", methods: ["POST"] },
  { path: "/api/device-sync/webhooks/[provider]", methods: ["GET", "POST"] },
];
const config = (rules: unknown[]) => ({ firewallEnabled: true, ips: [], rules });
const condition = (type: string, op: string, value: string, neg = false) => ({ type, op, value, neg });
const rule = (conditions: unknown[], action = "deny") => ({
  id: "synthetic-rule", active: true, action: { mitigate: { action } }, conditionGroup: [{ conditions }],
});

describe("machine route inventory", () => {
  it("covers every internal route, cron and classified provider ingress while excluding browser routes", async () => {
    const all = await readWebRoutes();
    const protectedRoutes = await readProtectedMachineRoutes();
    const paths = protectedRoutes.map((route) => route.path);
    for (const route of all) {
      if (route.path.startsWith(HOSTED_MACHINE_ROUTE_PREFIX)) expect(paths).toContain(route.path);
      if (/webhook|callback/iu.test(route.path) && !BROWSER_CALLBACK_ROUTES.includes(route.path)) {
        expect(paths, `Unclassified machine ingress: ${route.path}`).toContain(route.path);
      }
    }
    for (const browser of BROWSER_CALLBACK_ROUTES) {
      expect(all.map((route) => route.path)).toContain(browser);
      expect(paths).not.toContain(browser);
    }
    const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
    for (const cron of vercel.crons) expect(paths).toContain(cron.path);
    for (const dataApiPath of HOSTED_RUNTIME_DATA_API_PATHS) expect(paths).toContain(dataApiPath);
    expect(paths).toContain("/api/retell/functions/ask-murph");
    expect(paths).toContain("/api/device-sync/webhooks/[provider]");
    expect(paths).not.toContain("/api/device-sync/companion/auth-diagnostics");
  });

  it("derives exported methods including aliases, reexports and automatic HEAD/OPTIONS", () => {
    expect(routeMethods("export async function GET() {}; export const POST = handler;")).toEqual(["GET", "POST", "HEAD", "OPTIONS"]);
    expect(routeMethods('export { handler as PUT, DELETE } from "./owner";')).toEqual(["PUT", "DELETE", "OPTIONS"]);
    expect(routeMethods('export * from "./owner";')).toContain("POST");
    expect(routeMethods('// export const GET = fake;\nexport const POST = handler;')).not.toContain("GET");
    expect(routeMethods("export const GET = handler; export const { POST } = handlers;")).toContain("POST");
  });

  it("discovers every supported route-handler extension", async () => {
    const webRoot = await mkdtemp(path.join(tmpdir(), "machine-routes-"));
    try {
      const files: [string, string, string][] = [
        ["api/hooks/js", "route.js", "export async function POST() {}"],
        ["api/hooks/tsx", "route.tsx", "export async function POST() { return <div />; }"],
        ["api/hooks/page", "page.tsx", "export default function Page() { return <div />; }"],
      ];
      for (const [dir, file, source] of files) {
        await mkdir(path.join(webRoot, "app", dir), { recursive: true });
        await writeFile(path.join(webRoot, "app", dir, file), source);
      }
      expect((await readWebRoutes(webRoot)).map((route) => route.path)).toEqual(["/api/hooks/js", "/api/hooks/tsx"]);
    } finally {
      await rm(webRoot, { force: true, recursive: true });
    }
  });
});

describe("conservative firewall overlap", () => {
  it("reports both exact August barriers and accepts all current public rate-limit shapes", async () => {
    const inventory = await readProtectedMachineRoutes();
    expect(evaluateMachineRouteFirewall(PUBLIC_FIREWALL_V8, inventory)).toEqual([]);
    expect(evaluateMachineRouteFirewall(config(AUGUST_PHONE_BARRIERS), inventory)).toEqual([
      { ruleId: AUGUST_PHONE_BARRIERS[0]!.id, route: routes[0]!.path },
      { ruleId: AUGUST_PHONE_BARRIERS[1]!.id, route: routes[1]!.path },
    ]);
  });

  it.each(["deny", "challenge", "redirect", "rate_limit", "future-action"])("reports %s but ignores disabled and log-only rules", (action) => {
    const active = rule([], action);
    expect(evaluateMachineRouteFirewall(config([active]), routes)).toHaveLength(3);
    expect(evaluateMachineRouteFirewall(config([{ ...active, active: false }, rule([], "log")]), routes)).toEqual([]);
  });

  it("uses OR groups, AND conditions and each route's methods", () => {
    const prefix = condition("path", "pre", "/api/internal/");
    expect(evaluateMachineRouteFirewall(config([rule([prefix, condition("method", "eq", "GET")])]), routes)).toEqual([]);
    expect(evaluateMachineRouteFirewall(config([rule([prefix, condition("method", "eq", "GET", true)])]), routes)).toHaveLength(1);
    expect(evaluateMachineRouteFirewall(config([rule([prefix, condition("path", "suf", "/phone-calls")])]), routes)).toHaveLength(1);
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "eq", routes[0]!.path, true)])]), routes)).toHaveLength(2);
    const or = { ...rule([prefix]), conditionGroup: [{ conditions: [prefix] }, { conditions: [condition("path", "eq", routes[1]!.path)] }] };
    expect(evaluateMachineRouteFirewall(config([or]), routes)).toHaveLength(2);
  });

  it.each([
    [], [condition("ip", "eq", "192.0.2.1")], [condition("path", "future-op", "/public")],
    [condition("path", "future-op", "/public", true)], [condition("future-type", "eq", "anything", true)],
    [condition("path", "re", "[", true)], [null],
  ])("fails closed on unprovable conditions %j", (...conditions) => {
    expect(evaluateMachineRouteFirewall(config([rule(conditions)]), routes).length).toBeGreaterThan(0);
  });

  it("matches case-insensitively and never excludes a route by local regex evaluation", () => {
    const phone = [routes[0]!];
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "eq", "/API/INTERNAL/PHONE-CALLS")])]), phone)).toHaveLength(1);
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "eq", routes[0]!.path), condition("method", "eq", "post")])]), phone)).toHaveLength(1);
    const pcreOnly = condition("path", "re", "\\A/api/internal/phone-calls\\z");
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "pre", "/api/internal/phone-calls"), pcreOnly])]), phone)).toHaveLength(1);
    expect(evaluateMachineRouteFirewall(config([rule([{ ...pcreOnly, neg: true }])]), phone)).toHaveLength(1);
  });

  it("does not mistake one dynamic route sample for the full route space", () => {
    for (const c of [condition("path", "eq", "/api/device-sync/webhooks/oura"), condition("path", "suf", "/oura"), condition("path", "pre", "/api/device-sync/webhooks/oura"), condition("path", "eq", "/api/device-sync/webhooks/oura", true)]) {
      expect(evaluateMachineRouteFirewall(config([rule([c])]), [routes[2]!])).toEqual([{ ruleId: "synthetic-rule", route: routes[2]!.path }]);
    }
    const dynamic = [{ path: "/api/internal/[[...parts]]", methods: ["GET"] }, { path: "/api/internal/[...parts]", methods: ["GET"] }];
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "eq", "/api/internal")])]), dynamic)).toHaveLength(1);
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "pre", "/api/internal/", true)])]), [dynamic[0]!])).toHaveLength(1);
    expect(evaluateMachineRouteFirewall(config([rule([condition("path", "re", "^/api/internal/phone-calls$")])]), [routes[0]!])).toHaveLength(1);
  });

  it("reports global settings, IP blocks and unknown/malformed configuration without bypass suppression", () => {
    const base = config([]);
    for (const extra of [
      { ips: [{ id: "ip-rule", ip: "192.0.2.1", action: "deny" }] },
      { crs: { sqli: { active: true, action: "deny" } } },
      { managedRules: { bot_protection: { active: true, action: "challenge" } } },
      { rulesets: [rule([])] }, { attackModeEnabled: true }, { botIdEnabled: true },
      { newMitigation: { active: true } }, { rules: null }, { rules: [{}] },
    ]) expect(evaluateMachineRouteFirewall({ ...base, ...extra }, routes).length).toBeGreaterThan(0);
    expect(evaluateMachineRouteFirewall({ ...base, newMitigation: { active: true } }, routes)[0]?.ruleId)
      .toBe("config:unknown-setting:newMitigation");
    expect(evaluateMachineRouteFirewall({}, routes)).toHaveLength(3);
    expect(evaluateMachineRouteFirewall({ ...base, firewallEnabled: false }, routes)).toEqual([]);
    expect(evaluateMachineRouteFirewall({ ...base, firewallEnabled: false, attackModeEnabled: true }, routes)).toHaveLength(3);
    expect(evaluateMachineRouteFirewall(config([rule([], "bypass"), rule([])]), routes)).toHaveLength(3);
    expect(evaluateMachineRouteFirewall({ ...base, ips: [{ action: "bypass" }], managedRules: { bot_protection: { active: false, action: "challenge" } } }, routes)).toEqual([]);
  });
});

const environment = { HOSTED_WEB_VERCEL_TOKEN: "synthetic-token", HOSTED_WEB_VERCEL_PROJECT_ID: "synthetic-project", HOSTED_WEB_VERCEL_TEAM_ID: "synthetic-team" };
function api(configResponse: unknown, security: unknown = {}): typeof fetch {
  return vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).includes("/v9/projects/") ? { security } : configResponse)));
}

describe("scheduled read-only checker", () => {
  it("reads both APIs with bounded GETs and reports only the success summary", async () => {
    const fetchImpl = api(PUBLIC_FIREWALL_V8);
    const log = vi.fn();
    await checkVercelMachineRoutes(environment, fetchImpl, log);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/config/active?"), expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) }));
    expect(fetchImpl).toHaveBeenCalledWith("https://api.vercel.com/v9/projects/synthetic-project?teamId=synthetic-team", expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer synthetic-token", Accept: "application/json" },
    }));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/protected routes; zero conflicts/));
  });

  it("fails on incident rules and separately stored attack mode", async () => {
    const log = vi.fn();
    await expect(checkVercelMachineRoutes(environment, api(config(AUGUST_PHONE_BARRIERS)), log)).rejects.toThrow("2 machine-route conflicts");
    expect(log).toHaveBeenCalledWith(expect.stringContaining(AUGUST_PHONE_BARRIERS[0]!.id));
    await expect(checkVercelMachineRoutes(environment, api(PUBLIC_FIREWALL_V8, { attackModeEnabled: true }), log)).rejects.toThrow("machine-route conflicts");
    expect(JSON.stringify(log.mock.calls)).not.toContain(environment.HOSTED_WEB_VERCEL_TOKEN);
  });

  it("prints API-derived ids without workflow-command markers or line breaks", async () => {
    const log = vi.fn();
    const hostile = { ...rule([condition("path", "eq", routes[0]!.path)]), id: "##[warning]x\n::error::y" };
    await expect(checkVercelMachineRoutes(environment, api(config([hostile])), log)).rejects.toThrow("machine-route conflicts");
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.startsWith("Firewall conflict: rule="))).toBe(true);
    for (const line of lines) expect(line).not.toMatch(/##\[|\n/u);
  });

  it("fails closed without leaking fetch errors or response bodies", async () => {
    for (const fetchImpl of [
      vi.fn<typeof fetch>(async () => { throw new Error("synthetic-token"); }),
      vi.fn<typeof fetch>(async () => new Response("synthetic-token", { status: 403 })),
      vi.fn<typeof fetch>(async () => new Response("synthetic-token")),
      api(PUBLIC_FIREWALL_V8, null),
    ]) {
      await expect(checkVercelMachineRoutes(environment, fetchImpl)).rejects.toThrow(/^Vercel firewall check: (?!.*synthetic-token)/u);
    }
    await expect(checkVercelMachineRoutes({})).rejects.toThrow("missing HOSTED_WEB_VERCEL_TOKEN");
  });
});
