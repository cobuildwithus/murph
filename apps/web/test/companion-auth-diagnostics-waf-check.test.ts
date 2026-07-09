import { describe, expect, it } from "vitest";

import {
  buildCompanionAuthDiagnosticsWafOverviewCommand,
  COMPANION_AUTH_DIAGNOSTICS_PATH,
  validateCompanionAuthDiagnosticsWafOverview,
} from "../scripts/check-companion-auth-diagnostics-waf";

describe("companion auth diagnostics WAF preflight", () => {
  it("accepts an active exact-path fixed-window IP rate-limit rule", () => {
    expect(validateCompanionAuthDiagnosticsWafOverview({
      active: {
        enabled: true,
        rules: [
          {
            action: {
              mitigate: {
                action: "rate_limit",
                rateLimit: {
                  algorithm: "fixed_window",
                  keys: ["ip"],
                  limit: 30,
                  window: 60,
                },
              },
            },
            conditionGroup: {
              conditions: [
                {
                  key: "path",
                  op: "eq",
                  value: COMPANION_AUTH_DIAGNOSTICS_PATH,
                },
              ],
            },
            enabled: true,
            id: "rule_companion_auth_diagnostics",
            name: "Companion auth diagnostics",
            valid: true,
          },
        ],
      },
      draft: {
        rules: [],
      },
      enabled: true,
    }, "rule_companion_auth_diagnostics")).toEqual([]);
  });

  it("rejects draft-only rule proof", () => {
    expect(validateCompanionAuthDiagnosticsWafOverview({
      active: {
        enabled: true,
        rules: [],
      },
      draft: {
        rules: [
          {
            id: "rule_companion_auth_diagnostics",
          },
        ],
      },
      enabled: true,
    }, "rule_companion_auth_diagnostics")).toEqual([
      "missing active rule rule_companion_auth_diagnostics",
    ]);
  });

  it("rejects negated or excluding condition groups", () => {
    const baseRule = {
      action: {
        mitigate: {
          action: "rate_limit",
          rateLimit: {
            algorithm: "fixed_window",
            keys: ["ip"],
            limit: 30,
            window: 60,
          },
        },
      },
      enabled: true,
      id: "rule_companion_auth_diagnostics",
      valid: true,
    };

    expect(validateCompanionAuthDiagnosticsWafOverview({
      active: {
        rules: [
          {
            ...baseRule,
            conditions: [
              {
                key: "path",
                negated: true,
                op: "eq",
                value: COMPANION_AUTH_DIAGNOSTICS_PATH,
              },
            ],
          },
        ],
      },
    }, "rule_companion_auth_diagnostics")).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );

    expect(validateCompanionAuthDiagnosticsWafOverview({
      active: {
        rules: [
          {
            ...baseRule,
            conditions: [
              {
                key: "path",
                op: "eq",
                value: COMPANION_AUTH_DIAGNOSTICS_PATH,
              },
              {
                key: "method",
                op: "eq",
                value: "GET",
              },
            ],
          },
        ],
      },
    }, "rule_companion_auth_diagnostics")).toContain(
      `rule must match only exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
    );
  });

  it("rejects log-only or non-IP rate-limit actions", () => {
    expect(validateCompanionAuthDiagnosticsWafOverview({
      active: {
        rules: [
          {
            action: {
              mitigate: {
                action: "log",
                rateLimit: {
                  algorithm: "fixed_window",
                  keys: ["ip"],
                  limit: 30,
                  window: 60,
                },
              },
            },
            conditions: [
              {
                key: "path",
                op: "eq",
                value: COMPANION_AUTH_DIAGNOSTICS_PATH,
              },
            ],
            enabled: true,
            id: "rule_companion_auth_diagnostics",
            valid: true,
          },
        ],
      },
    }, "rule_companion_auth_diagnostics")).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );

    expect(validateCompanionAuthDiagnosticsWafOverview({
      active: {
        rules: [
          {
            action: {
              mitigate: {
                action: "rate_limit",
                rateLimit: {
                  algorithm: "fixed_window",
                  keys: ["path"],
                  limit: 30,
                  window: 60,
                },
              },
            },
            conditions: [
              {
                key: "path",
                op: "eq",
                value: COMPANION_AUTH_DIAGNOSTICS_PATH,
              },
            ],
            enabled: true,
            id: "rule_companion_auth_diagnostics",
            valid: true,
          },
        ],
      },
    }, "rule_companion_auth_diagnostics")).toContain(
      "missing fixed-window IP rate-limit action 30/60s",
    );
  });

  it("runs Vercel overview from the hosted web app directory", () => {
    const command = buildCompanionAuthDiagnosticsWafOverviewCommand();

    expect(command.command).toBe("pnpm");
    expect(command.args).toEqual([
      "exec",
      "vercel",
      "firewall",
      "overview",
      "--json",
    ]);
    expect(command.cwd.endsWith("/apps/web")).toBe(true);
  });
});
