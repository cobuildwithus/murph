import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

export const COMPANION_AUTH_DIAGNOSTICS_PATH =
  "/api/device-sync/companion/auth-diagnostics";
export const COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED";
export const COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID";
const VERCEL_PROJECT_ID_ENV = "HOSTED_WEB_VERCEL_PROJECT_ID";
const VERCEL_TEAM_ID_ENV = "HOSTED_WEB_VERCEL_TEAM_ID";
const VERCEL_TOKEN_ENV = "HOSTED_WEB_VERCEL_TOKEN";
const VERCEL_FIREWALL_CONFIG_URL = "https://api.vercel.com/v1/security/firewall/config";

const REQUIRED_RATE_LIMIT = 30;
const REQUIRED_WINDOW_SECONDS = 60;
const REQUIRED_ALGORITHM = "fixed_window";
const REQUIRED_RATE_LIMIT_KEY = "ip";

type JsonRecord = Record<string, unknown>;

export function buildCompanionAuthDiagnosticsWafConfigUrl(
  projectId: string,
  teamId: string | undefined,
): string {
  const url = new URL(VERCEL_FIREWALL_CONFIG_URL);
  url.searchParams.set("projectId", projectId);
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }
  return url.toString();
}

export function validateCompanionAuthDiagnosticsWafOverview(
  overview: unknown,
  ruleRef: string,
): string[] {
  const issues: string[] = [];
  if (!isRecord(overview)) {
    return ["overview payload must be an object"];
  }

  const active = readRecord(overview, "active");
  if (active === null) {
    return ["overview missing active firewall configuration"];
  }

  if (active.firewallEnabled !== true) {
    issues.push("active firewall configuration is disabled");
  }

  const rules = readRules(active);
  const ruleIndex = rules.findIndex((rule) => (
    rule.id === ruleRef || rule.name === ruleRef
  ));
  const rule = ruleIndex < 0 ? null : rules[ruleIndex];
  if (rule === null) {
    issues.push(`missing active rule ${ruleRef}`);
    return issues;
  }
  const firstActiveRuleIndex = rules.findIndex((candidate) => candidate.active === true);
  if (rule.active === true && ruleIndex !== firstActiveRuleIndex) {
    issues.push("rule must be the first active custom rule");
  }

  if (rule.active !== true) {
    issues.push("rule is disabled");
  }
  if (rule.valid !== true) {
    issues.push("rule is invalid");
  }
  if (!hasOnlyExactDiagnosticsPathCondition(rule)) {
    issues.push(`rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`);
  }
  if (!hasRequiredRateLimitAction(rule)) {
    issues.push(
      `missing fixed-window IP rate-limit action ${REQUIRED_RATE_LIMIT}/${REQUIRED_WINDOW_SECONDS}s`,
    );
  }

  return issues;
}

function readRules(active: JsonRecord): JsonRecord[] {
  const rules = active.rules;
  return Array.isArray(rules)
    ? rules.filter(isRecord)
    : [];
}

function hasOnlyExactDiagnosticsPathCondition(rule: JsonRecord): boolean {
  const conditionGroups = rule.conditionGroup;
  if (!Array.isArray(conditionGroups) || conditionGroups.length !== 1) {
    return false;
  }
  const group = conditionGroups[0];
  if (!isRecord(group) || !Array.isArray(group.conditions) || group.conditions.length !== 1) {
    return false;
  }
  return isExactDiagnosticsPathCondition(group.conditions[0]);
}

function isExactDiagnosticsPathCondition(value: unknown): boolean {
  return isRecord(value)
    && value.neg !== true
    && value.type === "path"
    && value.op === "eq"
    && value.value === COMPANION_AUTH_DIAGNOSTICS_PATH;
}

function hasRequiredRateLimitAction(rule: JsonRecord): boolean {
  const action = readRecord(rule, "action");
  const mitigate = action === null ? null : readRecord(action, "mitigate");
  if (mitigate === null || mitigate.action !== "rate_limit") {
    return false;
  }

  const rateLimit = readRecord(mitigate, "rateLimit");

  return rateLimit !== null
    && rateLimit.action === "rate_limit"
    && rateLimit.algo === REQUIRED_ALGORITHM
    && rateLimit.limit === REQUIRED_RATE_LIMIT
    && rateLimit.window === REQUIRED_WINDOW_SECONDS
    && Array.isArray(rateLimit.keys)
    && rateLimit.keys.length === 1
    && rateLimit.keys[0] === REQUIRED_RATE_LIMIT_KEY;
}

function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  if (env[COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV] !== "1") {
    console.log("Companion auth diagnostics WAF preflight skipped: route not enabled.");
    return;
  }

  const ruleRef = env[COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ENV]?.trim();
  if (!ruleRef) {
    throw new Error(
      `${COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ENV} is required when ${COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV}=1.`,
    );
  }

  const projectId = requireEnvironmentVariable(VERCEL_PROJECT_ID_ENV);
  const token = requireEnvironmentVariable(VERCEL_TOKEN_ENV);
  const response = await fetch(buildCompanionAuthDiagnosticsWafConfigUrl(
    projectId,
    env[VERCEL_TEAM_ID_ENV]?.trim() || undefined,
  ), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Unable to inspect Vercel WAF rule ${ruleRef}: Vercel API returned ${response.status}.`,
    );
  }

  const parsed = await response.json() as unknown;
  const issues = validateCompanionAuthDiagnosticsWafOverview(parsed, ruleRef);
  if (issues.length > 0) {
    throw new Error(
      `Vercel WAF active configuration does not satisfy companion auth diagnostics requirements for ${ruleRef}: ${issues.join("; ")}.`,
    );
  }

  console.log("Companion auth diagnostics WAF preflight passed.");
}

function requireEnvironmentVariable(name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when ${COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV}=1.`);
  }
  return value;
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  });
}
