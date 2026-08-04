import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  buildHostedCustomInferenceModelAlias,
  isHostedInferenceAuthKind,
  isHostedInferenceProtocol,
  normalizeHostedInferenceEndpointUrl,
  normalizeHostedInferenceModel,
  parseHostedAssistantCustomInferenceOverride,
  requireHostedInferenceContextWindowTokens,
} from "../src/assistant-inference.ts";

test("custom inference accepts only the two supported upstream protocols", () => {
  assert.equal(isHostedInferenceProtocol("responses"), true);
  assert.equal(isHostedInferenceProtocol("chat_completions"), true);
  assert.equal(isHostedInferenceProtocol("chat"), false);
  assert.equal(isHostedInferenceProtocol(null), false);
});

test("custom inference accepts only fixed authentication kinds", () => {
  assert.equal(isHostedInferenceAuthKind("bearer"), true);
  assert.equal(isHostedInferenceAuthKind("api_key"), true);
  assert.equal(isHostedInferenceAuthKind("x_api_key"), true);
  assert.equal(isHostedInferenceAuthKind("arbitrary_header"), false);
});

test("custom inference aliases are revision-derived and opaque", () => {
  assert.equal(buildHostedCustomInferenceModelAlias(7), "murph-custom-r7");
  assert.throws(
    () => buildHostedCustomInferenceModelAlias(0),
    /positive integer/u,
  );
});

test("custom inference endpoint policy accepts exact public HTTPS operations", () => {
  assert.equal(normalizeHostedInferenceEndpointUrl({
    protocol: "responses",
    value: "https://inference.example.com/v1/responses",
  }), "https://inference.example.com/v1/responses");
  assert.equal(normalizeHostedInferenceEndpointUrl({
    protocol: "chat_completions",
    value:
      "https://azure.example.com/openai/deployments/glm/chat/completions?api-version=2026-07-01",
  }),
  "https://azure.example.com/openai/deployments/glm/chat/completions?api-version=2026-07-01");
});

test("custom inference endpoint policy rejects unsafe destinations and shapes", () => {
  for (const value of [
    "http://inference.example.com/v1/responses",
    "https://127.0.0.1/v1/responses",
    "https://[::1]/v1/responses",
    "https://model.local/v1/responses",
    "https://web-control.worker/v1/responses",
    "https://withmurph.ai/v1/responses",
    "https://inference.example.com:8443/v1/responses",
    "https://inference.example.com/v1/chat/completions",
    "https://inference.example.com/v1/responses?token=secret",
  ]) {
    assert.throws(
      () => normalizeHostedInferenceEndpointUrl({ protocol: "responses", value }),
      /Hosted inference endpointUrl/u,
      value,
    );
  }
});

test("custom inference model ids are bounded and control-free", () => {
  assert.equal(normalizeHostedInferenceModel("glm-5.2"), "glm-5.2");
  assert.throws(() => normalizeHostedInferenceModel("glm\n5.2"), /model/u);
});

test("custom inference override parser preserves bounded non-secret facts", () => {
  assert.deepEqual(parseHostedAssistantCustomInferenceOverride({
    contextWindowTokens: 131_072,
    modelAlias: "murph-custom-r3",
    protocol: "chat_completions",
    revision: 3,
    supportsImages: false,
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  }), {
    contextWindowTokens: 131_072,
    modelAlias: "murph-custom-r3",
    protocol: "chat_completions",
    revision: 3,
    supportsImages: false,
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  });
});

test("custom inference override parser rejects alias and context drift", () => {
  assert.throws(
    () => parseHostedAssistantCustomInferenceOverride({
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r2",
      protocol: "responses",
      revision: 3,
      supportsImages: true,
      verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
    }),
    /modelAlias/u,
  );
  assert.throws(
    () => requireHostedInferenceContextWindowTokens(4_096),
    /contextWindowTokens/u,
  );
});

test("custom inference override parser rejects unknown fields", () => {
  assert.throws(
    () => parseHostedAssistantCustomInferenceOverride({
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r2",
      protocol: "responses",
      revision: 2,
      supportsImages: false,
      unexpected: true,
      verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
    }),
    /unknown fields/u,
  );
});
