import { describe, expect, it } from "vitest";

import {
  classifyHostedLinqProviderStatus,
  isHostedLinqProviderStatusAtRisk,
  isHostedLinqProviderStatusCritical,
  isHostedLinqProviderStatusHardBlocked,
  normalizeHostedLinqProviderStatus,
  rankHostedLinqProviderStatus,
} from "@/src/lib/hosted-onboarding/linq-provider-status";

describe("Hosted Linq provider status helpers", () => {
  it("normalizes case, whitespace, and hyphen variants", () => {
    expect(normalizeHostedLinqProviderStatus(" AT-RISK ")).toBe("at_risk");
    expect(normalizeHostedLinqProviderStatus("rate limited")).toBe("rate_limited");
  });

  it("classifies provider statuses into projected health", () => {
    expect(classifyHostedLinqProviderStatus("READY")).toBe("healthy");
    expect(classifyHostedLinqProviderStatus("at-risk")).toBe("degraded");
    expect(classifyHostedLinqProviderStatus("critical")).toBe("unhealthy");
    expect(classifyHostedLinqProviderStatus("unknown-provider-value")).toBe("unknown");
  });

  it("exposes exact dashboard buckets and hard-block matching", () => {
    expect(isHostedLinqProviderStatusAtRisk("AT_RISK")).toBe(true);
    expect(isHostedLinqProviderStatusCritical(" critical ")).toBe(true);
    expect(isHostedLinqProviderStatusHardBlocked("temporarily blocked")).toBe(true);
    expect(isHostedLinqProviderStatusHardBlocked("at_risk")).toBe(false);
  });

  it("ranks hard-blocked statuses above degraded statuses", () => {
    expect(rankHostedLinqProviderStatus("blocked"))
      .toBeGreaterThan(rankHostedLinqProviderStatus("at_risk"));
    expect(rankHostedLinqProviderStatus("at_risk"))
      .toBeGreaterThan(rankHostedLinqProviderStatus("active"));
  });
});
