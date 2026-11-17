import type { GameIdea } from "./input";

export function ideaShape(text: string): string {
  return text.toLowerCase().replace(/[\d,.:]+/g, "#").replace(/\s+/g, " ");
}

/** Prefer at most n ideas that start with the same word, and never two that
 * differ only in a number ("20 layups" and "25 layups"). The word cap gives
 * way when it would leave fewer than 6 ideas. */
export function capLeads(list: GameIdea[], n = 4) {
  const seen = new Map();
  const shapes = new Set();
  const fresh = list.filter((it) => {
    const shape = ideaShape(it.text);
    if (shapes.has(shape)) return false;
    shapes.add(shape);
    return true;
  });
  const kept = fresh.filter((it) => {
    const lead = it.text.toLowerCase().split(/\s+/).find((w) => !/^(a|an|the|your|one|[\d,.:]+)$/.test(w)) || '';
    seen.set(lead, (seen.get(lead) || 0) + 1);
    return seen.get(lead)! <= n;
  });
  for (const it of fresh) if (kept.length < 6 && !kept.includes(it)) kept.push(it);
  return kept;
}
