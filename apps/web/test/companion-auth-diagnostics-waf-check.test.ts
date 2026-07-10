import { describe, expect, it } from "vitest";

import {
  buildCompanionAuthDiagnosticsWafConfigUrl,
  COMPANION_AUTH_DIAGNOSTICS_PATH,
  validateCompanionAuthDiagnosticsWafOverview,
} from "../scripts/check-companion-auth-diagnostics-waf";

const RULE_REF = "rule_companion_auth_diagnostics";

function validOverview(): Record<string, unknown> {
  return {
    active: {
      firewallEnabled: true,
      rules: [
        {
          action: {
            mitigate: {
              action: "rate_limit",
              rateLimit: {
                action: "rate_limit",
                algo: "fixed_window",
                keys: ["ip"],
                limit: 30,
                window: 60,
              },
            },
          },
          active: true,
          conditionGroup: [
            {
              conditions: [
                {
                  op: "eq",
                  type: "path",
                  value: COMPANION_AUTH_DIAGNOSTICS_PATH,
                },
              ],
            },
          ],
          id: RULE_REF,
          name: "Companion auth diagnostics",
          valid: true,
        },
      ],
    },
    draft: { rules: [] },
  };
}

function activeRule(overview: Record<string, unknown>): Record<string, unknown> {
  const active = overview.active as { rules: Record<string, unknown>[] };
  return active.rules[0];
}

