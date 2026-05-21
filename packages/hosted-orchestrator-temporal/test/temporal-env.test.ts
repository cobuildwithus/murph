import { describe, expect, it } from "vitest";

import {
  readHostedRuntimeTemporalEnvironment,
} from "../src/temporal-env.js";

describe("readHostedRuntimeTemporalEnvironment", () => {
  it("uses explicit local defaults without secrets", () => {
    expect(readHostedRuntimeTemporalEnvironment({})).toEqual({
      address: "localhost:7233",
      namespace: "default",
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
      taskQueue: "hosted-runtime-local",
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
