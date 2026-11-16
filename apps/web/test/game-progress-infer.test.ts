import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import cases from "./fixtures/progress-inference.json";
import { checkedMeasure, inferTask, normalizeTask, type InferredMeasure } from "../src/lib/game/progress/infer";

const checks = (values: number[]) => ({ answers: ["amount", "stated", "activity"].map((name, i) => ({ name, type: "predicate", probability: values[i] })) });
afterEach(() => vi.restoreAllMocks());

describe("Progress task inference", () => {
  it.each(cases)("accepts explicit evidence or stable days for $id", item => {
    const expected = item.expected as InferredMeasure;
    expect(checkedMeasure({ text: normalizeTask(item.text), kind: "photo" }, expected, checks([1, 1, 1]))).toEqual(expected);
  });
  it.each([[0.49, 1, 1], [1, 0.49, 1], [1, 1, 0.49]])("rejects a low decision probability %j", (...values) => {
    expect(checkedMeasure({ text: "100 pushups", kind: "photo" }, { quantity: 100, unit: "reps", name: "pushups" }, checks(values)))
      .toEqual({ quantity: null, unit: "days", name: "pushups" });
  });
  it("never accepts invented digits or an incomplete decision set", () => {
    const proposed: InferredMeasure = { quantity: 100, unit: "reps", name: "pushups" };
    expect(checkedMeasure({ text: "twenty pushups", kind: "photo" }, proposed, checks([1, 1, 1])).unit).toBe("days");
    expect(() => checkedMeasure({ text: "100 pushups", kind: "photo" }, proposed, { answers: checks([1, 1, 1]).answers.slice(1) })).toThrow();
    expect(() => checkedMeasure({ text: "100 pushups", kind: "photo" }, proposed, { answers: [checks([1])["answers"][0], ...checks([1])["answers"].slice(0, 2)] })).toThrow();
  });
  it("makes exactly one Responses and one Decisions call with retries and storage disabled", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const client = new OpenAI({ apiKey: "synthetic", maxRetries: 0, fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(String(url).endsWith("/decisions") ? checks([1, 1, 1]) : {
        status: "completed", output_text: JSON.stringify({ quantity: 10, unit: "minutes", name: "abs" }), output: [],
      });
    } });
    expect(await inferTask({ text: "10 min abs", kind: "photo" }, client)).toEqual({ quantity: 10, unit: "minutes", name: "abs" });
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({ store: false, model: "gpt-6-luna" });
    expect(calls[1].url).toContain("/decisions");
  });
  it("leaves provider failures unresolved, without logging or retrying", async () => {
    const fetch = vi.fn(async () => Response.json({ error: { message: "synthetic provider body" } }, { status: 503 }));
    const client = new OpenAI({ apiKey: "synthetic", fetch });
    const log = vi.spyOn(console, "error");
    expect(await inferTask({ text: "100 pushups", kind: "photo" }, client)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});
