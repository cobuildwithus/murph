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
