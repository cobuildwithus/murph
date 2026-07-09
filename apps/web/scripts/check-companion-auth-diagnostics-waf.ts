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
const REQUIRED_STATUS = 429;

interface WafInspectCommand {
  args: string[];
  command: string;
  cwd: string;
}

type JsonRecord = Record<string, unknown>;

export function buildCompanionAuthDiagnosticsWafInspectCommand(
  ruleRef: string,
  appDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): WafInspectCommand {
  return {
    args: ["exec", "vercel", "firewall", "rules", "inspect", ruleRef, "--json"],
    command: "pnpm",
    cwd: appDir,
  };
}

export function validateCompanionAuthDiagnosticsWafRule(rule: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(rule)) {
    return ["rule payload must be an object"];
  }

  if (readBooleanProperty(rule, ["enabled", "active"]) === false) {
    issues.push("rule is disabled");
  }
  if (readBooleanProperty(rule, ["draft", "unpublished"]) === true) {
    issues.push("rule is not published");
  }
  if (readBooleanProperty(rule, ["published", "live"]) === false) {
    issues.push("rule is not published");
  }

  const records = collectRecords(rule);
  if (!records.some(isExactDiagnosticsPathCondition)) {
    issues.push(`missing exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`);
  }
  if (!records.some(isRequiredRateLimitAction)) {
    issues.push(
      `missing rate-limit action ${REQUIRED_RATE_LIMIT}/${REQUIRED_WINDOW_SECONDS}s with ${REQUIRED_STATUS}`,
    );
  }

  return issues;
}

function isExactDiagnosticsPathCondition(record: JsonRecord): boolean {
  return hasPathField(record)
    && hasExactOperator(record)
    && readOwnValues(record).includes(COMPANION_AUTH_DIAGNOSTICS_PATH);
}

function isRequiredRateLimitAction(record: JsonRecord): boolean {
  if (!hasOwnRateLimitAction(record) || hasOwnLogOnlyAction(record)) {
    return false;
  }

  return hasNestedKeyNumber(record, ["limit", "requests", "requestsPerWindow"], REQUIRED_RATE_LIMIT)
    && hasRequiredWindow(record)
    && hasNestedKeyNumber(record, ["status", "statusCode", "responseStatus"], REQUIRED_STATUS);
}

function hasPathField(record: JsonRecord): boolean {
  return readOwnStrings(record, ["field", "key", "name", "source", "type"])
    .some((value) => normalizeToken(value).includes("path"));
}

function hasExactOperator(record: JsonRecord): boolean {
  return readOwnStrings(record, ["match", "op", "operator", "operation"])
    .some((value) => ["eq", "equal", "equals", "exact", "is"].includes(normalizeToken(value)));
}

function hasOwnRateLimitAction(record: JsonRecord): boolean {
  return readOwnStrings(record, ["action", "kind", "mode", "type"])
    .some((value) => normalizeToken(value).includes("ratelimit"));
}

function hasOwnLogOnlyAction(record: JsonRecord): boolean {
  return readOwnStrings(record, ["action", "kind", "mode", "type"])
    .some((value) => normalizeToken(value) === "log");
}

function hasRequiredWindow(record: JsonRecord): boolean {
  return hasNestedKeyNumber(record, ["duration", "period", "seconds", "value", "window"], REQUIRED_WINDOW_SECONDS)
    || hasNestedString(record, "60s")
    || hasNestedString(record, "1m");
}

function hasNestedKeyNumber(record: JsonRecord, keys: string[], expected: number): boolean {
  for (const [key, value] of Object.entries(record)) {
    if (keys.some((candidate) => normalizeToken(candidate) === normalizeToken(key))) {
      if (value === expected || (typeof value === "string" && value.trim() === String(expected))) {
        return true;
      }
    }
    if (isRecord(value) && hasNestedKeyNumber(value, keys, expected)) {
      return true;
    }
    if (Array.isArray(value) && value.some((entry) => isRecord(entry) && hasNestedKeyNumber(entry, keys, expected))) {
      return true;
    }
  }

  return false;
}

function hasNestedString(record: JsonRecord, expected: string): boolean {
  return Object.values(record).some((value) => {
    if (typeof value === "string") {
      return value.trim().toLowerCase() === expected;
    }
    if (isRecord(value)) {
      return hasNestedString(value, expected);
    }
    return Array.isArray(value) && value.some((entry) => isRecord(entry) && hasNestedString(entry, expected));
  });
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

function readOwnStrings(record: JsonRecord, keys: string[]): string[] {
  return keys.flatMap((key) => readOwnStringValues(record[key]));
}

function readOwnValues(record: JsonRecord): string[] {
  return Object.values(record).flatMap(readOwnStringValues);
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

function collectRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectRecords);
  }
  if (!isRecord(value)) {
    return [];
  }

  return [value, ...Object.values(value).flatMap(collectRecords)];
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

  const command = buildCompanionAuthDiagnosticsWafInspectCommand(ruleRef);
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
  const issues = validateCompanionAuthDiagnosticsWafRule(parsed);
  if (issues.length > 0) {
    throw new Error(
      `Vercel WAF rule ${ruleRef} does not satisfy companion auth diagnostics requirements: ${issues.join("; ")}.`,
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
