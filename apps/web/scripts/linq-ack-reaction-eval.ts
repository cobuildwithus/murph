/**
 * Live eval for the Linq ack-reaction classifier: runs the production prompt
 * against the real OpenAI Decisions API and scores it against the labeled set.
 *
 *   OPENAI_API_KEY=... pnpm --dir apps/web linq:ack-reaction-eval [--runs 2]
 *
 * Fails (exit 1) on any false reaction, on a wrong emoji, below 95% recall on
 * must-react messages, or on any burst miss beyond one. Not part of CI: it
 * needs a real key and costs about a cent per run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyHostedLinqAckReaction,
  HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS,
  stepHostedLinqAckReactionBurst,
  type HostedLinqAckReactionDecision,
} from "../src/lib/hosted-onboarding/linq-ack-reaction-classifier";
import {
  HOSTED_LINQ_ACK_REACTION_EVAL_BURSTS,
  HOSTED_LINQ_ACK_REACTION_EVAL_CASES,
  type HostedLinqAckReactionEvalCase,
} from "./linq-ack-reaction-eval-cases";

// pnpm runs this from the repo root (see the apps/web package script).
const FIXTURE_DIR = path.resolve("apps/web/scripts/fixtures/linq-ack-reaction");
const CONCURRENCY = 6;
const MIN_MUST_REACT_RECALL = 0.95;
const MAX_BURST_MISSES = 1;

type Message = { image?: string; text: string };
// decision is null when the call missed the production cutoff (dropped = quiet).
type Timed = { decision: HostedLinqAckReactionDecision | null; ms: number };

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.error("OPENAI_API_KEY is required.");
  process.exit(2);
}
const runsFlag = process.argv.indexOf("--runs");
const runs = runsFlag > 0 ? Math.max(1, Number(process.argv[runsFlag + 1]) || 1) : 1;

const imageCache = new Map<string, string>();
function imageUrl(stem: string): string {
  let url = imageCache.get(stem);
  if (!url) {
    url = `data:image/jpeg;base64,${readFileSync(path.join(FIXTURE_DIR, `${stem}.jpg`)).toString("base64")}`;
    imageCache.set(stem, url);
  }
  return url;
}

async function classify(message: Message): Promise<Timed> {
  const startedAt = performance.now();
  let decision: HostedLinqAckReactionDecision | null;
  try {
    decision = await classifyHostedLinqAckReaction({
      apiKey: apiKey!,
      message: { imageUrls: message.image ? [imageUrl(message.image)] : [], text: message.text },
      signal: AbortSignal.timeout(HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS),
    });
  } catch (error) {
    // The SDK reports the abort as APIUserAbortError; a bare fetch as TimeoutError.
    if (!["APIUserAbortError", "TimeoutError"].includes((error as { name?: string }).name ?? "")) throw error;
    decision = null;
  }
  if (decision === null && performance.now() - startedAt < HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS) {
    throw new Error(`Unparseable decision for ${JSON.stringify(message.text)}`);
  }
  return { decision, ms: Math.round(performance.now() - startedAt) };
}

async function mapLimited<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

function describe(message: Message): string {
  return `${message.image ? `[${message.image} photo] ` : ""}${message.text}`.slice(0, 72);
}

function scoreCases(cases: readonly HostedLinqAckReactionEvalCase[], timed: readonly Timed[]) {
  const failures: string[] = [];
  let mustReact = 0;
  let mustReactHit = 0;
  let falseReacts = 0;
  let wrongEmoji = 0;
  let dropped = 0;
  cases.forEach((testCase, index) => {
    const { decision } = timed[index]!;
    if (!decision) {
      dropped += 1;
      if (!Array.isArray(testCase.expect) && testCase.expect !== "none") mustReact += 1;
      if (testCase.expect !== "none") {
        failures.push(`dropped at ${HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS}ms: ${describe(testCase)}`);
      }
      return;
    }
    const reacted = stepHostedLinqAckReactionBurst({ acked: false, heavySeen: false }, decision).emoji !== null;
    const got = reacted ? decision.kind : "none";
    const line = `${describe(testCase)} → ${got} (kind=${decision.kind} heavy=${decision.heavy.toFixed(2)})`;
    if (Array.isArray(testCase.expect)) {
      if (!testCase.expect.includes(got)) {
        wrongEmoji += 1;
        failures.push(`soft case off-list: ${line}; allowed ${testCase.expect.join("|")}`);
      }
      return;
    }
    if (testCase.expect === "none") {
      if (reacted) {
        falseReacts += 1;
        failures.push(`false reaction: ${line}`);
      }
      return;
    }
    mustReact += 1;
    if (got === testCase.expect) {
      mustReactHit += 1;
    } else if (reacted) {
      wrongEmoji += 1;
      failures.push(`wrong emoji: ${line}; want ${String(testCase.expect)}`);
    } else {
      failures.push(`missed: ${line}; want ${String(testCase.expect)}`);
    }
  });
  return { dropped, failures, falseReacts, mustReact, mustReactHit, wrongEmoji };
}

async function scoreBursts() {
  const failures: string[] = [];
  const latencies: number[] = [];
  let misses = 0;
  for (const burst of HOSTED_LINQ_ACK_REACTION_EVAL_BURSTS) {
    const timed = await Promise.all(burst.messages.map(classify));
    latencies.push(...timed.map((entry) => entry.ms));
    const state = { acked: false, heavySeen: false };
    let reaction: { at: number; kind: string } | null = null;
    timed.forEach(({ decision }, at) => {
      if (!decision) return;
      const step = stepHostedLinqAckReactionBurst(state, decision);
      state.heavySeen ||= step.heavy;
      if (step.emoji && !state.acked) {
        state.acked = true;
        reaction = { at, kind: decision.kind };
      }
    });
    const got = reaction as { at: number; kind: string } | null;
    const want = burst.expect;
    const ok = want === "none"
      ? got === null
      : (got !== null && got.kind === want.kind && want.at.includes(got.at))
        || (got === null && burst.alt === "none");
    if (!ok) {
      misses += 1;
      failures.push(`burst ${burst.messages.map(describe).join(" | ")} → ${got ? `${got.kind}@${got.at}` : "quiet"}; want ${want === "none" ? "quiet" : `${want.kind}@${want.at.join("/")}`}`);
    }
  }
  return { failures, latencies, misses };
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

async function main(): Promise<boolean> {
let failed = false;
for (let run = 1; run <= runs; run += 1) {
  const timed = await mapLimited(HOSTED_LINQ_ACK_REACTION_EVAL_CASES, classify);
  const cases = scoreCases(HOSTED_LINQ_ACK_REACTION_EVAL_CASES, timed);
  const bursts = await scoreBursts();
  const latencies = [...timed.map((entry) => entry.ms), ...bursts.latencies];
  const recall = cases.mustReact === 0 ? 1 : cases.mustReactHit / cases.mustReact;
  console.log(`\nrun ${run}/${runs}`);
  console.log(`  must-react: ${cases.mustReactHit}/${cases.mustReact} (${(recall * 100).toFixed(1)}%)`);
  console.log(`  false reactions: ${cases.falseReacts}   wrong emoji: ${cases.wrongEmoji}   dropped >${HOSTED_LINQ_ACK_REACTION_CLASSIFY_TIMEOUT_MS}ms: ${cases.dropped}`);
  console.log(`  bursts: ${HOSTED_LINQ_ACK_REACTION_EVAL_BURSTS.length - bursts.misses}/${HOSTED_LINQ_ACK_REACTION_EVAL_BURSTS.length}`);
  console.log(`  latency ms: p50 ${percentile(latencies, 0.5)}  p90 ${percentile(latencies, 0.9)}  p99 ${percentile(latencies, 0.99)}  (n=${latencies.length})`);
  for (const failure of [...cases.failures, ...bursts.failures]) console.log(`  ✗ ${failure}`);
  if (
    cases.falseReacts > 0
    || cases.wrongEmoji > 0
    || recall < MIN_MUST_REACT_RECALL
    || bursts.misses > MAX_BURST_MISSES
  ) {
    failed = true;
  }
}
return failed;
}

void main().then((failed) => {
  console.log(failed ? "\nFAIL" : "\nPASS");
  process.exit(failed ? 1 : 0);
}, (error: unknown) => {
  console.error(error);
  process.exit(1);
});
