import { describe, expect, it } from "vitest";

import {
  readHostedUserRuntimeWorkflowOptions,
  readHostedRuntimeTemporalEnvironment,
} from "../src/temporal-env.js";

describe("readHostedRuntimeTemporalEnvironment", () => {
  it("uses explicit local defaults without secrets", () => {
    expect(readHostedRuntimeTemporalEnvironment({})).toEqual({
      address: "localhost:7233",
      namespace: "default",
      prewarmTaskQueue: "murph-hosted-runtime-prewarm",
      taskQueue: "murph-hosted-runtime",
      tls: false,
    });
  });

  it("reads Temporal address, namespace, task queue, and TLS flag", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      TEMPORAL_ADDRESS: "temporal.example.test:7233",
      TEMPORAL_NAMESPACE: "hosted-local",
      TEMPORAL_TASK_QUEUE: "hosted-runtime-local",
      TEMPORAL_TLS_ENABLED: "true",
    })).toEqual({
      address: "temporal.example.test:7233",
      namespace: "hosted-local",
      prewarmTaskQueue: "hosted-runtime-local-prewarm",
      taskQueue: "hosted-runtime-local",
      tls: true,
    });
  });

  it("prefers hosted-prefixed Temporal env names over unprefixed compatibility names", () => {
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
      prewarmTaskQueue: "hosted-prefixed-queue-prewarm",
      taskQueue: "hosted-prefixed-queue",
      tls: true,
    });
  });

  it("enables TLS when a Temporal API key is configured", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      TEMPORAL_API_KEY: "temporal_test_api_key",
    })).toEqual({
      address: "localhost:7233",
      apiKey: "temporal_test_api_key",
      namespace: "default",
      prewarmTaskQueue: "murph-hosted-runtime-prewarm",
      taskQueue: "murph-hosted-runtime",
      tls: true,
    });
  });

  it("reads mTLS material from base64 env values", () => {
    const environment = readHostedRuntimeTemporalEnvironment({
      TEMPORAL_CLIENT_CERT_BASE64: Buffer.from("cert-pem").toString("base64"),
      TEMPORAL_CLIENT_KEY_BASE64: Buffer.from("key-pem").toString("base64"),
      TEMPORAL_SERVER_ROOT_CA_CERT_BASE64:
        Buffer.from("ca-pem").toString("base64"),
      TEMPORAL_TLS_SERVER_NAME_OVERRIDE: "temporal.example.test",
    });

    expect(environment.tls).toEqual({
      clientCertPair: {
        crt: Buffer.from("cert-pem"),
        key: Buffer.from("key-pem"),
      },
      serverNameOverride: "temporal.example.test",
      serverRootCACertificate: Buffer.from("ca-pem"),
    });
  });

  it("reads hosted-prefixed mTLS material from base64 env values", () => {
    const environment = readHostedRuntimeTemporalEnvironment({
      HOSTED_TEMPORAL_CLIENT_CERT_BASE64:
        Buffer.from("hosted-cert-pem").toString("base64"),
      HOSTED_TEMPORAL_CLIENT_KEY_BASE64:
        Buffer.from("hosted-key-pem").toString("base64"),
      HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64:
        Buffer.from("hosted-ca-pem").toString("base64"),
      HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE: "hosted-temporal.example.test",
    });

    expect(environment.tls).toEqual({
      clientCertPair: {
        crt: Buffer.from("hosted-cert-pem"),
        key: Buffer.from("hosted-key-pem"),
      },
      serverNameOverride: "hosted-temporal.example.test",
      serverRootCACertificate: Buffer.from("hosted-ca-pem"),
    });
  });

  it("rejects incomplete mTLS certificate pairs", () => {
    expect(() => readHostedRuntimeTemporalEnvironment({
      TEMPORAL_CLIENT_CERT_PEM: "cert-pem",
    })).toThrow(
      "TEMPORAL_CLIENT_CERT and TEMPORAL_CLIENT_KEY must be configured together.",
    );
  });

  it("rejects credentials with TLS explicitly disabled", () => {
    expect(() => readHostedRuntimeTemporalEnvironment({
      TEMPORAL_API_KEY: "temporal_test_api_key",
      TEMPORAL_TLS_ENABLED: "false",
    })).toThrow(
      "TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
    );
  });

  it("rejects ambiguous TLS values", () => {
    expect(() => readHostedRuntimeTemporalEnvironment({
      TEMPORAL_TLS_ENABLED: "sometimes",
    })).toThrow("TEMPORAL_TLS_ENABLED must be true or false.");

    expect(() => readHostedRuntimeTemporalEnvironment({
      HOSTED_TEMPORAL_TLS_ENABLED: "sometimes",
    })).toThrow("HOSTED_TEMPORAL_TLS_ENABLED must be true or false.");
  });

  it("accepts yes/no TLS aliases for shell ergonomics", () => {
    expect(readHostedRuntimeTemporalEnvironment({
      TEMPORAL_TLS_ENABLED: "yes",
    }).tls).toBe(true);
    expect(readHostedRuntimeTemporalEnvironment({
      TEMPORAL_TLS_ENABLED: "no",
    }).tls).toBe(false);
  });
});

describe("readHostedUserRuntimeWorkflowOptions", () => {
  it("reads shared workflow timing options", () => {
    expect(readHostedUserRuntimeWorkflowOptions({})).toEqual({
      ensureRuntimeProcessingStartToCloseTimeoutMs: 15_000,
      prewarmTaskQueue: "murph-hosted-runtime-prewarm",
      readRuntimeReconciliationFactsStartToCloseTimeoutMs: 10_000,
    });
  });

  it("reads the dedicated prewarm task queue from env", () => {
    expect(readHostedUserRuntimeWorkflowOptions({
      HOSTED_TEMPORAL_PREWARM_TASK_QUEUE: "hosted-prewarm-custom",
    })).toMatchObject({
      prewarmTaskQueue: "hosted-prewarm-custom",
    });
  });

  it("reads the ensure-processing timeout from env", () => {
    expect(readHostedUserRuntimeWorkflowOptions({
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: "12000",
    })).toMatchObject({
      ensureRuntimeProcessingStartToCloseTimeoutMs: 17_000,
    });
  });
});
