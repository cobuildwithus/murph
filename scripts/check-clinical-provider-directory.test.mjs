import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPublication, checkPullRequest } from "./check-clinical-provider-directory.mjs";

const PRODUCTION = "EPIC_SMART_CLIENT_ID";
const NON_PRODUCTION = "EPIC_SMART_NON_PRODUCTION_CLIENT_ID";
const policy = { id: "sample-policy", requestedBaseScopes: [], sourceSystem: "epic-fhir" };
const facility = ["Harbor Clinic", "Elm Bay", "ME", "04001", ["42 Cove Road"], [], [44.1, -70.2]];

function directory(entries) {
  return JSON.stringify({
    entries: entries.map(([id, fhirBaseUrl, brandName = id, clientIdEnvironmentKey = PRODUCTION]) => ({
      aliases: [], brandName, clientIdEnvironmentKey, fhirBaseUrl, id, locations: [facility], policyId: policy.id,
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
const sandbox = ["epic-sandbox", "https://sandbox.example.test/r4", "Sandbox", NON_PRODUCTION];
const current = directory([alder, birch, sandbox]);
const publish = (entries, held = [], options = {}) =>
  checkPublication({ currentText: current, candidateText: directory(entries), heldText: JSON.stringify(held), ...options });

// Each case is a change only a person may publish.
const heldCases = {
  "a path-only endpoint change": [["epic-alder", "https://alder.example.test/fhir/r4"], birch, sandbox],
  "a host move": [["epic-alder", "https://other.example.test/r4"], birch, sandbox],
  "a port move": [["epic-alder", "https://alder.example.test:8443/r4"], birch, sandbox],
  "a production entry on the non-production client": [[...alder.slice(0, 3), NON_PRODUCTION], birch, sandbox],
  "every production entry on the non-production client": [[...alder.slice(0, 3), NON_PRODUCTION], [...birch, "epic-birch", NON_PRODUCTION], sandbox],
  "the sandbox on the production client": [alder, birch, [...sandbox.slice(0, 3), PRODUCTION]],
  "a removal": [birch, sandbox],
  "a new entry on an unknown host": [alder, birch, ["epic-cedar", "https://cedar.example.test/r4"], sandbox],
  "a new non-production entry on a known host": [alder, ["epic-alder-2", "https://alder.example.test/r4/b", "B", NON_PRODUCTION], birch, sandbox],
  "a new production entry on the sandbox host": [alder, birch, sandbox, ["epic-sandbox-2", "https://sandbox.example.test/r4/b"]],
};
const nonCanonical = [["epic-alder", "https://ALDER.example.test:443/r4/"], birch, sandbox];

test("publication accepts unchanged connections and new production entries on known production hosts", () => {
  assert.equal(publish([alder, ["epic-alder-2", "https://alder.example.test/r4/other"], birch, sandbox]), "");
});

test("publication rejects every change the refresh must hold, even when a count drop is allowed", () => {
  for (const [name, entries] of Object.entries(heldCases)) {
    assert.throws(() => publish(entries, [], { allowCountDrop: true }), /only a person may publish:\n- epic-/u, name);
  }
});

test("both checks reject a URL that is not written in canonical form", () => {
  assert.throws(() => publish(nonCanonical), /canonical form/u);
  for (const authorType of ["Bot", "User"]) {
    assert.throws(() => checkPullRequest({ authorType, baseText: current, headText: directory(nonCanonical) }), /canonical form/u);
  }
});

test("publication reports each kind of held change with mention-safe cells and an unverified warning", () => {
  const held = [
    { kind: "connection", id: "epic-alder", field: "fhirBaseUrl", current: alder[1], candidate: "https://moved.example.test/r4|`x`" },
    { kind: "connection", id: "epic-alder", field: "clientIdEnvironmentKey", current: PRODUCTION, candidate: NON_PRODUCTION },
    { kind: "removal", id: "epic-birch", current: birch[1] },
    { kind: "addition", id: "epic-cedar", brandName: "Cedar @team", candidate: "https://cedar.example.test/r4", clientIdEnvironmentKey: PRODUCTION },
    { kind: "addition", id: "epic-elm", brandName: "Elm", candidate: "https://alder.example.test/r4/e", clientIdEnvironmentKey: NON_PRODUCTION },
  ];
  const report = publish([alder, birch, sandbox], held);
  assert.match(report, /unverified: re-check each one against open\.epic\.com/u);
  for (const row of [
    "| `epic-alder` | `Alder @team  Health` | Endpoint change | `https://alder.example.test/r4` | `https://moved.example.test/r4%60x%60` |",
    `| \`epic-alder\` | \`Alder @team  Health\` | Client key change | \`${PRODUCTION}\` | \`${NON_PRODUCTION}\` |`,
    "| `epic-birch` | `epic-birch` | Removed upstream | `https://birch.example.test/r4` |  |",
    "| `epic-cedar` | `Cedar @team` | New entry on a new host |  | `https://cedar.example.test/r4` |",
    `| \`epic-elm\` | \`Elm\` | New entry using ${NON_PRODUCTION} |  | \`https://alder.example.test/r4/e\` |`,
  ]) assert.ok(report.includes(row), row);
});

test("publication rejects held reports that do not match the candidate", () => {
  const entries = [alder, birch, sandbox];
  const endpoint = { kind: "connection", id: "epic-alder", field: "fhirBaseUrl", current: alder[1], candidate: "https://alder.example.test/v2/r4" };
  const key = { kind: "connection", id: "epic-sandbox", field: "clientIdEnvironmentKey", current: NON_PRODUCTION, candidate: PRODUCTION };
  const addition = { kind: "addition", id: "epic-cedar", brandName: "Cedar", candidate: "https://cedar.example.test/r4", clientIdEnvironmentKey: PRODUCTION };
  for (const wrong of [
    [{ ...endpoint, current: "https://elsewhere.example.test/r4" }],
    [{ ...endpoint, candidate: alder[1] }],
    [{ ...endpoint, candidate: "https://alder.example.test/r4?next=1" }],
    [{ ...endpoint, id: "epic-unknown" }],
    [{ ...endpoint, kind: "constructor" }],
    [{ ...endpoint, field: "brandName", current: alder[2], candidate: "Other" }],
    [{ ...key, current: PRODUCTION }],
    [{ ...key, candidate: "EPIC_SMART_OTHER_CLIENT_ID" }],
    [{ kind: "connection", id: "epic-alder", field: "policyId", current: policy.id, candidate: "Other Policy" }],
    [{ kind: "removal", id: "epic-birch", current: birch[1], candidate: "https://birch.example.test/v2" }],
    [{ kind: "removal", id: "epic-unknown" }],
    [null],
    [{ ...addition, candidate: "https://birch.example.test/v2" }],
    [{ ...addition, id: "epic-birch" }],
    [{ ...addition, id: "Epic Cedar" }],
    [{ ...addition, clientIdEnvironmentKey: "EPIC_SMART_OTHER_CLIENT_ID" }],
    [{ ...addition, clientIdEnvironmentKey: undefined }],
    [endpoint, endpoint],
  ]) assert.throws(() => publish(entries, wrong), /does not match/u, JSON.stringify(wrong));
  // The sandbox host is not a production host, so a production entry there is a valid hold.
  assert.match(publish(entries, [{ ...addition, candidate: "https://sandbox.example.test/r4/b" }]), /New entry on a new host/u);
  assert.match(publish(entries, [key]), /Client key change/u);
});

test("publication truncates a held report that would exceed GitHub's issue body limit", () => {
  const held = Array.from({ length: 600 }, (_, index) => ({
    kind: "addition", id: `epic-new-${index}`, brandName: "N".repeat(160), candidate: `https://new-${index}.example.test/r4`,
    clientIdEnvironmentKey: PRODUCTION,
  }));
  const report = publish([alder, birch, sandbox], held);
  assert.ok(report.length < 65_536);
  assert.match(report, /\n\d+ more held changes are not listed\.\n$/u);
});

test("publication keeps the count floor unless an operator allows the drop", () => {
  const shrunk = JSON.parse(current);
  shrunk.entries[0].locations = [];
  shrunk.entries[1].locations = [];
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
  const known = directory([alder, birch, ["epic-birch-2", "https://birch.example.test/r4"], sandbox]);
  assert.match(checkPullRequest({ authorType: "Bot", baseText: current, headText: known }), /keeps its connection/u);
});
