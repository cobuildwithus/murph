import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parseHostedExecutionBundleRef,
  serializeHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "../src/index.ts";

test("hosted bundle refs serialize and parse expected shapes", () => {
  const value: HostedExecutionBundleRef = {
    hash: "hash-1",
    key: "bundle/a",
    size: 7,
    updatedAt: "2026-04-09T00:00:00.000Z",
  };

  assert.deepEqual(parseHostedExecutionBundleRef(value), value);
  assert.equal(serializeHostedExecutionBundleRef(value), JSON.stringify(value));
  assert.equal(parseHostedExecutionBundleRef(null), null);
  assert.equal(serializeHostedExecutionBundleRef(undefined), null);
});

test("hosted bundle ref parsing rejects invalid records with labeled errors", () => {
  assert.throws(() => parseHostedExecutionBundleRef("bad", "bundleRef"), /bundleRef must be an object\./u);
  assert.throws(
    () => parseHostedExecutionBundleRef({ hash: "", key: "bundle/a", size: 7, updatedAt: "ok" }, "bundleRef"),
    /bundleRef\.hash must be a non-empty string\./u,
  );
  assert.throws(
    () => parseHostedExecutionBundleRef({ hash: "hash-1", key: "bundle/a", size: Number.NaN, updatedAt: "ok" }, "bundleRef"),
    /bundleRef\.size must be a number\./u,
  );
  assert.throws(
    () => parseHostedExecutionBundleRef({ hash: "hash-1", key: "bundle/a", size: 7, updatedAt: "" }, "bundleRef"),
    /bundleRef\.updatedAt must be a non-empty string\./u,
  );
});
