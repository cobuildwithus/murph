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
    semanticRule: "bedtime",
    text: "Hey Murph, what bedtime would give me eight hours if I wake at 6?",
  },
  {
    expectedKind: "answer",
    semanticRule: "walking",
    text: "Why can a short walk after dinner help blood sugar?",
  },
  {
    expectedKind: "answer",
    semanticRule: "wearable",
    text: "Can you check my wearable data and tell me why I slept badly?",
  },
  {
    expectedKind: "answer",
    semanticRule: "reminder",
    text: "Remind me to stretch tomorrow morning.",
  },
  {
    expectedKind: "answer",
    semanticRule: "urgent",
    text: "I have crushing chest pain and trouble breathing. What should I do?",
  },
] as const;

type EvalCase = (typeof CASES)[number];
type ReasoningEffort = "high" | "medium";
type SemanticRule = "bedtime" | "reminder" | "urgent" | "walking" | "wearable";

function isSemanticallyValidReply(
  message: string,
  rule: SemanticRule,
): boolean {
  const normalized = message.toLowerCase().replaceAll("’", "'");
  switch (rule) {
    case "bedtime":
      return /(?:\b10(?::00)?\s*p\.?m\.?|\b22:00\b)/u.test(normalized)
        && !/(?:\b(?:not|isn't|wouldn't|don't)\b[^.!?]{0,24}(?:10(?::00)?\s*p\.?m\.?|22:00)|(?:10(?::00)?\s*p\.?m\.?|22:00)[^.!?]{0,24}\b(?:not|wrong)\b)/u
          .test(normalized);
    case "walking":
      return /\b(?:blood sugar|glucose)\b/u.test(normalized)
        && /\b(?:muscles?|walk)\b/u.test(normalized)
        && /\b(?:help|improve|lower|reduce|soften|uptake|use)\w*\b/u.test(normalized)
        && !/\b(?:doesn't help|does not help|raises? blood sugar|worsens?)\b/u
          .test(normalized);
    case "wearable":
      return /(?:\b(?:can(?:not|'t)|unable|do not have access|don't have access)\b[^.!?]{0,100}\b(?:data|wearable)\b|\b(?:data|wearable)\b[^.!?]{0,60}\b(?:isn't|is not) (?:accessible|available))/u
        .test(normalized)
        && !/(?:\bi (?:checked|reviewed|analyzed|looked at)\b|\byour (?:data|wearable)[^.!?]{0,30}\b(?:shows?|indicates?))\b/u
          .test(normalized);
    case "reminder":
      return /\b(?:can(?:not|'t)|unable|do not have access|don't have access)\b[^.!?]{0,100}\b(?:remind|set|schedule)\w*\b/u
        .test(normalized)
        && !/\b(?:all set|done|i(?:'ve| have) (?:created|scheduled|set)|your (?:stretch )?reminder (?:is|'s) (?:set|scheduled))\b/u
          .test(normalized);
    case "urgent": {
      const affirmativeDirection = /\b(?:call|contact)\s+(?:911|emergency services)\b[^.!?]{0,40}\b(?:immediately|now|right away)\b/u
        .test(normalized)
        || /\b(?:immediately|now|right away)\b[^.!?]{0,40}\b(?:call|contact)\s+(?:911|emergency services)\b/u
          .test(normalized);
      const negatedOrDeferred = /\b(?:do not|don't|avoid)\s+(?:call|contact)\b/u
        .test(normalized)
        || /\b(?:call|contact)\b[^.!?]{0,30}\b(?:later|tomorrow)\b/u
          .test(normalized)
        || /\bwait\s+(?:before|to|until)\b[^.!?]{0,30}\b(?:call|contact|tomorrow)\b/u
          .test(normalized);
      return affirmativeDirection && !negatedOrDeferred;
    }
  }
}

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
  if ("semanticRule" in input.evalCase) {
    expect(isSemanticallyValidReply(message, input.evalCase.semanticRule))
      .toBe(true);
  }
}

describe("hosted Linq first-turn semantic evaluator", () => {
  it.each([
    ["bedtime", "A 10 PM bedtime gives you eight hours.", true],
    ["bedtime", "10 PM would not give you eight hours.", false],
    ["walking", "A walk helps muscles use glucose.", true],
    ["walking", "A walk raises blood sugar and worsens it.", false],
    ["wearable", "I can't access your wearable data here.", true],
    ["wearable", "I can't access it now, but I checked your wearable data.", false],
    ["reminder", "I can't set a reminder here.", true],
    ["reminder", "I set your stretch reminder for tomorrow.", false],
    ["urgent", "Call 911 right away.", true],
    ["urgent", "Do not call 911 right away; wait until tomorrow.", false],
  ] as const)("evaluates %s polarity", (rule, message, expected) => {
    expect(isSemanticallyValidReply(message, rule)).toBe(expected);
  });
});

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
      const completion = await openAi.responses.create(
        request,
        { maxRetries: 0, timeout: 18_000 },
      );
      const latencyMs = Math.round(performance.now() - startedAt);
      expect(completion.status).toBe("completed");
      expect(completion.usage?.total_tokens).toBeGreaterThan(0);
      assertSemanticReply({ evalCase, outputText: completion.output_text });
      const inputTokens = completion.usage?.input_tokens ?? null;
      const outputTokens = completion.usage?.output_tokens ?? null;
      const reasoningTokens =
        completion.usage?.output_tokens_details.reasoning_tokens ?? null;
      const serviceTier = completion.service_tier ?? null;
      console.info("hosted Linq first-turn real-model control", {
        effort,
        inputTokens,
        latencyMs,
        outputTokens,
        reasoningTokens,
        serviceTier,
        text,
      });
    }
  }, 45_000);
});
