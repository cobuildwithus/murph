import { describe, expect, it } from "vitest";

import {
  readHostedOperationalAlertEmailConfig,
} from "@/src/lib/hosted-onboarding/operational-alert-email-config";

const alertEmailEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "first@example.test, second@example.test",
  RESEND_API_KEY: "re_test",
};

describe("hosted operational alert email config", () => {
  it("reads the shared Resend mailbox and clamps its timeout", () => {
    expect(readHostedOperationalAlertEmailConfig({
      ...alertEmailEnv,
      HOSTED_LINQ_ALERT_EMAIL_TIMEOUT_MS: "500",
    })).toEqual({
      recipients: ["first@example.test", "second@example.test"],
      resend: {
        apiKey: "re_test",
        from: "Murph Alerts <alerts@example.test>",
        timeoutMs: 1_000,
      },
    });
    expect(readHostedOperationalAlertEmailConfig({
      ...alertEmailEnv,
      HOSTED_LINQ_ALERT_EMAIL_TIMEOUT_MS: "50000",
    })).toMatchObject({
      resend: {
        timeoutMs: 30_000,
      },
    });
  });

  it("can reuse the transport with a feature-specific recipient list", () => {
    expect(readHostedOperationalAlertEmailConfig(
      {
        ...alertEmailEnv,
        HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS:
          "product@example.test, founder@example.test",
      },
      "HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS",
    )).toMatchObject({
      recipients: ["product@example.test", "founder@example.test"],
      resend: {
        apiKey: "re_test",
        from: "Murph Alerts <alerts@example.test>",
      },
    });
  });

  it.each([
    ["API key", { ...alertEmailEnv, RESEND_API_KEY: "" }],
    ["sender", { ...alertEmailEnv, HOSTED_LINQ_ALERT_EMAIL_FROM: "" }],
    ["recipient", { ...alertEmailEnv, HOSTED_LINQ_ALERT_EMAILS: "" }],
  ])("returns null without the %s", (_missing, env) => {
    expect(readHostedOperationalAlertEmailConfig(env)).toBeNull();
  });

  it("allows a loopback Resend origin only inside isolated hosted E2E", () => {
    expect(readHostedOperationalAlertEmailConfig({
      ...alertEmailEnv,
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL: "http://127.0.0.1:4321",
    })).toMatchObject({
      resend: {
        apiBaseUrl: "http://127.0.0.1:4321",
      },
    });

    expect(() => readHostedOperationalAlertEmailConfig({
      ...alertEmailEnv,
      MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL: "http://127.0.0.1:4321",
    })).toThrow("requires E2E isolation");
    expect(() => readHostedOperationalAlertEmailConfig({
      ...alertEmailEnv,
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL: "https://api.resend.com",
    })).toThrow("must be a loopback origin");
  });
});
