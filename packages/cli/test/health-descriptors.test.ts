import assert from "node:assert/strict";

import { healthEntityDefinitions } from "@murph/contracts";
import { test } from "vitest";

import {
  findHealthDescriptorForLookup,
  healthEntityDescriptorByKind,
  inferHealthEntityKind,
} from "../src/health-cli-descriptors.js";

test("CLI health descriptors inherit shared taxonomy lookup metadata and scaffold templates", () => {
  for (const definition of healthEntityDefinitions) {
    const descriptor = healthEntityDescriptorByKind.get(definition.kind);

    assert.ok(descriptor, `missing CLI descriptor for ${definition.kind}`);
    assert.deepEqual(descriptor?.listKinds, definition.listKinds);
    assert.deepEqual(descriptor?.prefixes, definition.prefixes);
    assert.deepEqual(descriptor?.lookupAliases, definition.lookupAliases);

    if (descriptor?.query) {
      assert.deepEqual(descriptor.query.genericListKinds, definition.listKinds);
      assert.deepEqual(descriptor.query.genericLookupPrefixes, definition.prefixes);
      assert.deepEqual(descriptor.query.genericLookupValues, definition.lookupAliases);
    }

    if (descriptor?.core) {
      assert.deepEqual(descriptor.core.payloadTemplate, definition.scaffoldTemplate);
    }
  }
});

test("generic CLI lookup inference stays anchored to shared aliases and prefixes", () => {
  const profileDescriptor = findHealthDescriptorForLookup("current");
  const goalKind = inferHealthEntityKind("goal_01JSHAREDLOOKUP000000000001");
  const protocolDescriptor = findHealthDescriptorForLookup("prot_01JSHAREDLOOKUP000000000001");

  assert.equal(profileDescriptor?.kind, "profile");
  assert.equal(goalKind, "goal");
  assert.equal(protocolDescriptor?.kind, "protocol");
});
