import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

export const COMPANION_AUTH_DIAGNOSTICS_PATH =
  "/api/device-sync/companion/auth-diagnostics";
export const MURPH_SAFE_SEARCH_PATH = "/api/public/v1/products/search";
export const MURPH_SAFE_API_DETAIL_PREFIX = "/api/public/v1/products/";
export const MURPH_SAFE_WEB_DETAIL_PREFIX = "/search/products/";
export const SIGNUP_REFERRAL_CLAIM_PATH_PREFIX = "/r/";
export const SIGNUP_REFERRAL_CLAIM_PATH_SUFFIX = "/claim";

export const COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED";
export const COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ENV =
  "MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID";
export const MURPH_SAFE_SEARCH_WAF_RULE_ENV =
  "MURPH_SAFE_SEARCH_WAF_RULE_ID";
export const MURPH_SAFE_DETAIL_WAF_RULE_ENV =
  "MURPH_SAFE_DETAIL_WAF_RULE_ID";
export const SIGNUP_REFERRAL_CLAIM_WAF_RULE_ENV =
  "MURPH_SIGNUP_REFERRAL_CLAIM_WAF_RULE_ID";
export const PUBLIC_ROUTES_WAF_REQUIRED_ENV =
  "MURPH_PUBLIC_ROUTES_WAF_REQUIRED";

const VERCEL_PROJECT_ID_ENV = "HOSTED_WEB_VERCEL_PROJECT_ID";
const VERCEL_TEAM_ID_ENV = "HOSTED_WEB_VERCEL_TEAM_ID";
const VERCEL_TOKEN_ENV = "HOSTED_WEB_VERCEL_TOKEN";
const VERCEL_FIREWALL_CONFIG_URL =
  "https://api.vercel.com/v1/security/firewall/config/active";

const REQUIRED_WINDOW_SECONDS = 60;
const REQUIRED_ALGORITHM = "fixed_window";
const REQUIRED_RATE_LIMIT_KEY = "ip";

type EnvSource = Readonly<Record<string, string | undefined>>;
type FetchImplementation = typeof fetch;
type JsonRecord = Record<string, unknown>;
type PublicRoutesWafRuleIds = {
  companionDiagnosticsRuleId?: string;
  detailRuleId: string;
  searchRuleId: string;
  signupReferralClaimRuleId: string;
};
type RuleCondition = {
  neg?: true;
  op: "eq" | "pre" | "suf";
  type: "method" | "path";
  value: string;
};
type RuleSpec = {
  allowSafePredecessors?: true;
  conditionGroups: readonly (readonly RuleCondition[])[];
  id: string;
  label: string;
  limit: number;
};
type PublicRoutesWafPreflightDependencies = {
  fetch?: FetchImplementation;
  log?: (message: string) => void;
};

const COMPANION_DIAGNOSTICS_CONDITION_GROUPS = [[
  {
    op: "eq",
    type: "path",
    value: COMPANION_AUTH_DIAGNOSTICS_PATH,
  },
]] as const satisfies readonly (readonly RuleCondition[])[];

const MURPH_SAFE_SEARCH_CONDITION_GROUPS = [[
  { op: "eq", type: "path", value: MURPH_SAFE_SEARCH_PATH },
  { op: "eq", type: "method", value: "POST" },
]] as const satisfies readonly (readonly RuleCondition[])[];

const MURPH_SAFE_DETAIL_CONDITION_GROUPS = [
  [
    { op: "pre", type: "path", value: MURPH_SAFE_API_DETAIL_PREFIX },
    { neg: true, op: "eq", type: "path", value: MURPH_SAFE_SEARCH_PATH },
  ],
  [
    { op: "pre", type: "path", value: MURPH_SAFE_WEB_DETAIL_PREFIX },
  ],
] as const satisfies readonly (readonly RuleCondition[])[];

const SIGNUP_REFERRAL_CLAIM_CONDITION_GROUPS = [[
  { op: "pre", type: "path", value: SIGNUP_REFERRAL_CLAIM_PATH_PREFIX },
  { op: "suf", type: "path", value: SIGNUP_REFERRAL_CLAIM_PATH_SUFFIX },
  { op: "eq", type: "method", value: "POST" },
]] as const satisfies readonly (readonly RuleCondition[])[];

