import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPublication, checkPullRequest } from "./check-clinical-provider-directory.mjs";

const policy = { id: "sample-policy", requestedBaseScopes: [], sourceSystem: "epic-fhir" };
const facility = ["Harbor Clinic", "Elm Bay", "ME", "04001", ["42 Cove Road"], [], [44.1, -70.2]];

function directory(entries) {
  return JSON.stringify({
    entries: entries.map(([id, fhirBaseUrl, brandName = id]) => ({
      aliases: [], brandName, clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID", fhirBaseUrl, id,
      locations: [facility], policyId: policy.id,
    })),
    generatedAt: "2026-11-01T00:00:00.000Z",
    policies: [policy],
    schema: "murph.clinical-provider-directory.v2",
    sourceBundleSha256: "a".repeat(64),
    version: "sample",
  });
}

const current = directory([["epic-alder", "https://alder.example.test/r4", "Alder `@team` | Health"],
  ["epic-birch", "https://birch.example.test/r4"]]);
const publish = (entries, held = [], options = {}) =>
  checkPublication({ currentText: current, candidateText: directory(entries), heldText: JSON.stringify(held), ...options });

test("publication accepts path-only changes and new entries", () => {
  assert.equal(publish([
    ["epic-alder", "https://alder.example.test/fhir/r4"],
    ["epic-birch", "https://birch.example.test/r4"],
    ["epic-cedar", "https://cedar.example.test/r4"],
  ]), "");
});

test("publication rejects a candidate that moves an existing entry's host, scheme or port", () => {
  for (const moved of ["https://other.example.test/r4", "https://alder.example.test:8443/r4"]) {
    assert.throws(() => publish([["epic-alder", moved], ["epic-birch", "https://birch.example.test/r4"]]),
      /epic-alder: https:\/\/alder\.example\.test\/r4 ->/u);
  }
});

test("publication reports held moves with mention-safe cells and rejects reports that do not match", () => {
  const entries = [["epic-alder", "https://alder.example.test/r4"], ["epic-birch", "https://birch.example.test/r4"]];
  const held = [{ id: "epic-alder", current: "https://alder.example.test/r4", candidate: "https://moved.example.test/r4|`x`" }];
  const report = publish(entries, held);
  assert.ok(report.includes("| `epic-alder` | `Alder @team  Health` | `https://alder.example.test/r4` | `https://moved.example.test/r4%60x%60` |"));
  for (const wrong of [
    [{ ...held[0], current: "https://elsewhere.example.test/r4" }],
    [{ ...held[0], candidate: "https://alder.example.test/other" }],
    [{ ...held[0], id: "epic-unknown" }],
    [held[0], held[0]],
  ]) assert.throws(() => publish(entries, wrong), /does not match/u);
});

test("publication keeps the count floor unless an operator allows the drop", () => {
  const smaller = [["epic-alder", "https://alder.example.test/r4"]];
  assert.throws(() => publish(smaller), /decreased by more than 10%/u);
  assert.equal(publish(smaller, [], { allowCountDrop: true }), "");
});

test("bot pull requests cannot move an existing endpoint host; people can", () => {
  const moved = directory([["epic-alder", "https://moved.example.test/r4"], ["epic-birch", "https://birch.example.test/r4"],
    ["epic-cedar", "https://cedar.example.test/r4"]]);
  assert.throws(() => checkPullRequest({ authorType: "Bot", baseText: current, headText: moved }), /epic-alder/u);
  assert.match(checkPullRequest({ authorType: "User", baseText: current, headText: moved }), /A person authored/u);
  const pathOnly = directory([["epic-alder", "https://alder.example.test/v2/r4"], ["epic-birch", "https://birch.example.test/r4"],
    ["epic-cedar", "https://cedar.example.test/r4"]]);
  assert.match(checkPullRequest({ authorType: "Bot", baseText: current, headText: pathOnly }), /No existing/u);
});
