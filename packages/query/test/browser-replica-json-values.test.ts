import assert from "node:assert/strict";

import { test } from "vitest";

import { createBrowserVaultReplica } from "../src/browser-replica/build.ts";
import { selectBrowserVaultExperimentResults } from "../src/browser-replica/experiments.ts";
import { cloneJson, isBrowserSafeJson } from "../src/browser-replica/json-values.ts";
import { createBrowserVaultQueryClient } from "../src/browser-replica/query.ts";
import { createVaultReadModel } from "../src/read-model.ts";

test("browser JSON admission rejects an entire value containing unsupported nested data", () => {
  for (const value of [undefined, () => "ignored", Symbol("synthetic"), 1n]) {
    assert.equal(isBrowserSafeJson(value), false);
    assert.equal(isBrowserSafeJson({ nested: [value] }), false);
    assert.equal(isBrowserSafeJson([null, { nested: value }]), false);
  }

  assert.equal(isBrowserSafeJson({ nested: [null, false, 0, ""] }), true);
  assert.equal(isBrowserSafeJson({ toJSON: () => ({}) }), false);
});

test("browser JSON copies preserve existing serialization of numbers, holes, and object prototypes", () => {
  const value = {
    date: new Date("2026-04-20T12:00:00.000Z"),
    empty: { array: [], object: {} },
    nonfinite: [NaN, Infinity, -Infinity],
    sparse: new Array(2),
  };

  assert.equal(isBrowserSafeJson(value), true);
  assert.deepEqual(cloneJson(value), {
    date: "2026-04-20T12:00:00.000Z",
    empty: { array: [], object: {} },
    nonfinite: [null, null, null],
    sparse: [null, null],
  });

  const inherited = Object.create({ unsupported: undefined });
  assert.equal(isBrowserSafeJson(inherited), true);
  assert.deepEqual(cloneJson(inherited), {});
});

test("replica and experiment projections retain allowlists and detach nested protocol values", async () => {
  const protocolRef = { protocolId: "protocol:synthetic", nested: ["original"] };
  const attributes = {
    effectiveProtocolSnapshot: { invalid: undefined },
    protocolRef,
    rawProvenance: { payload: "excluded" },
    status: "active",
  };
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [{
        attributes,
        body: null,
        date: "2026-04-20",
        entityId: "exp_json_copy",
        experimentSlug: "json-copy",
        family: "experiment",
        frontmatter: null,
        kind: "experiment_entry",
        links: [],
        lookupIds: ["exp_json_copy"],
        occurredAt: "2026-04-20T00:00:00.000Z",
        path: "bank/experiments/json-copy.md",
        primaryLookupId: "exp_json_copy",
        recordClass: "bank",
        relatedIds: [],
        status: "active",
        stream: null,
        tags: [],
        title: "Synthetic protocol",
      }],
      metadata: null,
      vaultRoot: "browser://synthetic",
    }),
  });
  const projected = replica.entities.find((entity) => entity.id === "exp_json_copy");
  assert.ok(projected);
  assert.deepEqual(projected.attributes, { protocolRef, status: "active" });
  assert.equal(Object.hasOwn(projected.attributes, "rawProvenance"), false);
  assert.equal(Object.hasOwn(projected.attributes, "effectiveProtocolSnapshot"), false);

  protocolRef.nested.push("source changed");
  assert.deepEqual(projected.attributes.protocolRef, {
    protocolId: "protocol:synthetic",
    nested: ["original"],
  });

  const client = createBrowserVaultQueryClient(replica);
  const result = selectBrowserVaultExperimentResults(client, "exp_json_copy", {
    asOf: "2026-04-20T12:00:00.000Z",
  });
  assert.ok(result);
  assert.equal(result.experiment.effectiveProtocolSnapshot, null);
  assert.equal(result.experiment.commonsProtocolRef, null);
  const resultRef = result.experiment.protocolRef;
  assert.ok(resultRef);
  assert.ok(Array.isArray(resultRef.nested));
  resultRef.nested.push("result changed");
  assert.deepEqual(projected.attributes.protocolRef, {
    protocolId: "protocol:synthetic",
    nested: ["original"],
  });
  assert.deepEqual(protocolRef.nested, ["original", "source changed"]);
});
