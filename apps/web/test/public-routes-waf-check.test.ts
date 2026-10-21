import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  buildPublicRoutesWafConfigUrl,
  COMPANION_AUTH_DIAGNOSTICS_PATH,
  runPublicRoutesWafPreflight,
  SIGNUP_REFERRAL_CLAIM_PATH_PREFIX,
  SIGNUP_REFERRAL_CLAIM_PATH_SUFFIX,
  validatePublicRoutesWafConfig,
} from "../scripts/check-public-routes-waf";

const DIAGNOSTICS_RULE_ID = "rule_companion_auth_diagnostics";
const SIGNUP_REFERRAL_CLAIM_RULE_ID = "rule_signup_referral_claim";

type RuleIds = Parameters<typeof validatePublicRoutesWafConfig>[1];

const RULE_IDS: RuleIds = {
  signupReferralClaimRuleId: SIGNUP_REFERRAL_CLAIM_RULE_ID,
};

const RULE_IDS_WITH_DIAGNOSTICS: RuleIds = {
  companionDiagnosticsRuleId: DIAGNOSTICS_RULE_ID,
  signupReferralClaimRuleId: SIGNUP_REFERRAL_CLAIM_RULE_ID,
};

function rateLimitAction(limit: number): Record<string, unknown> {
  return {
    mitigate: {
      action: "rate_limit",
      rateLimit: {
        action: "rate_limit",
        algo: "fixed_window",
        keys: ["ip"],
        limit,
        window: 60,
      },
    },
  };
}

function validConfig(options: { diagnostics?: boolean } = {}): Record<string, unknown> {
  const rules: Record<string, unknown>[] = [];
  if (options.diagnostics) {
    rules.push({
      action: rateLimitAction(30),
      active: true,
      conditionGroup: [{
        conditions: [{
          op: "eq",
          type: "path",
          value: COMPANION_AUTH_DIAGNOSTICS_PATH,
        }],
      }],
      id: DIAGNOSTICS_RULE_ID,
      name: "Companion auth diagnostics",
      valid: true,
    });
  }
  rules.push(
    {
      action: rateLimitAction(10),
      active: true,
      conditionGroup: [{
        conditions: [
          { op: "eq", type: "method", value: "POST" },
          {
            op: "pre",
            type: "path",
            value: SIGNUP_REFERRAL_CLAIM_PATH_PREFIX,
          },
          {
            op: "suf",
            type: "path",
            value: SIGNUP_REFERRAL_CLAIM_PATH_SUFFIX,
          },
        ],
      }],
      id: SIGNUP_REFERRAL_CLAIM_RULE_ID,
      name: "Signup referral claim",
      valid: true,
    },
  );

  return {
    firewallEnabled: true,
    rules,
  };
}

function activeRules(config: Record<string, unknown>): Record<string, unknown>[] {
  return config.rules as Record<string, unknown>[];
}

function findRule(
  config: Record<string, unknown>,
  ruleId: string,
): Record<string, unknown> {
  const rule = activeRules(config).find((candidate) => candidate.id === ruleId);
  if (!rule) {
    throw new Error(`Missing fixture rule ${ruleId}`);
  }
  return rule;
}

function productionEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    HOSTED_WEB_VERCEL_PROJECT_ID: "project_test",
    HOSTED_WEB_VERCEL_TEAM_ID: "team_test",
    HOSTED_WEB_VERCEL_TOKEN: "token_test",
    MURPH_SIGNUP_REFERRAL_CLAIM_WAF_RULE_ID:
      SIGNUP_REFERRAL_CLAIM_RULE_ID,
    VERCEL_ENV: "production",
    ...overrides,
  };
}

