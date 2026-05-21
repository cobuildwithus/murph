import { describe, expect, it } from "vitest";

import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "../src/orchestration-control.ts";
import {
  HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS,
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
});

describe("readHostedRuntimeTemporalWorkflowOptions", () => {
  it("reads shared workflow timing options", () => {
    expect(readHostedRuntimeTemporalWorkflowOptions({
      HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "120000",
      HOSTED_RUNTIME_DEMAND_TIMEOUT_MS: "15000",
      HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS: "5000",
      HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS: "45000",
    })).toEqual({
      ensureCloudflareExecutionStartToCloseTimeoutMs: 125_000,
      readRuntimeDemandStartToCloseTimeoutMs: 15_000,
      runtimeCompletedFailureRecheckDelayMs: 45_000,
    });
  });

  it("bounds runtime demand and failed-completion retry delays", () => {
    expect(() => readHostedRuntimeTemporalWorkflowOptions({
      HOSTED_RUNTIME_DEMAND_TIMEOUT_MS: "30001",
    })).toThrow(
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS must be less than or equal to 30000.",
    );

    expect(() => readHostedRuntimeTemporalWorkflowOptions({
      HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS: "3600001",
    })).toThrow(
      "HOSTED_TEMPORAL_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS must be less than or equal to 3600000.",
    );
  });
});
