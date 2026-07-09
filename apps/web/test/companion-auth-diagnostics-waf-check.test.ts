import { describe, expect, it } from "vitest";

import {
  buildCompanionAuthDiagnosticsWafInspectCommand,
  COMPANION_AUTH_DIAGNOSTICS_PATH,
  validateCompanionAuthDiagnosticsWafRule,
} from "../scripts/check-companion-auth-diagnostics-waf";

describe("companion auth diagnostics WAF preflight", () => {
  it("accepts an exact-path fixed-window rate-limit rule", () => {
    expect(validateCompanionAuthDiagnosticsWafRule({
      action: {
        type: "rate_limit",
        rateLimit: {
          limit: 30,
          responseStatus: 429,
          window: {
            unit: "seconds",
            value: 60,
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
    })).toEqual([]);
  });

  it("rejects a missing or disabled rule proof", () => {
    expect(validateCompanionAuthDiagnosticsWafRule({
      action: { status: 429, type: "rate_limit" },
      conditions: [{ key: "path", op: "prefix", value: "/api/device-sync/companion" }],
      enabled: false,
      rateLimit: { limit: 300, window: { unit: "minutes", value: 1 } },
    })).toEqual([
      "rule is disabled",
      `missing exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
      "missing rate-limit action 30/60s with 429",
    ]);
  });

  it("rejects decoys where rule facts are not one exact-path rate-limit rule", () => {
    expect(validateCompanionAuthDiagnosticsWafRule({
      action: { type: "log" },
      conditions: [
        {
          op: "pre",
          type: "path",
          value: COMPANION_AUTH_DIAGNOSTICS_PATH,
        },
      ],
      description: `${COMPANION_AUTH_DIAGNOSTICS_PATH} rate limit 30 60 429`,
      enabled: true,
      metadata: {
        rateLimit: {
          limit: 30,
          responseStatus: 429,
          window: 60,
        },
      },
      name: COMPANION_AUTH_DIAGNOSTICS_PATH,
    })).toEqual([
      `missing exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
      "missing rate-limit action 30/60s with 429",
    ]);
  });

  it("runs Vercel inspection from the hosted web app directory", () => {
    const command = buildCompanionAuthDiagnosticsWafInspectCommand("rule_name");

    expect(command.command).toBe("pnpm");
    expect(command.args).toEqual([
      "exec",
      "vercel",
      "firewall",
      "rules",
      "inspect",
      "rule_name",
      "--json",
    ]);
    expect(command.cwd.endsWith("/apps/web")).toBe(true);
  });
});
