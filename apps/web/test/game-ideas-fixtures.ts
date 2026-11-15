import { vi } from "vitest";
import type { GameIdea, GameIdeasInput } from "../src/lib/game/ideas/input";

export const INPUT: GameIdeasInput = { step: "task", category: "move", relationship: "friend", apart: false,
  directions: [], words: "we both hate running", skipped: [] };
export const TASKS: GameIdea[] = ["Walk 30 min", "Bike 20 min", "Swim 10 min", "Dance 15 min"]
  .map(text => ({ text, schedule: "weekdays" }));

export function written(ideas: unknown = TASKS, status = "completed") {
  return Response.json({ id: "resp_test", object: "response", status,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ ideas }) }] }],
  });
}
/** Decisions answers: each idea's good-for-the-pair probability, its dare
 * (not a favor) probability on dare checks, and its fit (default 1). */
export function checked(probabilities: number[] = [1, 1, 1, 1], options: { dare?: boolean; fits?: number[] } = {}) {
  return Response.json({ answers: probabilities.flatMap((probability, index) => [
    { name: `r${index}`, type: "predicate", probability },
    ...(options.dare ? [{ name: `d${index}`, type: "predicate", probability: 1 }] : []),
    { name: `f${index}`, type: "predicate", probability: options.fits?.[index] ?? 1 },
  ]) });
}

/** Delayed real SDK fetch responses honor abort, with one idea forcing the retry. */
export function delayedProvider(delays: number[]) {
  let index = 0;
  return vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    const call = index++;
    return new Promise((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => {
        init?.signal?.removeEventListener("abort", aborted);
        resolve(call % 2 === 0 ? written([TASKS[call === 0 ? 0 : 1]]) : checked([1]));
      }, delays[call] ?? 0);
      init?.signal?.addEventListener("abort", aborted, { once: true });
      if (init?.signal?.aborted) aborted();
    });
  });
}
