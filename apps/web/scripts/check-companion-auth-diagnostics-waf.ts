import { spawnSync } from "node:child_process";
import { argv, cwd, env, exit } from "node:process";
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

interface FirewallFacts {
  disabledKeys: string[];
  numbers: number[];
  strings: string[];
}

export function validateCompanionAuthDiagnosticsWafRule(rule: unknown): string[] {
  const facts = collectFirewallFacts(rule);
  const normalizedText = facts.strings.join(" ").toLowerCase();
  const issues: string[] = [];

  if (!facts.strings.includes(COMPANION_AUTH_DIAGNOSTICS_PATH)) {
    issues.push(`missing exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`);
  }
  if (!normalizedText.includes("rate") || !normalizedText.includes("limit")) {
    issues.push("missing rate-limit action");
  }
  if (!hasNumberFact(facts, REQUIRED_RATE_LIMIT)) {
    issues.push(`missing request limit ${REQUIRED_RATE_LIMIT}`);
  }
  if (!hasNumberFact(facts, REQUIRED_WINDOW_SECONDS) && !hasStringFact(facts, "60s") && !hasStringFact(facts, "1m")) {
    issues.push(`missing ${REQUIRED_WINDOW_SECONDS}-second fixed window`);
  }
  if (!hasNumberFact(facts, REQUIRED_STATUS)) {
    issues.push(`missing ${REQUIRED_STATUS} response status`);
  }
  if (facts.disabledKeys.length > 0) {
    issues.push(`rule appears disabled at ${facts.disabledKeys.join(", ")}`);
  }

  return issues;
}

function collectFirewallFacts(value: unknown): FirewallFacts {
  const facts: FirewallFacts = { disabledKeys: [], numbers: [], strings: [] };
  collectFirewallFactsInto(value, facts, []);
  return facts;
}

function collectFirewallFactsInto(value: unknown, facts: FirewallFacts, path: string[]): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    facts.strings.push(value);
    return;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    facts.numbers.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectFirewallFactsInto(entry, facts, [...path, String(index)]));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...path, key];
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey === "enabled" || normalizedKey === "active") && entry === false) {
      facts.disabledKeys.push(nextPath.join("."));
    }
    facts.strings.push(key);
    collectFirewallFactsInto(entry, facts, nextPath);
  }
}

function hasNumberFact(facts: FirewallFacts, expected: number): boolean {
  return facts.numbers.includes(expected)
    || facts.strings.some((value) => value.trim() === String(expected));
}

function hasStringFact(facts: FirewallFacts, expected: string): boolean {
  return facts.strings.some((value) => value.trim().toLowerCase() === expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

  const result = spawnSync(
    "pnpm",
    ["exec", "vercel", "firewall", "rules", "inspect", ruleRef, "--json"],
    {
      cwd: cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
