import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  buildHostedCustomInferenceModelAlias,
  isHostedInferenceAuthKind,
  isHostedInferenceProtocol,
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
