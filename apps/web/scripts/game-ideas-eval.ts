/** Live, synthetic-only eval; not in CI. Usage: game:ideas-eval [seed] [count=20] [--not-for-me]. */
import { CATEGORIES, RELATIONSHIPS, type GameIdeasInput } from "../src/lib/game/ideas/input";
import { writeGameIdeas } from "../src/lib/game/ideas/writer";

const seed = Number(process.argv[2] ?? Date.now() % 100000);
const count = Number(process.argv[3] ?? 20);
if (!Number.isSafeInteger(seed) || seed < 1 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
  console.error("Use a positive integer seed and a count from 1 to 100.");
  process.exit(2);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required. No files or production secrets are loaded.");
  process.exit(2);
}
let state = seed;
const rand = () => ((state = (state * 48271) % 2147483647) / 2147483647);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const TASK_WORDS = ["something with my dog", "we both hate running", "only 5 minutes a day", "eat more vegetables", "we have a newborn", "I work night shifts", "yoga", "basketball", "something we can do on a call"];
const STAKE_WORDS = ["food", "something embarrassing", "football", "something with the kids", "coffee", "a day off from chores"];
const TASK_DIRECTIONS = ["Easier", "Crazier", "Harder", "Outdoors", "At home", "At the gym", "Before bed", "Do it together", "Quick ones"];
const STAKE_DIRECTIONS = ["Cheaper", "Bigger", "Smaller", "Funnier", "Long distance", "Workout forfeit"];

function makeCase(): GameIdeasInput {
  const step = rand() < 0.55 ? "task" : rand() < 0.5 ? "prize" : "dare";
  return {
    step, category: pick(CATEGORIES), relationship: pick(RELATIONSHIPS), apart: rand() < 0.35,
    directions: rand() < 0.5 ? [pick(step === "task" ? TASK_DIRECTIONS : STAKE_DIRECTIONS)] : [],
    words: pick(step === "task" ? TASK_WORDS : STAKE_WORDS),
    ...(step === "task" ? {} : { task: pick(["20 squats", "Walk 30 min", "Meditate 10 min", "Cook dinner at home"]) }),
    skipped: [],
    ...(process.argv.includes("--not-for-me") ? { notForMe: ["swimming", "yoga", "dance"] as GameIdeasInput["notForMe"] } : {}),
  };
}

async function spin(ctx: GameIdeasInput) {
  const started = performance.now();
  const ideas = await writeGameIdeas(ctx);
  console.log(`${Math.round(performance.now() - started)} ms: ${ideas.map(idea => `${idea.text} [${idea.schedule}]`).join(" | ") || "EMPTY (fallback)"}`);
  return ideas;
}

async function main() {
  console.log(`seed ${seed}, ${count} cases`);
  // Sequential requests make the shared deadline visible without competing eval calls.
  for (let index = 0; index < count; index++) {
    const ctx = makeCase();
    const respin = rand() < 0.2;
    console.log(`${index + 1}. ${JSON.stringify(ctx)}`);
    const ideas = await spin(ctx);
    if (respin) await spin({ ...ctx, skipped: ideas.map(idea => idea.text) });
  }
}
main().catch(() => { console.error("Game ideas eval failed."); process.exitCode = 1; });
