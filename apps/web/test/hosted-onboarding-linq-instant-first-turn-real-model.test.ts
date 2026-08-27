import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import {
  buildHostedLinqInstantFirstTurnOpenAiBody,
} from "@/src/lib/hosted-onboarding/linq-instant-first-turn";

const RUN_REAL_MODEL =
  process.env.MURPH_RUN_REAL_LINQ_FIRST_TURN_EVAL === "1";
const describeRealModel = RUN_REAL_MODEL ? describe : describe.skip;

const CASES = [
  { expectedKind: "welcome", text: "Hey Murph" },
  { expectedKind: "welcome", text: "What can you help me with?" },
  {
    expectedKind: "answer",
    requiredPatterns: [/(?:\b10(?::00)?\s*p\.?m\.?|\b22:00\b)/iu],
    text: "Hey Murph, what bedtime would give me eight hours if I wake at 6?",
  },
  {
    expectedKind: "answer",
    requiredPatterns: [/\b(?:blood sugar|glucose)\b/iu, /\b(?:muscles?|walk)\b/iu],
    text: "Why can a short walk after dinner help blood sugar?",
  },
  {
    expectedKind: "answer",
    requiredPatterns: [
      /\b(?:can(?:not|'t)|unable|do not have access|don't have access)\b[\s\S]*\b(?:data|wearable)\b/iu,
    ],
    text: "Can you check my wearable data and tell me why I slept badly?",
  },
  {
    expectedKind: "answer",
    forbiddenPatterns: [
      /\b(?:all set|done|i(?:'ve| have) (?:created|scheduled|set)|your (?:stretch )?reminder (?:is|'s) (?:set|scheduled))\b/iu,
    ],
    requiredPatterns: [
      /\b(?:can(?:not|'t)|unable|do not have access|don't have access)\b[\s\S]*\b(?:remind|set|schedule)\b/iu,
    ],
    text: "Remind me to stretch tomorrow morning.",
  },
  {
    expectedKind: "answer",
    requiredPatterns: [
      /\b(?:911|emergency services)\b/iu,
      /\b(?:immediately|now|right away)\b/iu,
    ],
    text: "I have crushing chest pain and trouble breathing. What should I do?",
  },
] as const;

type EvalCase = (typeof CASES)[number];
type ReasoningEffort = "high" | "medium";

function assertSemanticReply(input: {
  evalCase: EvalCase;
  outputText: string;
}): void {
  const parsed: unknown = JSON.parse(input.outputText);
  expect(parsed).toEqual(expect.objectContaining({
    kind: input.evalCase.expectedKind,
    message: expect.any(String),
  }));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected structured first-turn model output.");
  }
  if (!("message" in parsed) || typeof parsed.message !== "string") {
    throw new Error("Expected first-turn model text.");
  }
  const message = parsed.message;
  expect(message.length).toBeLessThanOrEqual(600);
  expect(message).not.toMatch(/https?:\/\//iu);
  expect(message).not.toMatch(/\b(?:luna|model|prompt|container|routing)\b/iu);
  if ("requiredPatterns" in input.evalCase) {
    for (const pattern of input.evalCase.requiredPatterns) {
      expect(message).toMatch(pattern);
    }
  }
  if ("forbiddenPatterns" in input.evalCase) {
    for (const pattern of input.evalCase.forbiddenPatterns) {
      expect(message).not.toMatch(pattern);
    }
  }
}

describeRealModel("hosted Linq instant first-turn real-model semantics", () => {
  it.each(CASES)("classifies and answers: $text", async (evalCase) => {
    const { text } = evalCase;
    const apiKey =
      process.env.HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY
      ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "A Web-owned OpenAI API key is required for the opted real-model eval.",
      );
    }
    const openAi = new OpenAI({ apiKey, maxRetries: 0 });
    for (const effort of ["medium", "high"] as const satisfies readonly ReasoningEffort[]) {
      const request = buildHostedLinqInstantFirstTurnOpenAiBody({ text });
      request.reasoning = { ...request.reasoning, effort };
      const startedAt = performance.now();
      const response = await openAi.responses.create(
        request,
        { maxRetries: 0, timeout: 18_000 },
      );
      const latencyMs = Math.round(performance.now() - startedAt);
      expect(response.status).toBe("completed");
      expect(response.usage?.total_tokens).toBeGreaterThan(0);
      assertSemanticReply({ evalCase, outputText: response.output_text });
      console.info("hosted Linq first-turn real-model control", {
        effort,
        inputTokens: response.usage?.input_tokens ?? null,
        latencyMs,
        outputTokens: response.usage?.output_tokens ?? null,
        reasoningTokens:
          response.usage?.output_tokens_details.reasoning_tokens ?? null,
        serviceTier: response.service_tier ?? null,
        text,
      });
    }
  }, 45_000);
});
