import { describe, expect, it } from "vitest";

import {
  parseCloudflareHostedInferenceVerificationRequest,
  parseCloudflareHostedInferenceVerificationResult,
} from "../src/inference-verification.ts";

const REQUEST = {
  auth: { kind: "x_api_key", secret: "synthetic-secret" },
  contextWindowTokens: 131_072,
  endpointUrl: "https://inference.example.test/v1/chat/completions",
  model: "example-model",
  protocol: "chat_completions",
  supportsImages: false,
} as const;

describe("custom inference verification contract", () => {
  it("normalizes one exact public endpoint request", () => {
    expect(parseCloudflareHostedInferenceVerificationRequest(REQUEST)).toEqual(
      REQUEST,
    );
  });

  it("rejects unknown fields, unsafe endpoints, and unsafe secrets", () => {
    expect(() =>
      parseCloudflareHostedInferenceVerificationRequest({
        ...REQUEST,
        extra: true,
      })
    ).toThrow(/unknown fields/u);
    expect(() =>
      parseCloudflareHostedInferenceVerificationRequest({
        ...REQUEST,
        endpointUrl: "https://127.0.0.1/v1/chat/completions",
      })
    ).toThrow(/public DNS hostname/u);
    expect(() =>
      parseCloudflareHostedInferenceVerificationRequest({
        ...REQUEST,
        auth: { kind: "bearer", secret: "unsafe\r\nheader" },
      })
    ).toThrow(/safe code points/u);
  });

  it("accepts only the current successful verification profile", () => {
    expect(parseCloudflareHostedInferenceVerificationResult({
      verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
      verified: true,
    })).toEqual({
      verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
      verified: true,
    });
    expect(() =>
      parseCloudflareHostedInferenceVerificationResult({
        verificationProfile: "stale-profile",
        verified: true,
      })
    ).toThrow(/invalid/u);
  });
});
