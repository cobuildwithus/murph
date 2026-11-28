/** Rebuild the companion's byte-for-byte examples from synthetic reference inputs. */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { lookup, model } from "../../src/lib/health-you/engine/model";
import { adapt } from "../../src/lib/health-you/engine/feeds";
import type { Observation } from "../../src/lib/health-you/engine/model";
import { bundleSchema } from "../../src/lib/health-you/contract";

import { markerSystem, youLabel } from "../../src/lib/health-you/labels";
import { buildViews, emptyYou } from "../../src/lib/health-you/views";
import type { YouInputs } from "../../src/lib/health-you/evidence";

const dir = fileURLToPath(new URL("../../test/fixtures/health-you/goldens/", import.meta.url));
mkdirSync(dir, { recursive: true });
function write(name: string, value: unknown) {
  writeFileSync(path.join(dir, name + ".json"), JSON.stringify(value, null, 2) + "\n");
}
const profile = { memberId: "synthetic-member", firstName: "Example" };
const cases: { case: string; member: Observation; history: Observation; as_of: string }[] = JSON.parse(
  readFileSync(new URL("../../test/fixtures/health-you/reference.json", import.meta.url), "utf8"),
);
const asOf = cases.find((r) => r.case === "watch_panel-08")!.as_of;
for (const [name, id] of [
  ["complete", "watch_panel-08"],
  ["wearable", "watch-08"],
  ["labs", "watch_panel-08"],
  ["building", "phone-08"],
  ["paused", "phone-08"],
] as const) {
  const row = cases.find((r) => r.case === id)!;
  const evidence = adapt(row.member, row.history);
  // Published meal portions carry nutrients, but no whole-day intake confirmation.
  if (name === "complete") evidence.checkins = evidence.checkins?.map(checkin => {
    const projected = { ...checkin };
    delete projected.diet_day_complete;
    return projected;
  });
  if (name === "labs") {
    evidence.daily = [];
    evidence.sleep_sessions = [];
    evidence.vo2 = [];
    evidence.workouts = [];
    evidence.meals = [];
    evidence.food_weeks = [];
    evidence.checkins = [];
    evidence.habits = [];
    evidence.fitness_tests = [];
    evidence.body = [];
    evidence.bp = [];
  }
  if (name === "paused") evidence.profile = { age: 17, sex: "female" };
  const markers: YouInputs["markers"] = (evidence.labs ?? []).map((r) => ({
    date: String(r.date),
    key: String(r.marker).replaceAll("_", "-"),
    label: youLabel(String(r.marker))!,
    unit: String(r.unit),
    value: Number(r.value),
    system: markerSystem(String(r.marker)),
    flag: r.marker === "rdw" && Number(r.value) > 15 ? "high" : "normal",
    modelKey: lookup(model.labs, r.marker)?.[0] ?? String(r.marker),
  }));
  const bundle = bundleSchema.parse(
    buildViews({
      asOf,
      timeZone: "UTC",
      evidence,
      sourceRevision: "synthetic",
      historyFrom: evidence.joined!,
      availability: {},
      markers,
      lifts: name === "complete" ? [asOf] : [],
      hasWearableData: name === "complete" || name === "wearable",
      hasAnswerProjection: true,
      hasHabitQuestions: true,
      needsWhoopAnswer: name === "wearable",
      activeMinutes: name === "complete" ? [{ date: asOf, value: 28 }] : undefined,
      bedtime: name === "complete" ? [{ date: asOf, inTarget: true }] : undefined,
    }),
  );
  const expectedState = name === "paused" || name === "building" ? name : "ready";
  if (bundle.you.state !== expectedState) throw new Error("Unexpected synthetic view state for " + name);
  bundle.you.profile = profile;
  if (name === "complete") {
    bundle.you.thisWeek.unshift({
      kind: "challenge",
      gameId: "synthetic-game",
      title: "Take a lunch walk",
      streak: 3,
      partner: { memberId: "synthetic-partner", firstName: "Teammate" },
      days: ["done", "todo", "todo", "todo", "todo", "none", "none"],
    });
    for (const key of ["age", "week", "sleep", "fitness", "blood"] as const) write(key, bundle[key]);
    write("marker", bundle.markers.alp);
  }
  write("you-" + name, bundle.you);
}
write("you-unavailable", emptyYou(profile, asOf));
