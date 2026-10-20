import assert from "node:assert/strict";

import { test } from "vitest";

import { buildDevelopmentPersonaReplica } from "@/src/lib/browser-vault/development-personas.server";
import { DEVELOPMENT_PERSONAS } from "@/src/lib/browser-vault/development-personas";

test("each development persona exercises the real Journal projection", async () => {
  for (const persona of DEVELOPMENT_PERSONAS) {
    const replica = await buildDevelopmentPersonaReplica(
      persona.id,
      new Date("2026-08-26T20:00:00.000Z"),
    );

    assert.ok(replica.journal);
    if (persona.id === "new") {
      assert.equal(replica.journal.eventCount, 0);
    } else {
      assert.ok(replica.journal.eventCount > 0, persona.id);
    }
    if (persona.id === "active" || persona.id === "new") {
      assert.equal(replica.metricRows.length, 0);
    } else {
      assert.ok(replica.metricRows.length > 0, persona.id);
    }
  }
});

test("Family persona covers private group context alongside wearable data", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "family",
    new Date("2026-08-26T20:00:00.000Z"),
  );

  assert.equal(
    replica.journal?.days.some((day) =>
      day.events.some((event) => event.kind === "sleep"),
    ),
    true,
  );
  assert.ok(replica.metricRows.length > 0);
  assert.equal(
    replica.journal?.days.some((day) =>
      day.events.some((event) => event.title === "Football"),
    ),
    true,
  );
});

test("Oura persona covers a varied activity history", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "oura",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const activityTypes = readActivityTypes(replica);

  for (const expected of [
    "cycling",
    "hiking",
    "running",
    "strength-training",
    "tennis",
    "yard-work",
  ]) {
    assert.ok(activityTypes.has(expected), expected);
  }
});

test("Whoop persona exposes provider-specific sleep and recovery outcomes", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "whoop",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const metricKeys = new Set(replica.metricRows.map((row) => row.metricKey));

  for (const expected of [
    "deep-sleep-minutes",
    "rem-sleep-minutes",
    "respiratory-rate",
    "spo2",
  ]) {
    assert.ok(
      metricKeys.has(expected),
      `${expected}: ${[...metricKeys].join(", ")}`,
    );
  }

  const sleep = replica.journal?.days
    .flatMap((day) => day.events)
    .find((event) => event.kind === "sleep");
  assert.ok(sleep);
  assert.notEqual(sleep.metrics.recoveryScore, null);
  assert.notEqual(sleep.metrics.deepSleepMinutes, null);
  assert.notEqual(sleep.metrics.spo2Percent, null);

  const activityTypes = readActivityTypes(replica);
  for (const expected of [
    "cycling",
    "functional-fitness",
    "running",
    "strength-training",
  ]) {
    assert.ok(activityTypes.has(expected), expected);
  }
  for (const expected of [
    "active-calories",
    "activity-average-heart-rate",
    "max-heart-rate",
    "workout-strain",
  ]) {
    assert.ok(metricKeys.has(expected), expected);
  }
});

test("Whoop persona covers the Journal connections used across the product", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "whoop",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const events = replica.journal?.days.flatMap((day) => day.events) ?? [];
  const titles = new Set(events.map((event) => event.title));

  for (const expected of [
    "Tennis",
    "Strength training",
    "Work trip",
    "Time zone change",
    "Blood test results",
    "Magnesium for Sleep",
    "Bedroom temperature changed",
    "Consistent Wake Time",
    "Day trip",
    "No Late Caffeine",
    "Joined Strength Crew",
  ]) {
    assert.ok(titles.has(expected), `${expected}: ${[...titles].join(", ")}`);
  }
});

test("New member exercises the empty Journal state", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "new",
    new Date("2026-08-26T20:00:00.000Z"),
  );

  assert.equal(replica.journal?.eventCount, 0);
  assert.equal(replica.entities.length, 0);
  assert.equal(replica.metricRows.length, 0);
});

test("Oura persona joins meals, travel, and environment context into one private timeline", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "oura",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const events = replica.journal?.days.flatMap((day) => day.events) ?? [];

  assert.equal(
    events.some((event) => event.kind === "meal"),
    true,
  );
  assert.equal(
    events.some((event) => event.title === "Work trip"),
    true,
  );
  assert.equal(
    events.some((event) => event.title === "Bedroom temperature changed"),
    true,
  );

});

test("Active persona has varied recent context without wearable outcomes", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "active",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const events = replica.journal?.days.flatMap((day) => day.events) ?? [];
  const recentKinds = new Set(events.slice(0, 20).map((event) => event.kind));

  assert.ok(events.length >= 8);
  assert.ok(recentKinds.has("activity"));
  assert.ok(recentKinds.has("meal"));
  assert.equal(replica.metricRows.length, 0);
});

test("training and group personas show completed actions and private context", async () => {
  const [training, family] = await Promise.all([
    buildDevelopmentPersonaReplica(
      "coach",
      new Date("2026-08-26T20:00:00.000Z"),
    ),
    buildDevelopmentPersonaReplica(
      "family",
      new Date("2026-08-26T20:00:00.000Z"),
    ),
  ]);

  const trainingEvents =
    training.journal?.days.flatMap((day) => day.events) ?? [];
  assert.equal(
    trainingEvents.some((event) => event.title === "Strength Base"),
    true,
  );
  assert.equal(
    trainingEvents.some((event) => event.title === "Strength training"),
    true,
  );
  assert.equal(
    trainingEvents.some(
      (event) => event.title === "Suggested mobility session",
    ),
    false,
  );
  assert.ok(
    training.entities.filter(
      (entity) =>
        entity.kind === "activity_session" &&
        entity.attributes.source === "murph-live",
    ).length >= 12,
  );

  const familyEvents = family.journal?.days.flatMap((day) => day.events) ?? [];
  assert.equal(
    familyEvents.some((event) => event.title === "Football"),
    true,
  );
  assert.equal(
    familyEvents.some((event) => event.title === "Muscle soreness"),
    true,
  );
  assert.equal(
    familyEvents.some((event) => event.title === "Mobility"),
    true,
  );
  assert.equal(
    familyEvents
      .flatMap((event) => event.records)
      .every((record) => record.source !== "group"),
    true,
  );
});

function readActivityTypes(
  replica: Awaited<ReturnType<typeof buildDevelopmentPersonaReplica>>,
): Set<unknown> {
  return new Set(
    (replica.journal?.days.flatMap((day) => day.events) ?? [])
      .filter((event) => event.kind === "activity")
      .map((event) => event.title.toLowerCase().replaceAll(" ", "-")),
  );
}
