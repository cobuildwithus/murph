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
  { expectedKind: "answer", text: "Yes, ready", opening: { tone: "formal", question: "identity" } },
  { expectedKind: "handoff", text: "Yes, I want to get stronger", opening: { tone: "formal", question: "identity" } },
  { expectedKind: "handoff", text: "Call me Robin, I am 34", opening: { tone: "formal", question: "identity" } },
  { expectedKind: "handoff", text: "Can you help with a symptom first?", opening: { tone: "formal", question: "identity" } },
  { expectedKind: "handoff", text: "I would rather skip these questions", opening: { tone: "formal", question: "identity" } },
  { expectedKind: "answer", text: "Morgan, 29, nonbinary", opening: { tone: "formal", question: "aspiration" } },
  { expectedKind: "answer", text: "Just call me Morgan", opening: { tone: "casual", question: "aspiration" } },
  { expectedKind: "answer", text: "Skip name and age for now", opening: { tone: "formal", question: "aspiration" } },
  { expectedKind: "handoff", text: "Morgan, 29. I want more energy", opening: { tone: "formal", question: "aspiration" } },
  { expectedKind: "handoff", text: "Morgan. I have chest pain and cannot breathe", opening: { tone: "formal", question: "aspiration" } },
  { expectedKind: "handoff", text: "I do not want to continue this setup", opening: { tone: "formal", question: "aspiration" } },
  { expectedKind: "welcome", text: "What can you help me with?" },
  {
    expectedKind: "answer",
    text: "Hey Murph, what bedtime would give me eight hours if I wake at 6?",
  },
  {
    expectedKind: "answer",
    text: "Why can a short walk after dinner help blood sugar?",
  },
  {
    expectedKind: "answer",
    text: "Can you check my wearable data and tell me why I slept badly?",
  },
  {
    expectedKind: "answer",
    text: "Remind me to stretch tomorrow morning.",
  },
  {
    expectedKind: "answer",
    text: "I have crushing chest pain and trouble breathing. What should I do?",
  },
] as const;

describeRealModel("hosted Linq instant first-turn real-model semantics", () => {
  it.each(CASES)("classifies and answers: $text", async (scenario) => {
    const { expectedKind, text } = scenario;
    const apiKey =
      process.env.HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY
      ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "A Web-owned OpenAI API key is required for the opted real-model eval.",
      );
    }
    const openAi = new OpenAI({ apiKey, maxRetries: 0 });
    const response = await openAi.responses.create(
      buildHostedLinqInstantFirstTurnOpenAiBody({
        text,
        ...("opening" in scenario ? { opening: scenario.opening } : {}),
      }),
      { maxRetries: 0, timeout: 18_000 },
    );
    expect(response.status).toBe("completed");
    const parsed: unknown = JSON.parse(response.output_text);
    expect(parsed).toEqual(expect.objectContaining({
      kind: expectedKind,
      message: expect.any(String),
    }));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected structured first-turn model output.");
    }
    if (!("message" in parsed)) {
      throw new Error("Expected first-turn model message field.");
    }
    const message = parsed.message;
    expect(typeof message).toBe("string");
    if (typeof message !== "string") {
      throw new Error("Expected first-turn model text.");
    }
    expect(message.length).toBeLessThanOrEqual(600);
    expect(message).not.toMatch(/https?:\/\//iu);
    expect(message).not.toMatch(/\b(?:luna|model|prompt|container|routing)\b/iu);
  }, 25_000);
});
