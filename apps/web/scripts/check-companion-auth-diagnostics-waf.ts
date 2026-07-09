import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

export const COMPANION_AUTH_DIAGNOSTICS_PATH =
  "/api/device-sync/companion/auth-diagnostics";
export const COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED";
export const COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID";

const REQUIRED_RATE_LIMIT = 30;
const REQUIRED_WINDOW_SECONDS = 60;
const REQUIRED_ALGORITHM = "fixed_window";
const REQUIRED_RATE_LIMIT_KEY = "ip";

interface WafOverviewCommand {
  args: string[];
  command: string;
  cwd: string;
}

type JsonRecord = Record<string, unknown>;

export function buildCompanionAuthDiagnosticsWafOverviewCommand(
  appDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): WafOverviewCommand {
  return {
    args: ["exec", "vercel", "firewall", "overview", "--json"],
    command: "pnpm",
    cwd: appDir,
  };
}

export function validateCompanionAuthDiagnosticsWafOverview(
  overview: unknown,
  ruleRef: string,
): string[] {
  const issues: string[] = [];
  if (!isRecord(overview)) {
    return ["overview payload must be an object"];
  }

  if (readBooleanProperty(overview, ["enabled", "firewallEnabled"]) === false) {
    issues.push("firewall is disabled");
  }

  const active = readRecord(overview, "active");
  if (active === null) {
    return ["overview missing active firewall configuration"];
  }

  if (readBooleanProperty(active, ["enabled", "firewallEnabled"]) === false) {
    issues.push("active firewall configuration is disabled");
  }

  const rule = findActiveRule(active, ruleRef);
  if (rule === null) {
    issues.push(`missing active rule ${ruleRef}`);
    return issues;
  }

  if (readBooleanProperty(rule, ["enabled"]) === false) {
    issues.push("rule is disabled");
  }
  if (readBooleanProperty(rule, ["valid"]) === false) {
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

function findActiveRule(active: JsonRecord, ruleRef: string): JsonRecord | null {
  const rules = readRules(active);
  return rules.find((rule) => (
    readOwnStrings(rule, ["id", "name"]).includes(ruleRef)
  )) ?? null;
}

function readRules(active: JsonRecord): JsonRecord[] {
  const rules = active.rules ?? active.customRules ?? active.firewallRules;
  return Array.isArray(rules)
    ? rules.filter(isRecord)
    : [];
}

function hasOnlyExactDiagnosticsPathCondition(rule: JsonRecord): boolean {
  const conditions = readRuleConditions(rule);
  return conditions.length === 1 && isExactDiagnosticsPathCondition(conditions[0]);
}

function readRuleConditions(rule: JsonRecord): JsonRecord[] {
  const conditionGroup = readRecord(rule, "conditionGroup")
    ?? readRecord(rule, "conditionsGroup")
    ?? readRecord(rule, "condition_group");
  const groupConditions = conditionGroup === null ? [] : readConditionArray(conditionGroup);
  const directConditions = readConditionArray(rule);

  return groupConditions.length > 0 ? groupConditions : directConditions;
}

function readConditionArray(record: JsonRecord): JsonRecord[] {
  const conditions = record.conditions;
  return Array.isArray(conditions)
    ? conditions.filter(isRecord)
    : [];
}

function isExactDiagnosticsPathCondition(record: JsonRecord): boolean {
  return readBooleanProperty(record, ["negated", "negate", "not"]) !== true
    && hasPathField(record)
    && hasExactOperator(record)
    && readOwnStrings(record, ["value", "values"]).includes(COMPANION_AUTH_DIAGNOSTICS_PATH);
}

function hasPathField(record: JsonRecord): boolean {
  return readOwnStrings(record, ["field", "key", "name", "source", "type"])
    .some((value) => normalizeToken(value) === "path");
}

function hasExactOperator(record: JsonRecord): boolean {
  return readOwnStrings(record, ["match", "op", "operator", "operation"])
    .some((value) => ["eq", "equal", "equals", "exact", "is"].includes(normalizeToken(value)));
}

function hasRequiredRateLimitAction(rule: JsonRecord): boolean {
  const action = readRecord(rule, "action");
  const mitigate = action === null ? null : readRecord(action, "mitigate");
  const actionSource = mitigate ?? action;
  if (actionSource === null) {
    return false;
  }

  const actionType = readOwnStrings(actionSource, ["action", "kind", "mode", "type"])
    .some((value) => normalizeToken(value) === "ratelimit");
  const rateLimit = readRecord(actionSource, "rateLimit")
    ?? readRecord(actionSource, "rate_limit")
    ?? readRecord(rule, "rateLimit")
    ?? readRecord(rule, "rate_limit");

  return actionType
    && rateLimit !== null
    && readNumber(rateLimit, ["limit", "requests", "requestsPerWindow"]) === REQUIRED_RATE_LIMIT
    && readRateLimitWindowSeconds(rateLimit) === REQUIRED_WINDOW_SECONDS
    && readOwnStrings(rateLimit, ["algo", "algorithm"]).some((value) =>
      normalizeToken(value) === normalizeToken(REQUIRED_ALGORITHM)
    )
    && readOwnStrings(rateLimit, ["key", "keys"]).some((value) =>
      normalizeToken(value) === REQUIRED_RATE_LIMIT_KEY
    );
}

function readRateLimitWindowSeconds(rateLimit: JsonRecord): number | null {
  const direct = readNumber(rateLimit, ["window", "duration", "period", "seconds"]);
  if (direct !== null) {
    return direct;
  }

  const window = readRecord(rateLimit, "window");
  return window === null ? null : readNumber(window, ["value", "seconds"]);
}

function readNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readBooleanProperty(record: JsonRecord, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readOwnStrings(record: JsonRecord, keys: string[]): string[] {
  return keys.flatMap((key) => readOwnStringValues(record[key]));
}

function readOwnStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/gu, "");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(): void {
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

  const command = buildCompanionAuthDiagnosticsWafOverviewCommand();
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect Vercel WAF rule ${ruleRef}: ${result.stderr || result.stdout || "command failed"}`,
    );
  }

  const parsed = JSON.parse(result.stdout) as unknown;
  const issues = validateCompanionAuthDiagnosticsWafOverview(parsed, ruleRef);
  if (issues.length > 0) {
    throw new Error(
      `Vercel WAF active configuration does not satisfy companion auth diagnostics requirements for ${ruleRef}: ${issues.join("; ")}.`,
    );
  }

  console.log("Companion auth diagnostics WAF preflight passed.");
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  }
}
