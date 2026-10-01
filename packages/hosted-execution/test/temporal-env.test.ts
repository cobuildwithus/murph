import { describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "../src/orchestration-control.ts";
import {
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
  HOSTED_RUNTIME_RECONCILIATION_FACTS_HTTP_TIMEOUT_MS,
  HOSTED_RUNTIME_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS,
  HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS,
  HOSTED_TEMPORAL_ENSURE_PROCESSING_REPORTING_SLACK_MS,
  readHostedRuntimeEnsureProcessingTimeouts,
  readHostedRuntimeTemporalEnvironment,
  readHostedRuntimeTemporalWorkflowOptions,
} from "../src/temporal-env.ts";

describe("readHostedRuntimeTemporalEnvironment", () => {
  it("uses caller-provided address defaults without enabling TLS", () => {
    expect(readHostedRuntimeTemporalEnvironment({}, {
      defaultAddress: HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS,
    })).toEqual({
      address: "localhost:7233",
      apiKey: null,
      namespace: "default",
      taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
      tls: false,
    });
  });

  it("allows callers to keep Temporal disabled with a null default address", () => {
    expect(readHostedRuntimeTemporalEnvironment({}, {
      defaultAddress: null,
    })).toMatchObject({
      address: null,
      apiKey: null,
      tls: false,
    });
  });

  it("prefers hosted-prefixed names over unprefixed compatibility names", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      HOSTED_TEMPORAL_ADDRESS: "hosted-temporal.example.test:7233",
      HOSTED_TEMPORAL_API_KEY: "hosted_temporal_test_api_key",
      HOSTED_TEMPORAL_NAMESPACE: "hosted-prefixed",
      HOSTED_TEMPORAL_TASK_QUEUE: "hosted-prefixed-queue",
      HOSTED_TEMPORAL_TLS_ENABLED: "true",
      TEMPORAL_ADDRESS: "temporal.example.test:7233",
      TEMPORAL_API_KEY: "temporal_test_api_key",
      TEMPORAL_NAMESPACE: "plain",
      TEMPORAL_TASK_QUEUE: "plain-queue",
      TEMPORAL_TLS_ENABLED: "false",
    })).toEqual({
      address: "hosted-temporal.example.test:7233",
      apiKey: "hosted_temporal_test_api_key",
      namespace: "hosted-prefixed",
      taskQueue: "hosted-prefixed-queue",
      tls: true,
    });
  });

  it("enables TLS when a Temporal API key is configured", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      TEMPORAL_API_KEY: "temporal_test_api_key",
    })).toMatchObject({
      apiKey: "temporal_test_api_key",
      tls: true,
    });
  });

  it("reads mTLS material from base64 env values", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      TEMPORAL_CLIENT_CERT_BASE64: Buffer.from("cert-pem").toString("base64"),
      TEMPORAL_CLIENT_KEY_BASE64: Buffer.from("key-pem").toString("base64"),
      TEMPORAL_SERVER_ROOT_CA_CERT_BASE64:
        Buffer.from("ca-pem").toString("base64"),
      TEMPORAL_TLS_SERVER_NAME_OVERRIDE: "temporal.example.test",
    }).tls).toEqual({
      clientCertPair: {
        crt: Buffer.from("cert-pem"),
        key: Buffer.from("key-pem"),
      },
      serverNameOverride: "temporal.example.test",
      serverRootCACertificate: Buffer.from("ca-pem"),
    });
  });

  it("lets hosted-prefixed mTLS material outrank legacy fallback material", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      HOSTED_TEMPORAL_CLIENT_CERT_PEM: "hosted-cert-pem",
      HOSTED_TEMPORAL_CLIENT_KEY_PEM: "hosted-key-pem",
      HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM: "hosted-ca-pem",
      HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE: "hosted-temporal.example.test",
      TEMPORAL_CLIENT_CERT_BASE64:
        Buffer.from("legacy-cert-pem").toString("base64"),
      TEMPORAL_CLIENT_KEY_BASE64:
        Buffer.from("legacy-key-pem").toString("base64"),
      TEMPORAL_SERVER_ROOT_CA_CERT_BASE64:
        Buffer.from("legacy-ca-pem").toString("base64"),
      TEMPORAL_TLS_SERVER_NAME_OVERRIDE: "legacy-temporal.example.test",
    }).tls).toEqual({
      clientCertPair: {
        crt: Buffer.from("hosted-cert-pem"),
        key: Buffer.from("hosted-key-pem"),
      },
      serverNameOverride: "hosted-temporal.example.test",
      serverRootCACertificate: Buffer.from("hosted-ca-pem"),
    });
  });

  it("rejects invalid TLS combinations", () => {
    expect(() => readHostedRuntimeTemporalEnvironment({
      HOSTED_TEMPORAL_API_KEY: "hosted_temporal_test_api_key",
      HOSTED_TEMPORAL_TLS_ENABLED: "false",
    })).toThrow(
      "HOSTED_TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
    );

    expect(() => readHostedRuntimeTemporalEnvironment({
      TEMPORAL_CLIENT_CERT_PEM: "cert-pem",
    })).toThrow(
      "TEMPORAL_CLIENT_CERT and TEMPORAL_CLIENT_KEY must be configured together.",
    );

    expect(() => readHostedRuntimeTemporalEnvironment({
      TEMPORAL_TLS_ENABLED: "sometimes",
    })).toThrow("TEMPORAL_TLS_ENABLED must be true or false.");
  });

  it("rejects explicitly disabled TLS when TLS material is configured", () => {
    expect(() => readHostedRuntimeTemporalEnvironment({
      TEMPORAL_CLIENT_CERT_PEM: "cert-pem",
      TEMPORAL_CLIENT_KEY_PEM: "key-pem",
      TEMPORAL_TLS_ENABLED: "false",
    })).toThrow(
      "TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
    );

    expect(() => readHostedRuntimeTemporalEnvironment({
      HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM: "ca-pem",
      HOSTED_TEMPORAL_TLS_ENABLED: "false",
    })).toThrow(
      "HOSTED_TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
    );
  });
});