describe("companion auth diagnostics WAF preflight", () => {
  it("accepts the current Vercel exact-path fixed-window IP rule shape", () => {
    expect(validateCompanionAuthDiagnosticsWafOverview(
      validOverview(),
      RULE_REF,
    )).toEqual([]);
  });

  it("rejects missing, disabled, invalid, and draft-only rules", () => {
    const missing = validOverview();
    (missing.active as { rules: unknown[] }).rules = [];
    (missing.draft as { rules: unknown[] }).rules = [{ id: RULE_REF }];
    expect(validateCompanionAuthDiagnosticsWafOverview(missing, RULE_REF)).toContain(
      `missing active rule ${RULE_REF}`,
    );

    const disabledFirewall = validOverview();
    (disabledFirewall.active as { firewallEnabled: boolean }).firewallEnabled = false;
    expect(validateCompanionAuthDiagnosticsWafOverview(
      disabledFirewall,
      RULE_REF,
    )).toContain("active firewall configuration is disabled");

    const disabledRule = validOverview();
    activeRule(disabledRule).active = false;
    expect(validateCompanionAuthDiagnosticsWafOverview(disabledRule, RULE_REF)).toContain(
      "rule is disabled",
    );

    const invalidRule = validOverview();
    activeRule(invalidRule).valid = false;
    expect(validateCompanionAuthDiagnosticsWafOverview(invalidRule, RULE_REF)).toContain(
      "rule is invalid",
    );
  });

  it("fails closed when firewall or rule status fields are absent", () => {
    const missingFirewallStatus = validOverview();
    delete (missingFirewallStatus.active as Record<string, unknown>).firewallEnabled;
    expect(validateCompanionAuthDiagnosticsWafOverview(
      missingFirewallStatus,
      RULE_REF,
    )).toContain("active firewall configuration is disabled");

    const missingRuleStatus = validOverview();
    delete activeRule(missingRuleStatus).active;
    expect(validateCompanionAuthDiagnosticsWafOverview(missingRuleStatus, RULE_REF)).toContain(
      "rule is disabled",
    );

    const missingRuleValidity = validOverview();
    delete activeRule(missingRuleValidity).valid;
    expect(validateCompanionAuthDiagnosticsWafOverview(missingRuleValidity, RULE_REF)).toContain(
      "rule is invalid",
    );
  });

  it("rejects a diagnostics rule that is not the first custom rule", () => {
    const overview = validOverview();
    (overview.active as { rules: unknown[] }).rules.unshift({
      action: { mitigate: { action: "bypass" } },
      active: true,
      conditionGroup: [{ conditions: [] }],
      id: "bypass_before_diagnostics",
      name: "Broad bypass",
      valid: true,
    });

    expect(validateCompanionAuthDiagnosticsWafOverview(overview, RULE_REF)).toContain(
      "rule must be the first active custom rule",
    );
  });

  it("ignores disabled rules before the diagnostics rule", () => {
    const overview = validOverview();
    (overview.active as { rules: unknown[] }).rules.unshift({
      action: { mitigate: { action: "bypass" } },
      active: false,
      conditionGroup: [{ conditions: [] }],
      id: "disabled_bypass_before_diagnostics",
      name: "Disabled bypass",
      valid: true,
    });

    expect(validateCompanionAuthDiagnosticsWafOverview(overview, RULE_REF)).toEqual([]);
  });

  it("rejects legacy, extra, or non-exact condition groups", () => {
    const legacyObject = validOverview();
    activeRule(legacyObject).conditionGroup = {
      conditions: [{
        op: "eq",
        type: "path",
        value: COMPANION_AUTH_DIAGNOSTICS_PATH,
      }],
    };
    expect(validateCompanionAuthDiagnosticsWafOverview(legacyObject, RULE_REF)).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );

    const extraCondition = validOverview();
    const groups = activeRule(extraCondition).conditionGroup as Array<{
      conditions: unknown[];
    }>;
    groups[0].conditions.push({ op: "eq", type: "method", value: "POST" });
    expect(validateCompanionAuthDiagnosticsWafOverview(extraCondition, RULE_REF)).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );

    const nonExact = validOverview();
    const condition = (
      activeRule(nonExact).conditionGroup as Array<{
        conditions: Array<Record<string, unknown>>;
      }>
    )[0].conditions[0];
    condition.op = "pre";
    expect(validateCompanionAuthDiagnosticsWafOverview(nonExact, RULE_REF)).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );

    const negated = validOverview();
    const negatedCondition = (
      activeRule(negated).conditionGroup as Array<{
        conditions: Array<Record<string, unknown>>;
      }>
    )[0].conditions[0];
    negatedCondition.neg = true;
    expect(validateCompanionAuthDiagnosticsWafOverview(negated, RULE_REF)).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );

    const wrongType = validOverview();
    const wrongTypeCondition = (
      activeRule(wrongType).conditionGroup as Array<{
        conditions: Array<Record<string, unknown>>;
      }>
    )[0].conditions[0];
    wrongTypeCondition.type = "method";
    expect(validateCompanionAuthDiagnosticsWafOverview(wrongType, RULE_REF)).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );

    const wrongPath = validOverview();
    const wrongPathCondition = (
      activeRule(wrongPath).conditionGroup as Array<{
        conditions: Array<Record<string, unknown>>;
      }>
    )[0].conditions[0];
    wrongPathCondition.value = `${COMPANION_AUTH_DIAGNOSTICS_PATH}/nested`;
    expect(validateCompanionAuthDiagnosticsWafOverview(wrongPath, RULE_REF)).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );
  });

  it("rejects log-only, permissive, or differently keyed rate limits", () => {
    const outerLog = validOverview();
    const outerMitigate = (
      activeRule(outerLog).action as {
        mitigate: Record<string, unknown>;
      }
    ).mitigate;
    outerMitigate.action = "log";
    expect(validateCompanionAuthDiagnosticsWafOverview(outerLog, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    const innerLog = validOverview();
    const innerLimit = (
      (activeRule(innerLog).action as {
        mitigate: { rateLimit: Record<string, unknown> };
      }).mitigate.rateLimit
    );
    innerLimit.action = "log";
    expect(validateCompanionAuthDiagnosticsWafOverview(innerLog, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    const extraKey = validOverview();
    const extraKeyLimit = (
      (activeRule(extraKey).action as {
        mitigate: { rateLimit: Record<string, unknown> };
      }).mitigate.rateLimit
    );
    extraKeyLimit.keys = ["ip", "ja4"];
    expect(validateCompanionAuthDiagnosticsWafOverview(extraKey, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    const looseLimit = validOverview();
    const looseRateLimit = (
      (activeRule(looseLimit).action as {
        mitigate: { rateLimit: Record<string, unknown> };
      }).mitigate.rateLimit
    );
    looseRateLimit.limit = 31;
    expect(validateCompanionAuthDiagnosticsWafOverview(looseLimit, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    const slidingWindow = validOverview();
    const slidingRateLimit = (
      (activeRule(slidingWindow).action as {
        mitigate: { rateLimit: Record<string, unknown> };
      }).mitigate.rateLimit
    );
    slidingRateLimit.algo = "sliding_window";
    expect(validateCompanionAuthDiagnosticsWafOverview(slidingWindow, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    const looseWindow = validOverview();
    const looseWindowRateLimit = (
      (activeRule(looseWindow).action as {
        mitigate: { rateLimit: Record<string, unknown> };
      }).mitigate.rateLimit
    );
    looseWindowRateLimit.window = 61;
    expect(validateCompanionAuthDiagnosticsWafOverview(looseWindow, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    const wrongKey = validOverview();
    const wrongKeyRateLimit = (
      (activeRule(wrongKey).action as {
        mitigate: { rateLimit: Record<string, unknown> };
      }).mitigate.rateLimit
    );
    wrongKeyRateLimit.keys = ["ja4"];
    expect(validateCompanionAuthDiagnosticsWafOverview(wrongKey, RULE_REF)).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );
  });

  it("builds the project-scoped Vercel firewall configuration URL", () => {
    expect(buildCompanionAuthDiagnosticsWafConfigUrl(
      "project_test",
      "team_test",
    )).toBe(
      "https://api.vercel.com/v1/security/firewall/config?projectId=project_test&teamId=team_test",
    );
    expect(buildCompanionAuthDiagnosticsWafConfigUrl(
      "project with spaces",
      undefined,
    )).toBe(
      "https://api.vercel.com/v1/security/firewall/config?projectId=project+with+spaces",
    );
  });
});
