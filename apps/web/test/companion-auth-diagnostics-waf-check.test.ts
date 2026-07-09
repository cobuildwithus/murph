import { describe, expect, it } from "vitest";

import {
  COMPANION_AUTH_DIAGNOSTICS_PATH,
  validateCompanionAuthDiagnosticsWafRule,
} from "../scripts/check-companion-auth-diagnostics-waf";

describe("companion auth diagnostics WAF preflight", () => {
  it("accepts an exact-path fixed-window rate-limit rule", () => {
    expect(validateCompanionAuthDiagnosticsWafRule({
      action: {
        status: 429,
        type: "rate_limit",
      },
      conditions: [
        {
          key: "path",
          op: "eq",
          value: COMPANION_AUTH_DIAGNOSTICS_PATH,
        },
      ],
      enabled: true,
      rateLimit: {
        limit: 30,
        window: {
          unit: "seconds",
          value: 60,
        },
      },
    })).toEqual([]);
  });

  it("rejects a missing or disabled rule proof", () => {
    expect(validateCompanionAuthDiagnosticsWafRule({
      action: { status: 429, type: "rate_limit" },
      conditions: [{ key: "path", op: "prefix", value: "/api/device-sync/companion" }],
      enabled: false,
      rateLimit: { limit: 300, window: { unit: "minutes", value: 1 } },
    })).toEqual([
      `missing exact path ${COMPANION_AUTH_DIAGNOSTICS_PATH}`,
      "missing request limit 30",
      "missing 60-second fixed window",
      "rule appears disabled at enabled",
    ]);
  });
});
