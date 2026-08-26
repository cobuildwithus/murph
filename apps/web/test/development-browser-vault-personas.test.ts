import assert from "node:assert/strict";

import { test } from "vitest";

import { createBrowserVaultQueryClient } from "@murphai/query/browser";
import { selectEnvironmentHabitatValues } from "../app/(dashboard)/environment/habitat-values";
import { buildDevelopmentPersonaReplica } from "@/src/lib/browser-vault/development-personas.server";
import { DEVELOPMENT_PERSONAS } from "@/src/lib/browser-vault/development-personas";

test("each development persona exercises the real Journal and Patterns projections", async () => {
  for (const persona of DEVELOPMENT_PERSONAS) {
    const replica = await buildDevelopmentPersonaReplica(
      persona.id,
      new Date("2026-08-26T20:00:00.000Z"),
    );

    assert.ok(replica.journal);
    assert.ok(replica.journal.eventCount > 0, persona.id);
    assert.ok(replica.personalPatterns);
    assert.ok(replica.personalPatterns.factors.length > 0, persona.id);
    if (persona.id === "family") {
      assert.equal(replica.personalPatterns.outcomes.length, 0);
    } else {
      assert.ok(replica.personalPatterns.outcomes.length > 2, persona.id);
    }
  }
});

test("Family persona covers a member without a connected wearable", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "family",
    new Date("2026-08-26T20:00:00.000Z"),
  );

  assert.equal(
    replica.journal?.days.some((day) =>
      day.events.some((event) => event.kind === "sleep"),
    ),
    false,
  );
  assert.deepEqual(replica.personalPatterns?.outcomes, []);
  assert.equal(
    replica.personalPatterns?.factors.some(
      (factor) => factor.id === "football",
    ),
    true,
  );
});

test("Oura persona keeps frequent Yard work visible even without useful comparison days", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "oura",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const yardWork = replica.personalPatterns?.factors.find(
    (factor) => factor.id === "yardwork",
  );

  assert.ok(yardWork);
  assert.ok(yardWork.observedDays > 30);
  assert.equal(
    replica.personalPatterns?.cells.some(
      (cell) => cell.factorId === "yardwork",
    ),
    true,
  );
});

test("Whoop persona exposes provider-specific sleep and recovery outcomes", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "whoop",
    new Date("2026-08-26T20:00:00.000Z"),
  );
  const outcomeIds = new Set(
    replica.personalPatterns?.outcomes.map((outcome) => outcome.id),
  );

  for (const expected of [
    "deep-sleep",
    "rem-sleep",
    "recovery-score",
    "respiratory-rate",
    "spo2",
  ]) {
    assert.ok(
      outcomeIds.has(expected),
      `${expected}: ${[...outcomeIds].join(", ")}`,
    );
  }

  const sleep = replica.journal?.days
    .flatMap((day) => day.events)
    .find((event) => event.kind === "sleep");
  assert.ok(sleep);
  assert.match(
    sleep.details.join(" "),
    /recovery/iu,
    sleep.records
      .map((record) => `${record.label}:${record.source}:${record.summary}`)
      .join(" | "),
  );
  assert.match(sleep.details.join(" "), /deep sleep/iu);
  assert.match(sleep.details.join(" "), /SpO₂/iu);
});

test("context-rich persona joins meals and context into one private timeline", async () => {
  const replica = await buildDevelopmentPersonaReplica(
    "context",
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
    events.some((event) => event.title === "Bedroom temperature"),
    true,
  );
  assert.equal(
    replica.entities.some((entity) => entity.family === "habitat"),
    true,
  );
  const environment = selectEnvironmentHabitatValues(
    createBrowserVaultQueryClient(replica),
  );
  assert.equal(environment["sleep-environment"]?.night_temp_c, 18);
  assert.equal(environment["home-location"]?.location, "New York");
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
    trainingEvents.some((event) => event.title === "Strength plan"),
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
    familyEvents
      .flatMap((event) => event.records)
      .every((record) => record.source !== "group"),
    true,
  );
});
