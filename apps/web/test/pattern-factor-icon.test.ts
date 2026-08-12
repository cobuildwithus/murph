import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import type { PersonalPatternFactor } from "@murphai/query/browser-overview";

import {
  ACTIVITY_FALLBACK_ICON,
  INTERVENTION_FALLBACK_ICON,
  resolvePatternFactorIcon,
} from "@/src/components/overview/pattern-factor-icon";

const WHOOP_SPORTS = [
  "Activity",
  "Running",
  "Cycling",
  "Baseball",
  "Basketball",
  "Rowing",
  "Fencing",
  "Field Hockey",
  "Football",
  "Golf",
  "Ice Hockey",
  "Lacrosse",
  "Rugby",
  "Sailing",
  "Skiing",
  "Soccer",
  "Softball",
  "Squash",
  "Swimming",
  "Tennis",
  "Track & Field",
  "Volleyball",
  "Water Polo",
  "Wrestling",
  "Boxing",
  "Dance",
  "Pilates",
  "Yoga",
  "Weightlifting",
  "Cross Country Skiing",
  "Functional Fitness",
  "Duathlon",
  "Gymnastics",
  "Hiking/Rucking",
  "Horseback Riding",
  "Kayaking",
  "Martial Arts",
  "Mountain Biking",
  "Powerlifting",
  "Rock Climbing",
  "Paddleboarding",
  "Triathlon",
  "Walking",
  "Surfing",
  "Elliptical",
  "Stairmaster",
  "Meditation",
  "Other",
  "Diving",
  "Operations - Tactical",
  "Operations - Medical",
  "Operations - Flying",
  "Operations - Water",
  "Ultimate",
  "Climber",
  "Jumping Rope",
  "Australian Football",
  "Skateboarding",
  "Coaching",
  "Ice Bath",
  "Commuting",
  "Gaming",
  "Snowboarding",
  "Motocross",
  "Caddying",
  "Obstacle Course Racing",
  "Motor Racing",
  "HIIT",
  "Spin",
  "Jiu Jitsu",
  "Manual Labor",
  "Cricket",
  "Pickleball",
  "Inline Skating",
  "Box Fitness",
  "Spikeball",
  "Wheelchair Pushing",
  "Paddle Tennis",
  "Barre",
  "Stage Performance",
  "High Stress Work",
  "Parkour",
  "Gaelic Football",
  "Hurling/Camogie",
  "Circus Arts",
  "Massage Therapy",
  "Strength Trainer",
  "Watching Sports",
  "Assault Bike",
  "Kickboxing",
  "Stretching",
  "Table Tennis",
  "Badminton",
  "Netball",
  "Sauna",
  "Disc Golf",
  "Yard Work",
  "Air Compression",
  "Percussive Massage",
  "Paintball",
  "Ice Skating",
  "Handball",
  "F45 Training",
  "Padel",
  "Barry's",
  "Dedicated Parenting",
  "Stroller Walking",
  "Stroller Jogging",
  "Toddlerwearing",
  "Babywearing",
  "Barre3",
  "Hot Yoga",
  "Stadium Steps",
  "Polo",
  "Musical Performance",
  "Kite Boarding",
  "Dog Walking",
  "Water Skiing",
  "Wakeboarding",
  "Cooking",
  "Cleaning",
  "Public Speaking",
] as const;

test("every current WHOOP sport resolves to a known icon group", () => {
  const unresolved = WHOOP_SPORTS.filter((label) => {
    const icon = resolvePatternFactorIcon(factor(label, "activity"));
    return (
      icon === ACTIVITY_FALLBACK_ICON || icon === INTERVENTION_FALLBACK_ICON
    );
  });

  assert.deepEqual(unresolved, []);
});

test("common Oura tags resolve to relevant intervention icons", () => {
  assert.match(
    resolvePatternFactorIcon(factor("Sauna", "intervention")),
    /sauna\.svg$/u,
  );
  assert.match(
    resolvePatternFactorIcon(factor("Late meal", "intervention")),
    /meal\.svg$/u,
  );
  assert.match(
    resolvePatternFactorIcon(factor("Coffee", "intervention")),
    /coffee-break\.svg$/u,
  );
  assert.match(
    resolvePatternFactorIcon(factor("Alcohol", "intervention")),
    /alcohol\.svg$/u,
  );
});

test("unexpected provider values use kind-specific fallbacks", () => {
  assert.equal(
    resolvePatternFactorIcon(factor("New sport from a provider", "activity")),
    ACTIVITY_FALLBACK_ICON,
  );
  assert.equal(
    resolvePatternFactorIcon(factor("Unmapped custom tag", "intervention")),
    INTERVENTION_FALLBACK_ICON,
  );
});

test("every resolved local SVG asset exists", async () => {
  const factors = [
    ...WHOOP_SPORTS.map((label) => factor(label, "activity")),
    factor("Late meal", "intervention"),
    factor("Unmapped custom tag", "intervention"),
  ];

  await Promise.all(
    factors.map(async (entry) => {
      const assetPath = resolvePatternFactorIcon(entry);
      await access(path.join(process.cwd(), "apps/web/public", assetPath));
    }),
  );
});

test("pattern SVG assets contain no executable or external content", async () => {
  const assetDirectory = path.join(
    process.cwd(),
    "apps/web/public/design-assets/patterns",
  );
  const assetNames = await readdir(assetDirectory);

  await Promise.all(
    assetNames
      .filter((name) => name.endsWith(".svg"))
      .map(async (name) => {
        const source = await readFile(path.join(assetDirectory, name), "utf8");
        assert.match(source, /<svg\b/u);
        assert.doesNotMatch(
          source,
          /<script\b|<foreignObject\b|javascript:|(?:href|src)=["'](?:https?:|data:)|url\(["']?https?:/iu,
        );
      }),
  );
});

function factor(
  label: string,
  kind: PersonalPatternFactor["kind"],
): PersonalPatternFactor {
  return {
    id: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, ""),
    kind,
    label,
    observedDays: 5,
  };
}