export function buildPublicRoutesWafConfigUrl(
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

export function validatePublicRoutesWafConfig(
  config: unknown,
  ruleIds: PublicRoutesWafRuleIds,
): string[] {
  const issues: string[] = [];
  if (!isRecord(config)) {
    return ["active configuration payload must be an object"];
  }

  if (config.firewallEnabled !== true) {
    issues.push("active firewall configuration is disabled");
  }

  const rules = readRules(config);
  const expectedRules = buildRuleSpecs(ruleIds);
  const activeRules = rules.filter((rule) => rule.active === true);

  for (const [expectedIndex, spec] of expectedRules.entries()) {
    const rule = rules.find((candidate) => candidate.id === spec.id);
    if (rule === undefined) {
      issues.push(`missing active rule ${spec.id}`);
      continue;
    }

    if (rule.active !== true) {
      issues.push(`${spec.label} rule is disabled`);
    } else if (activeRules[expectedIndex] !== rule) {
      const actualIndex = activeRules.indexOf(rule);
      const unexpectedPredecessors = activeRules.slice(expectedIndex, actualIndex);
      if (
        spec.allowSafePredecessors !== true
        || actualIndex < expectedIndex
        || unexpectedPredecessors.some(hasBypassAction)
      ) {
        issues.push(
          spec.allowSafePredecessors === true
            ? `${spec.label} rule must not follow an active bypass rule`
            : `${spec.label} rule must be active custom rule ${expectedIndex + 1}`,
        );
      }
    }

    if (rule.valid !== true) {
      issues.push(`${spec.label} rule is invalid`);
    }
    if (!hasExactConditionGroups(rule, spec.conditionGroups)) {
      issues.push(`${spec.label} rule has unexpected path or method conditions`);
    }
    if (!hasRequiredRateLimitAction(rule, spec.limit)) {
      issues.push(
        `${spec.label} rule must use a fixed-window IP 429 rate limit of ${spec.limit}/${REQUIRED_WINDOW_SECONDS}s without a persistent action`,
      );
    }
  }

  return issues;
}

export async function runPublicRoutesWafPreflight(
  source: EnvSource = env,
  dependencies: PublicRoutesWafPreflightDependencies = {},
): Promise<void> {
  const log = dependencies.log ?? console.log;
  const diagnosticsEnabled =
    normalizeOptionalString(source[COMPANION_AUTH_DIAGNOSTICS_ENABLED_ENV]) === "1";
  const wafRequired =
    normalizeOptionalString(source[PUBLIC_ROUTES_WAF_REQUIRED_ENV]) === "1";
  if (
    normalizeOptionalString(source.VERCEL_ENV) !== "production"
    && !diagnosticsEnabled
    && !wafRequired
  ) {
    log("Public routes WAF preflight skipped: non-production environment.");
    return;
  }

  const searchRuleId = requireEnvironmentVariable(
    source,
    MURPH_SAFE_SEARCH_WAF_RULE_ENV,
  );
  const detailRuleId = requireEnvironmentVariable(
    source,
    MURPH_SAFE_DETAIL_WAF_RULE_ENV,
  );
  const signupReferralClaimRuleId = requireEnvironmentVariable(
    source,
    SIGNUP_REFERRAL_CLAIM_WAF_RULE_ENV,
  );
  const companionDiagnosticsRuleId =
    diagnosticsEnabled
      ? requireEnvironmentVariable(source, COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ENV)
      : undefined;

  const ruleIds = {
    companionDiagnosticsRuleId,
    detailRuleId,
    searchRuleId,
    signupReferralClaimRuleId,
  } satisfies PublicRoutesWafRuleIds;
  assertDistinctRuleIds(ruleIds);

  const projectId = requireEnvironmentVariable(source, VERCEL_PROJECT_ID_ENV);
  const token = requireEnvironmentVariable(source, VERCEL_TOKEN_ENV);
  const fetchImplementation = dependencies.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchImplementation(buildPublicRoutesWafConfigUrl(
      projectId,
      normalizeOptionalString(source[VERCEL_TEAM_ID_ENV]) ?? undefined,
    ), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new Error("Unable to inspect Vercel WAF configuration.");
  }

  if (!response.ok) {
    throw new Error(
      `Unable to inspect Vercel WAF configuration: Vercel API returned ${response.status}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json() as unknown;
  } catch {
    throw new Error("Vercel WAF configuration response was not valid JSON.");
  }

  const issues = validatePublicRoutesWafConfig(parsed, ruleIds);
  if (issues.length > 0) {
    throw new Error(
      `Vercel WAF active configuration does not satisfy public route requirements: ${issues.join("; ")}.`,
    );
  }

  log("Public routes WAF preflight passed.");
}

function buildRuleSpecs(ruleIds: PublicRoutesWafRuleIds): RuleSpec[] {
  const specs: RuleSpec[] = [];
  if (ruleIds.companionDiagnosticsRuleId) {
    specs.push({
      conditionGroups: COMPANION_DIAGNOSTICS_CONDITION_GROUPS,
      id: ruleIds.companionDiagnosticsRuleId,
      label: "companion auth diagnostics",
      limit: 30,
    });
  }
  specs.push(
    {
      conditionGroups: MURPH_SAFE_SEARCH_CONDITION_GROUPS,
      id: ruleIds.searchRuleId,
      label: "Murph Safe search",
      limit: 30,
    },
    {
      conditionGroups: MURPH_SAFE_DETAIL_CONDITION_GROUPS,
      id: ruleIds.detailRuleId,
      label: "Murph Safe detail",
      limit: 120,
    },
    {
      allowSafePredecessors: true,
      conditionGroups: SIGNUP_REFERRAL_CLAIM_CONDITION_GROUPS,
      id: ruleIds.signupReferralClaimRuleId,
      label: "signup referral claim",
      limit: 10,
    },
  );
  return specs;
}

function assertDistinctRuleIds(ruleIds: PublicRoutesWafRuleIds): void {
  const ids = [
    ruleIds.companionDiagnosticsRuleId,
    ruleIds.searchRuleId,
    ruleIds.detailRuleId,
    ruleIds.signupReferralClaimRuleId,
  ].filter((value): value is string => value !== undefined);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Public route WAF rule IDs must be distinct.");
  }
}

function readRules(active: JsonRecord): JsonRecord[] {
  const rules = active.rules;
  return Array.isArray(rules)
    ? rules.filter(isRecord)
    : [];
}

function hasExactConditionGroups(
  rule: JsonRecord,
  expectedGroups: readonly (readonly RuleCondition[])[],
): boolean {
  const actualGroups = rule.conditionGroup;
  if (!Array.isArray(actualGroups) || actualGroups.length !== expectedGroups.length) {
    return false;
  }

  const actualKeys = actualGroups.map(readConditionGroupKey);
  if (actualKeys.some((key) => key === null)) {
    return false;
  }

  const expectedKeys = expectedGroups
    .map((group) => conditionGroupKey(group))
    .sort();
  return actualKeys.sort().join("|") === expectedKeys.join("|");
}

function readConditionGroupKey(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.conditions)) {
    return null;
  }

  const conditions: RuleCondition[] = [];
  for (const condition of value.conditions) {
    if (
      !isRecord(condition)
      || (
        condition.neg !== undefined
        && typeof condition.neg !== "boolean"
      )
    ) {
      return null;
    }
    if (
      (condition.type !== "path" && condition.type !== "method")
      || (
        condition.op !== "eq"
        && condition.op !== "pre"
        && condition.op !== "suf"
      )
      || typeof condition.value !== "string"
    ) {
      return null;
    }
    conditions.push({
      ...(condition.neg === true ? { neg: true } : {}),
      op: condition.op,
      type: condition.type,
      value: condition.value,
    });
  }

  return conditionGroupKey(conditions);
}

function conditionGroupKey(conditions: readonly RuleCondition[]): string {
  return conditions
    .map((condition) => `${condition.neg === true ? "!" : ""}${condition.type}:${condition.op}:${condition.value}`)
    .sort()
    .join("&");
}

function hasRequiredRateLimitAction(rule: JsonRecord, limit: number): boolean {
  const action = readRecord(rule, "action");
  const mitigate = action === null ? null : readRecord(action, "mitigate");
  if (mitigate === null || mitigate.action !== "rate_limit") {
    return false;
  }

  const rateLimit = readRecord(mitigate, "rateLimit");
  return rateLimit !== null
    && rateLimit.action === "rate_limit"
    && rateLimit.algo === REQUIRED_ALGORITHM
    && rateLimit.limit === limit
    && rateLimit.window === REQUIRED_WINDOW_SECONDS
    && Array.isArray(rateLimit.keys)
    && rateLimit.keys.length === 1
    && rateLimit.keys[0] === REQUIRED_RATE_LIMIT_KEY
    && (mitigate.actionDuration === undefined || mitigate.actionDuration === null)
    && mitigate.bypassSystem !== true;
}

function hasBypassAction(rule: JsonRecord): boolean {
  const action = readRecord(rule, "action");
  const mitigate = action === null ? null : readRecord(action, "mitigate");
  return mitigate?.action === "bypass";
}

function requireEnvironmentVariable(source: EnvSource, name: string): string {
  const value = normalizeOptionalString(source[name]);
  if (!value) {
    throw new Error(`${name} is required for the production public routes WAF preflight.`);
  }
  return value;
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  void runPublicRoutesWafPreflight().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Public routes WAF preflight failed.");
    exit(1);
  });
}
