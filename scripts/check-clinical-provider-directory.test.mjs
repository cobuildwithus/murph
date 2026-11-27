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

const alder = ["epic-alder", "https://alder.example.test/r4", "Alder `@team` | Health"];
const birch = ["epic-birch", "https://birch.example.test/r4"];
const current = directory([alder, birch]);
const publish = (entries, held = [], options = {}) =>
  checkPublication({ currentText: current, candidateText: directory(entries), heldText: JSON.stringify(held), ...options });

// Each case is a change only a person may publish.
const heldCases = {
  "a path-only endpoint change": [["epic-alder", "https://alder.example.test/fhir/r4"], birch],
  "a host move": [["epic-alder", "https://other.example.test/r4"], birch],
  "a port move": [["epic-alder", "https://alder.example.test:8443/r4"], birch],
  "a removal": [birch],
  "a new entry on an unknown host": [alder, birch, ["epic-cedar", "https://cedar.example.test/r4"]],
};

test("publication accepts unchanged endpoints and new entries on known hosts", () => {
  assert.equal(publish([alder, ["epic-alder-2", "https://alder.example.test/r4/other"], birch]), "");
});

test("publication rejects every change the refresh must hold, even when a count drop is allowed", () => {
  for (const [name, entries] of Object.entries(heldCases)) {
    assert.throws(() => publish(entries, [], { allowCountDrop: true }), /only a person may publish:\n- epic-(alder|birch|cedar)/u, name);
  }
});

test("publication reports each kind of held change with mention-safe cells", () => {
  const held = [
    { kind: "endpoint", id: "epic-alder", current: alder[1], candidate: "https://moved.example.test/r4|`x`" },
    { kind: "removal", id: "epic-birch", current: birch[1] },
    { kind: "new-host", id: "epic-cedar", brandName: "Cedar @team", candidate: "https://cedar.example.test/r4" },
  ];
  const report = publish([alder, birch], held);
  assert.ok(report.includes(
    "| `epic-alder` | `Alder @team  Health` | Endpoint change | `https://alder.example.test/r4` | `https://moved.example.test/r4%60x%60` |"));
  assert.ok(report.includes("| `epic-birch` | `epic-birch` | Removed upstream | `https://birch.example.test/r4` |  |"));
  assert.ok(report.includes("| `epic-cedar` | `Cedar @team` | New entry on a new host |  | `https://cedar.example.test/r4` |"));
});

test("publication rejects held reports that do not match the candidate", () => {
  const entries = [alder, birch];
  const endpoint = { kind: "endpoint", id: "epic-alder", current: alder[1], candidate: "https://alder.example.test/v2/r4" };
  const newHost = { kind: "new-host", id: "epic-cedar", brandName: "Cedar", candidate: "https://cedar.example.test/r4" };
  for (const wrong of [
    [{ ...endpoint, current: "https://elsewhere.example.test/r4" }],
    [{ ...endpoint, candidate: alder[1] }],
    [{ ...endpoint, candidate: "https://alder.example.test/r4?next=1" }],
    [{ ...endpoint, id: "epic-unknown" }],
    [{ ...endpoint, kind: "constructor" }],
    [{ kind: "removal", id: "epic-birch", current: birch[1], candidate: "https://birch.example.test/v2" }],
    [{ kind: "removal", id: "epic-unknown" }],
    [null],
    [{ ...newHost, candidate: "https://birch.example.test/v2" }],
    [{ ...newHost, id: "epic-birch" }],
    [{ ...newHost, id: "Epic Cedar" }],
    [endpoint, endpoint],
  ]) assert.throws(() => publish(entries, wrong), /does not match/u, JSON.stringify(wrong));
});

test("publication truncates a held report that would exceed GitHub's issue body limit", () => {
  const held = Array.from({ length: 600 }, (_, index) => ({
    kind: "new-host", id: `epic-new-${index}`, brandName: "N".repeat(160), candidate: `https://new-${index}.example.test/r4`,
  }));
  const report = publish([alder, birch], held);
  assert.ok(report.length < 65_536);
  assert.match(report, /\n\d+ more held changes are not listed\.\n$/u);
});

test("publication keeps the count floor unless an operator allows the drop", () => {
  const shrunk = JSON.parse(current);
  shrunk.entries[0].locations = [];
  const check = allowCountDrop =>
    checkPublication({ allowCountDrop, currentText: current, candidateText: JSON.stringify(shrunk), heldText: "[]" });
  assert.throws(() => check(false), /decreased by more than 10%/u);
  assert.equal(check(true), "");
});

test("bot pull requests cannot make a held change; people can", () => {
  for (const [name, entries] of Object.entries(heldCases)) {
    const headText = directory(entries);
    assert.throws(() => checkPullRequest({ authorType: "Bot", baseText: current, headText }),
      /cannot make these directory changes:\n- epic-/u, name);
    assert.match(checkPullRequest({ authorType: "User", baseText: current, headText }), /A person authored/u, name);
  }
  const known = directory([alder, birch, ["epic-birch-2", "https://birch.example.test/r4"]]);
  assert.match(checkPullRequest({ authorType: "Bot", baseText: current, headText: known }), /keeps its endpoint/u);
});
