import OpenAI, { APIError, APIUserAbortError } from "openai";
import { describe, expect, it, vi } from "vitest";

import {
  buildHostedLinqAckReactionDecisionsRequest,
  classifyHostedLinqAckReaction,
  parseHostedLinqAckReactionDecision,
  stepHostedLinqAckReactionBurst,
} from "@/src/lib/hosted-onboarding/linq-ack-reaction-classifier";

function answers(kind: string, heavy: number) {
  return {
    answers: [
      { name: "heavy", probability: heavy, type: "predicate" },
      { choice: kind, confidence: 0.9, name: "kind", type: "choice" },
    ],
  };
}

describe("linq ack reaction classifier", () => {
  it("sends the image before the text and asks the heavy and kind questions", () => {
    const request = buildHostedLinqAckReactionDecisionsRequest({
      imageUrls: ["https://cdn.example.test/a.jpg"],
      text: "  how many cals  ",
    }) as { input: Array<{ content: unknown; role: string }>; model: string; questions: Array<{ name: string; type: string }> };

    expect(request.model).toBe("gpt-6-luna");
    expect(request.input[1]).toEqual({
      content: [
        { image_url: "https://cdn.example.test/a.jpg", type: "input_image" },
        { text: "how many cals", type: "input_text" },
      ],
      role: "user",
    });
    expect(request.questions.map((question) => `${question.name}:${question.type}`))
      .toEqual(["heavy:predicate", "kind:choice"]);
  });

  it("maps reacting kinds to their emoji and keeps log, none, and heavy quiet", () => {
    expect(parseHostedLinqAckReactionDecision(answers("reminder", 0.01))?.emoji).toBe("⏰");
    expect(parseHostedLinqAckReactionDecision(answers("song", 0.2))?.emoji).toBe("🎶");
    expect(parseHostedLinqAckReactionDecision(answers("log", 0))?.emoji).toBeNull();
    expect(parseHostedLinqAckReactionDecision(answers("none", 0))?.emoji).toBeNull();
    expect(parseHostedLinqAckReactionDecision(answers("reminder", 0.5))?.emoji).toBeNull();
  });

  it("returns null for refusals, unknown kinds, and malformed payloads", () => {
    expect(parseHostedLinqAckReactionDecision({ answers: [{ name: "kind", type: "refusal" }] })).toBeNull();
    expect(parseHostedLinqAckReactionDecision(answers("dance", 0))).toBeNull();
    expect(parseHostedLinqAckReactionDecision({ answers: "nope" })).toBeNull();
    expect(parseHostedLinqAckReactionDecision(null)).toBeNull();
  });

  it("allows one emoji per burst and silences the rest after a heavy message", () => {
    const reminder = parseHostedLinqAckReactionDecision(answers("reminder", 0))!;
    const heavyTask = parseHostedLinqAckReactionDecision(answers("reminder", 0.9))!;

    expect(stepHostedLinqAckReactionBurst({ acked: false, heavySeen: false }, reminder))
      .toEqual({ emoji: "⏰", heavy: false });
    expect(stepHostedLinqAckReactionBurst({ acked: true, heavySeen: false }, reminder).emoji).toBeNull();
    expect(stepHostedLinqAckReactionBurst({ acked: false, heavySeen: true }, reminder).emoji).toBeNull();
    expect(stepHostedLinqAckReactionBurst({ acked: false, heavySeen: false }, heavyTask))
      .toEqual({ emoji: null, heavy: true });
  });

  it("posts through the OpenAI SDK with the key and abort signal, and never retries", async () => {
    const fetchStub = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(answers("my_data", 0)))
      .mockResolvedValueOnce(Response.json({ error: { message: "busy" } }, { status: 429 }));
    const client = new OpenAI({ apiKey: "sk-test", fetch: fetchStub, maxRetries: 0 });
    const message = { imageUrls: [], text: "how did i sleep" };

    const decision = await classifyHostedLinqAckReaction({
      apiKey: "sk-test",
      client,
      message,
      signal: new AbortController().signal,
    });
    expect(decision).toMatchObject({ emoji: "📊", kind: "my_data" });
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/decisions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-6-luna" });

    await expect(classifyHostedLinqAckReaction({
      apiKey: "sk-test",
      client,
      message,
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(APIError);
    expect(fetchStub).toHaveBeenCalledTimes(2);

    const aborted = new AbortController();
    aborted.abort();
    await expect(classifyHostedLinqAckReaction({
      apiKey: "sk-test",
      client,
      message,
      signal: aborted.signal,
    })).rejects.toBeInstanceOf(APIUserAbortError);
  });
});
