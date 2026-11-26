import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import OpenAI from "openai";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { GAME_IDEAS_MODEL } from "../game/ideas/writer";
import { createHostedOpaqueDigest, readHostedContactPrivacyCurrentVersion } from "../hosted-onboarding/contact-privacy";
import { getPrisma } from "../prisma";
import type { RecordedActivityKind } from "./engine/types";

const TIMEOUT_MS = 3_000;
const choices = [
  { value: "run", description: "On foot, faster than walking." },
  { value: "walk", description: "On foot at walking pace." },
  { value: "sauna", description: "Sitting in heat." },
  { value: "cold_plunge", description: "Immersion in cold water." },
  { value: "lift", description: "Strength training." },
  { value: "other", description: "A sport, class, game or anything else." },
] as const satisfies readonly { value: RecordedActivityKind; description: string }[];
const kindSchema = z.enum(choices.map(choice => choice.value));
const probability = z.number().min(0).max(1);
const predicate = z.literal("predicate");
const response = z.object({ answers: z.array(z.discriminatedUnion("name", [
  z.strictObject({ type: z.literal("choice"), name: z.literal("kind"),
    choice: kindSchema.optional(), confidence: probability.optional(),
    probabilities: z.array(z.strictObject({ value: kindSchema, probability })).length(choices.length)
      .refine(items => new Set(items.map(item => item.value)).size === choices.length) }),
  z.strictObject({ type: predicate, name: z.literal("route"), probability }),
  z.strictObject({ type: predicate, name: z.literal("timer"), probability }),
])).length(3) });

async function ask(name: string, apiKey: string, requestSignal: AbortSignal) {
  try {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(TIMEOUT_MS)]);
    signal.throwIfAborted();
    const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0, logLevel: "off" });
    const payload = await client.post<unknown>("/decisions", { signal, timeout: TIMEOUT_MS, maxRetries: 0, body: {
      model: GAME_IDEAS_MODEL,
      input: "Choose how a phone should record the activity in each question.",
      questions: [
        { type: "choice", name: "kind", choices,
          instructions: `Which is "${name}" closest to, as a phone would record it?` },
        { type: "predicate", name: "route",
          instructions: `Is "${name}" usually done on foot, covering distance outdoors, so a map, distance and pace per kilometre make sense?` },
        { type: "predicate", name: "timer",
          instructions: `Is "${name}" usually done against a countdown timer for a set number of minutes?` },
      ],
    } });
    signal.throwIfAborted();
    const { answers } = response.parse(payload);
    const closest = answers.find(answer => answer.name === "kind");
    const route = answers.find(answer => answer.name === "route");
    const timer = answers.find(answer => answer.name === "timer");
    if (!closest || !route || !timer) return null;
    const best = closest.probabilities.reduce((a, b) => a.probability >= b.probability ? a : b);
    return { kind: best.value, route: route.probability >= 0.5, timer: timer.probability >= 0.5 };
  } catch {
    return null;
  }
}

/** Classify an admitted name. Cache the provider's answer before applying member capabilities. */
export async function decideHealthActivityKind({ name, memberId, routeEnabled, signal }: {
  name: string; memberId: string; routeEnabled: boolean; signal: AbortSignal;
}) {
  const fallback = { name, kind: "other" as const, timer: false, decided: false };
  const apiKey = process.env.OPENAI_API_KEY;
  if (process.env.MURPH_HEALTH_ACTIVITY_DECISIONS !== "true" || !apiKey || signal.aborted) return fallback;
  const lookup = name.normalize("NFKC").toLowerCase();
  const digest = createHostedOpaqueDigest("health-activity-name", lookup);
  const key = `name:v1:${readHostedContactPrivacyCurrentVersion()}:${digest}`;
  const db = getPrisma();
  const query = { where: { key }, select: { kind: true, route: true, timer: true } } as const;
  let stored = await db.healthActivityKindDecision.findUnique(query);
  if (!stored) {
    if (signal.aborted) return fallback;
    const budget = await hostedAuthRateLimitStorage(db).consume(`health-activity-kind:member:${memberId}`, { max: 30, window: 86_400 });
    if (!budget.allowed) return fallback;
    const answer = await ask(name, apiKey, signal);
    if (!answer) return fallback;
    await db.healthActivityKindDecision.createMany({ data: { key, ...answer }, skipDuplicates: true });
    stored = await db.healthActivityKindDecision.findUnique(query);
  }
  if (!stored || signal.aborted) return fallback;
  const closest = kindSchema.parse(stored.kind);
  const routeKind = closest === "run" || closest === "walk";
  const kind: RecordedActivityKind = routeKind && !(routeEnabled && stored.route) ? "other" : closest;
  return { name, kind, timer: stored.timer || kind === "sauna" || kind === "cold_plunge", decided: true };
}
