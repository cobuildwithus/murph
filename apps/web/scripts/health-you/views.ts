/** Rebuild the companion's byte-for-byte examples from synthetic reference inputs. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import reference from "../../test/fixtures/health-you/reference.json";
import { bundleSchema } from "../../src/lib/health-you/contract";
import type { MemberEvidence } from "../../src/lib/health-you/engine";
import { buildViews, emptyYou } from "../../src/lib/health-you/views";
import type { YouInputs } from "../../src/lib/health-you/evidence";

const dir = fileURLToPath(new URL("../../test/fixtures/health-you/goldens/", import.meta.url));
mkdirSync(dir, { recursive: true });
function write(name: string, value: unknown) {
  writeFileSync(path.join(dir, name + ".json"), JSON.stringify(value, null, 2) + "\n");
}
const asOf = "2024-09-16",
  profile = { memberId: "synthetic-member", firstName: "Example" };
const scenarios: Record<string, Omit<MemberEvidence, "profile">> = reference.inputs;
for (const [name, kind, years] of [
  ["complete", "full", 57],
  ["wearable", "athlete", 41],
  ["labs", "blood", 57],
  ["building", "phone", 27],
  ["paused", "empty", 17],
] as const) {
  const evidence = {
    ...scenarios[kind],
    joined: "2024-05-01",
    profile: { age: years, age_as_of: asOf, sex: "female" },
  };
  const markers: YouInputs["markers"] = (evidence.labs ?? []).map((r) => ({
    date: String(r.date),
    key: String(r.marker).replaceAll("_", "-"),
    label: (
      {
        rdw: "Red cell distribution width",
        albumin: "Albumin",
        hs_crp: "hs-CRP",
        non_hdl: "Non-HDL cholesterol",
      } as Record<string, string>
    )[String(r.marker)],
    unit: String(r.unit),
    value: Number(r.value),
    system:
      r.marker === "rdw"
        ? "Blood counts"
        : r.marker === "albumin"
          ? "Liver"
          : r.marker === "non_hdl"
            ? "Lipids"
            : "Other markers",
    flag: r.marker === "rdw" && Number(r.value) > 15 ? "high" : "normal",
    modelKey: r.marker === "hs_crp" ? "crp" : String(r.marker),
  }));
  const bundle = bundleSchema.parse(
    buildViews({
      asOf,
      timeZone: "UTC",
      evidence,
      sourceRevision: "synthetic",
      historyFrom: "2024-05-01",
      availability: {},
      markers,
      lifts: name === "complete" ? [asOf] : [],
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
    write("marker", bundle.markers.albumin);
  }
  write("you-" + name, bundle.you);
}
write("you-unavailable", emptyYou(profile, asOf));