describe("readHostedRuntimeTemporalWorkflowOptions", () => {
  it("defaults ensure-processing to the twenty-second caller budget", () => {
    expect(readHostedRuntimeEnsureProcessingTimeouts({})).toEqual({
      ensureRuntimeProcessingHttpTimeoutMs: 20_000,
      ensureRuntimeProcessingStartToCloseTimeoutMs: 25_000,
    });
  });

  it("keeps ensure-processing Activity Start-To-Close above its internal HTTP timeout", () => {
    const timeouts = readHostedRuntimeEnsureProcessingTimeouts({
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: "12000",
    });

    expect(timeouts).toEqual({
      ensureRuntimeProcessingHttpTimeoutMs: 12_000,
      ensureRuntimeProcessingStartToCloseTimeoutMs: 17_000,
    });
    expect(
      timeouts.ensureRuntimeProcessingStartToCloseTimeoutMs
      - timeouts.ensureRuntimeProcessingHttpTimeoutMs,
    ).toBe(HOSTED_TEMPORAL_ENSURE_PROCESSING_REPORTING_SLACK_MS);
  });

  it("keeps reconciliation HTTP below its fixed Activity deadline", () => {
    expect(HOSTED_RUNTIME_RECONCILIATION_FACTS_HTTP_TIMEOUT_MS).toBe(55_000);
    expect(HOSTED_RUNTIME_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS).toBe(
      60_000,
    );
    expect(readHostedRuntimeTemporalWorkflowOptions({
      HOSTED_RUNTIME_DEMAND_TIMEOUT_MS: "removed",
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: "12000",
      HOSTED_RUNTIME_RECONCILIATION_FACTS_TIMEOUT_MS: "removed",
    })).toEqual({
      ensureRuntimeProcessingStartToCloseTimeoutMs: 17_000,
      readRuntimeReconciliationFactsStartToCloseTimeoutMs: 60_000,
    });
    expect(
      HOSTED_RUNTIME_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS
      - HOSTED_RUNTIME_RECONCILIATION_FACTS_HTTP_TIMEOUT_MS,
    ).toBe(
      HOSTED_TEMPORAL_ENSURE_PROCESSING_REPORTING_SLACK_MS,
    );
  });

  it("bounds ensure-processing HTTP timeout budgets", () => {
    expect(() => readHostedRuntimeEnsureProcessingTimeouts({
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: "30001",
    })).toThrow(
      "HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS must be less than or equal to 30000.",
    );
  });

  it("rejects ensure-processing HTTP timeout budgets that cannot leave the response margin", () => {
    expect(() => readHostedRuntimeEnsureProcessingTimeouts({
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: String(HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS),
    })).toThrow(
      `HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS must be greater than ${HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS}.`,
    );

    expect(readHostedRuntimeEnsureProcessingTimeouts({
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: String(HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS + 1),
    }).ensureRuntimeProcessingHttpTimeoutMs).toBe(
      HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS + 1,
    );
  });
});
