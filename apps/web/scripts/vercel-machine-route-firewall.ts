import type { ProtectedRoute } from "./vercel-machine-routes.ts";

type JsonRecord = Record<string, unknown>;
type Match = boolean | undefined;
export interface FirewallConflict { ruleId: string; route: string }

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function routePattern(route: string): RegExp {
  const pattern = route.split("/").map((segment) => {
    if (segment.startsWith("[[...")) return "(?:/.*)?";
    if (segment.startsWith("[...")) return "/.+";
    if (segment.startsWith("[")) return "/[^/]+";
    return segment ? `/${escapeRegex(segment)}` : "";
  }).join("");
  return new RegExp(`^${pattern}/?$`, "u");
}

function pathMatch(route: string, op: unknown, value: string): Match {
  const dynamic = route.includes("[");
  if (op === "eq") return dynamic ? (routePattern(route).test(value) ? undefined : false) : route === value;
  if (op === "pre" && dynamic) {
    const start = route.indexOf("[");
    const prefix = route.slice(0, route.startsWith("[[", start) ? start - 1 : start);
    if (prefix.startsWith(value)) return true;
    return value.startsWith(prefix) ? undefined : false;
  }
  if (op === "suf" && dynamic) {
    const suffix = route.slice(route.lastIndexOf("]") + 1);
    if (suffix.endsWith(value)) return true;
    return value.endsWith(suffix) ? undefined : false;
  }
  if (dynamic) return undefined;
  if (op === "pre") return route.startsWith(value);
  if (op === "suf") return route.endsWith(value);
  // Unknown/invalid regex syntax must stay may-match, including under negation.
  if (op === "re") {
    try { return new RegExp(value).test(route); } catch { return undefined; }
  }
  return undefined;
}

function conditionMayMatch(condition: unknown, route: ProtectedRoute, method: string): boolean {
  if (!isRecord(condition) || typeof condition.value !== "string") return true;
  if (condition.neg !== undefined && typeof condition.neg !== "boolean") return true;
  let match: Match = undefined;
  if (condition.type === "path") match = pathMatch(route.path, condition.op, condition.value);
  if (condition.type === "method") {
    if (condition.op === "eq") match = method === condition.value;
    else match = undefined;
  }
  return match === undefined || (condition.neg === true ? !match : match);
}

function ruleMayMatch(rule: JsonRecord, route: ProtectedRoute): boolean {
  if (!Array.isArray(rule.conditionGroup) || rule.conditionGroup.length === 0) return true;
  return rule.conditionGroup.some((group: unknown) => {
    if (!isRecord(group) || !Array.isArray(group.conditions)) return true;
    const conditions: unknown[] = group.conditions;
    return route.methods.some((method) => conditions.every((condition) => conditionMayMatch(condition, route, method)));
  });
}

function harmlessAction(action: unknown): boolean {
  if (typeof action === "string") return ["log", "bypass", "allow"].includes(action);
  if (!isRecord(action) || !isRecord(action.mitigate)) return false;
  const mitigation = action.mitigate;
  return harmlessAction(mitigation.action) && mitigation.rateLimit == null && mitigation.redirect == null;
}

// Conservatively report overlap, not reachability after earlier bypass rules.
// Vercel wire contract: https://vercel.com/docs/rest-api/security/read-firewall-configuration
export function evaluateMachineRouteFirewall(config: unknown, routes: readonly ProtectedRoute[]): FirewallConflict[] {
  const conflicts: FirewallConflict[] = [];
  const report = (ruleId: string, matching = routes) => {
    for (const route of matching) conflicts.push({ ruleId, route: route.path });
  };
  if (!isRecord(config) || typeof config.firewallEnabled !== "boolean") {
    report("config:invalid");
    return conflicts;
  }
  if (config.attackModeEnabled !== undefined && config.attackModeEnabled !== false) report("setting:attackModeEnabled");
  if (!config.firewallEnabled) return conflicts;
  const inspectRule = (value: unknown, fallbackId: string) => {
    if (!isRecord(value)) { report(fallbackId); return; }
    if (value.active === false || harmlessAction(value.action)) return;
    const id = typeof value.id === "string" ? value.id : fallbackId;
    report(id, routes.filter((route) => ruleMayMatch(value, route)));
  };
  for (const key of ["rules", "ips"] as const) {
    const rules = config[key];
    if (!Array.isArray(rules)) report(`config:${key}`);
    else rules.forEach((rule, index) => inspectRule(rule, `${key}:${index}`));
  }
  for (const key of ["crs", "managedRules", "rulesets"] as const) {
    const value = config[key];
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((rule, index) => inspectRule(rule, `${key}:${index}`));
    else if (isRecord(value)) Object.entries(value).forEach(([id, rule]) => inspectRule(rule, `${key}:${id}`));
    else report(`config:${key}`);
  }
  if (config.botIdEnabled !== undefined && config.botIdEnabled !== false) report("setting:botIdEnabled");
  // A new config field is not assumed to be harmless until its semantics are reviewed.
  const known = new Set(["rules", "ips", "crs", "managedRules", "rulesets", "firewallEnabled", "botIdEnabled",
    "attackModeEnabled", "id", "ownerId", "projectKey", "version", "updatedAt", "changes", "logHeaders", "conditions"]);
  for (const key of Object.keys(config)) {
    if (!known.has(key) && config[key] != null && config[key] !== false) report(`config:unknown-setting:${key}`);
  }
  return conflicts;
}