describe("public routes WAF preflight", () => {
  it("accepts the signup referral rules with or without companion diagnostics", () => {
    expect(validatePublicRoutesWafConfig(validConfig(), RULE_IDS)).toEqual([]);
    expect(validatePublicRoutesWafConfig(
      validConfig({ diagnostics: true }),
      RULE_IDS_WITH_DIAGNOSTICS,
    )).toEqual([]);
  });

  it("rejects missing, disabled, invalid, and disabled-firewall rules", () => {
    const missing = validConfig();
    missing.rules = [];
    expect(validatePublicRoutesWafConfig(missing, RULE_IDS)).toContain(
      `missing active rule ${SIGNUP_REFERRAL_CLAIM_RULE_ID}`,
    );

    const nameOnly = validConfig();
    findRule(nameOnly, SIGNUP_REFERRAL_CLAIM_RULE_ID).id = "different_rule_id";
    expect(validatePublicRoutesWafConfig(nameOnly, RULE_IDS)).toContain(
      `missing active rule ${SIGNUP_REFERRAL_CLAIM_RULE_ID}`,
    );

    const disabled = validConfig();
    findRule(disabled, SIGNUP_REFERRAL_CLAIM_RULE_ID).active = false;
    expect(validatePublicRoutesWafConfig(disabled, RULE_IDS)).toContain(
      "signup referral claim rule is disabled",
    );

    const invalid = validConfig();
    findRule(invalid, SIGNUP_REFERRAL_CLAIM_RULE_ID).valid = false;
    expect(validatePublicRoutesWafConfig(invalid, RULE_IDS)).toContain(
      "signup referral claim rule is invalid",
    );

    const disabledFirewall = validConfig();
    disabledFirewall.firewallEnabled = false;
    expect(validatePublicRoutesWafConfig(disabledFirewall, RULE_IDS)).toContain(
      "active firewall configuration is disabled",
    );
  });

  it("fails closed when active status fields are absent", () => {
    const missingFirewallStatus = validConfig();
    delete missingFirewallStatus.firewallEnabled;
    expect(validatePublicRoutesWafConfig(missingFirewallStatus, RULE_IDS)).toContain(
      "active firewall configuration is disabled",
    );

    const missingRuleStatus = validConfig();
    delete findRule(missingRuleStatus, SIGNUP_REFERRAL_CLAIM_RULE_ID).active;
    expect(validatePublicRoutesWafConfig(missingRuleStatus, RULE_IDS)).toContain(
      "signup referral claim rule is disabled",
    );

    const missingRuleValidity = validConfig();
    delete findRule(missingRuleValidity, SIGNUP_REFERRAL_CLAIM_RULE_ID).valid;
    expect(validatePublicRoutesWafConfig(missingRuleValidity, RULE_IDS)).toContain(
      "signup referral claim rule is invalid",
    );
  });


  it("allows scoped rules before signup claims but rejects an active bypass", () => {
    const scopedPredecessor = validConfig();
    activeRules(scopedPredecessor).splice(0, 0, {
      action: rateLimitAction(5),
      active: true,
      conditionGroup: [{
        conditions: [{ op: "eq", type: "path", value: "/another-route" }],
      }],
      id: "scoped_rate_limit",
      valid: true,
    });
    expect(validatePublicRoutesWafConfig(scopedPredecessor, RULE_IDS)).toEqual([]);

    const bypassPredecessor = validConfig();
    activeRules(bypassPredecessor).splice(0, 0, {
      action: { mitigate: { action: "bypass" } },
      active: true,
      conditionGroup: [{ conditions: [] }],
      id: "broad_bypass",
      valid: true,
    });
    expect(validatePublicRoutesWafConfig(bypassPredecessor, RULE_IDS)).toContain(
      "signup referral claim rule must not follow an active bypass rule",
    );
  });



  it("requires the exact dynamic signup-claim path family and POST method", () => {
    const wrongSuffix = validConfig();
    const conditions = (
      findRule(wrongSuffix, SIGNUP_REFERRAL_CLAIM_RULE_ID)
        .conditionGroup as Array<{
          conditions: Array<Record<string, unknown>>;
        }>
    )[0].conditions;
    const suffix = conditions.find((condition) => condition.op === "suf");
    if (!suffix) {
      throw new Error("Missing signup referral suffix fixture.");
    }
    suffix.value = "/anything";
    expect(validatePublicRoutesWafConfig(wrongSuffix, RULE_IDS)).toContain(
      "signup referral claim rule has unexpected path or method conditions",
    );

    const broadPrefixOnly = validConfig();
    (
      findRule(broadPrefixOnly, SIGNUP_REFERRAL_CLAIM_RULE_ID)
        .conditionGroup as Array<{ conditions: unknown[] }>
    )[0].conditions.pop();
    expect(validatePublicRoutesWafConfig(broadPrefixOnly, RULE_IDS)).toContain(
      "signup referral claim rule has unexpected path or method conditions",
    );
  });

  it("rejects permissive actions and rate-limit drift", () => {
    const mutations: Array<(rateLimit: Record<string, unknown>) => void> = [
      (rateLimit) => { rateLimit.action = "log"; },
      (rateLimit) => { rateLimit.algo = "sliding_window"; },
      (rateLimit) => { rateLimit.keys = ["ip", "ja4"]; },
      (rateLimit) => { rateLimit.limit = 31; },
      (rateLimit) => { rateLimit.window = 61; },
    ];

    for (const mutate of mutations) {
      const overview = validConfig();
      const rateLimit = (
        findRule(overview, SIGNUP_REFERRAL_CLAIM_RULE_ID).action as {
          mitigate: { rateLimit: Record<string, unknown> };
        }
      ).mitigate.rateLimit;
      mutate(rateLimit);
      expect(validatePublicRoutesWafConfig(overview, RULE_IDS)).toContain(
        "signup referral claim rule must use a fixed-window IP 429 rate limit of 10/60s without a persistent action",
      );
    }

    const outerLog = validConfig();
    (
      findRule(outerLog, SIGNUP_REFERRAL_CLAIM_RULE_ID).action as {
        mitigate: Record<string, unknown>;
      }
    ).mitigate.action = "log";
    expect(validatePublicRoutesWafConfig(outerLog, RULE_IDS)).toContain(
      "signup referral claim rule must use a fixed-window IP 429 rate limit of 10/60s without a persistent action",
    );

    const persistent = validConfig();
    (
      findRule(persistent, SIGNUP_REFERRAL_CLAIM_RULE_ID).action as {
        mitigate: Record<string, unknown>;
      }
    ).mitigate.actionDuration = "5m";
    expect(validatePublicRoutesWafConfig(persistent, RULE_IDS)).toContain(
      "signup referral claim rule must use a fixed-window IP 429 rate limit of 10/60s without a persistent action",
    );
  });

  it("builds the project-scoped Vercel firewall configuration URL", () => {
    expect(buildPublicRoutesWafConfigUrl("project_test", "team_test")).toBe(
      "https://api.vercel.com/v1/security/firewall/config/active?projectId=project_test&teamId=team_test",
    );
    expect(buildPublicRoutesWafConfigUrl("project with spaces", undefined)).toBe(
      "https://api.vercel.com/v1/security/firewall/config/active?projectId=project+with+spaces",
    );
  });

  it("skips outside production without reading credentials or calling Vercel", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const log = vi.fn();

    await expect(runPublicRoutesWafPreflight(
      { VERCEL_ENV: "preview" },
      { fetch: fetchImplementation, log },
    )).resolves.toBeUndefined();
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Public routes WAF preflight skipped: non-production environment.",
    );
  });

  it("does not skip the WAF gate when production diagnostics are enabled", async () => {
    await expect(runPublicRoutesWafPreflight({
      ...productionEnvironment({ VERCEL_ENV: undefined }),
      MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED: "1",
      MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID: undefined,
      NODE_ENV: "production",
    })).rejects.toThrow(
      "MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID is required",
    );
  });

  it("honors the explicit production gate when Vercel system env is unavailable", async () => {
    await expect(runPublicRoutesWafPreflight({
      MURPH_PUBLIC_ROUTES_WAF_REQUIRED: "1",
    })).rejects.toThrow("MURPH_SIGNUP_REFERRAL_CLAIM_WAF_RULE_ID is required");
  });

  it("requires distinct production rule IDs and explicit management inputs", async () => {
    await expect(runPublicRoutesWafPreflight(productionEnvironment({
      MURPH_SIGNUP_REFERRAL_CLAIM_WAF_RULE_ID: undefined,
    }))).rejects.toThrow(
      "MURPH_SIGNUP_REFERRAL_CLAIM_WAF_RULE_ID is required",
    );

    await expect(runPublicRoutesWafPreflight(
      productionEnvironment({ HOSTED_WEB_VERCEL_TOKEN: undefined }),
    )).rejects.toThrow("HOSTED_WEB_VERCEL_TOKEN is required");

    await expect(runPublicRoutesWafPreflight(productionEnvironment({
      MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED: "1",
      MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID: SIGNUP_REFERRAL_CLAIM_RULE_ID,
    }))).rejects.toThrow("Public route WAF rule IDs must be distinct");

    await expect(runPublicRoutesWafPreflight(productionEnvironment({
      MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED: "1",
      MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID: undefined,
    }))).rejects.toThrow("MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID is required");
  });

  it("reads the active configuration once and passes only exact rule IDs", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(validConfig({ diagnostics: true })),
    );
    const log = vi.fn();

    await runPublicRoutesWafPreflight(productionEnvironment({
      MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED: "1",
      MURPH_COMPANION_AUTH_DIAGNOSTICS_WAF_RULE_ID: DIAGNOSTICS_RULE_ID,
    }), { fetch: fetchImplementation, log });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.vercel.com/v1/security/firewall/config/active?projectId=project_test&teamId=team_test",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer token_test",
        },
      }),
    );
    expect(log).toHaveBeenCalledWith("Public routes WAF preflight passed.");
  });

  it("reports only safe status-level failures for remote errors", async () => {
    const token = "sensitive_test_token";
    const statusFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private provider response", { status: 403 }),
    );
    const statusError = await runPublicRoutesWafPreflight(
      productionEnvironment({ HOSTED_WEB_VERCEL_TOKEN: token }),
      { fetch: statusFetch },
    ).catch((error: unknown) => error);
    expect(statusError).toBeInstanceOf(Error);
    expect((statusError as Error).message).toBe(
      "Unable to inspect Vercel WAF configuration: Vercel API returned 403.",
    );
    expect((statusError as Error).message).not.toContain(token);
    expect((statusError as Error).message).not.toContain("private provider response");

    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("request included a private URL"),
    );
    await expect(runPublicRoutesWafPreflight(
      productionEnvironment(),
      { fetch: networkFetch },
    )).rejects.toThrow("Unable to inspect Vercel WAF configuration.");

    const invalidJsonFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", { status: 200 }),
    );
    await expect(runPublicRoutesWafPreflight(
      productionEnvironment(),
      { fetch: invalidJsonFetch },
    )).rejects.toThrow("Vercel WAF configuration response was not valid JSON.");
  });

  it("keeps the consolidated preflight first in the production build", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["public-routes:waf-check"]).toContain(
      "check-public-routes-waf.ts",
    );
    expect(packageJson.scripts?.build).toMatch(
      /^pnpm public-routes:waf-check &&/u,
    );
    expect(packageJson.scripts?.["companion-auth-diagnostics:waf-check"]).toBeUndefined();
  });
});
