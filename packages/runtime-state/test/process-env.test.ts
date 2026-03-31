import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildScopedProcessEnv,
  getScopedProcessEnv,
  withScopedProcessEnv,
} from "../src/index.ts";

function restoreProcessEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

test("withScopedProcessEnv keeps reads, writes, deletes, and key enumeration scoped", async () => {
  const inheritedKey = "MURPH_PROCESS_ENV_INHERITED_TEST";
  const addedKey = "MURPH_PROCESS_ENV_ADDED_TEST";
  const originalInheritedValue = process.env[inheritedKey];
  const originalAddedValue = process.env[addedKey];

  process.env[inheritedKey] = "outside";
  delete process.env[addedKey];

  try {
    await withScopedProcessEnv(
      buildScopedProcessEnv(
        {
          [inheritedKey]: "inside",
          [addedKey]: "present",
        },
        process.env,
      ),
      async () => {
        assert.equal(process.env[inheritedKey], "inside");
        assert.equal(getScopedProcessEnv()[inheritedKey], "inside");
        assert.equal(addedKey in process.env, true);
        assert.equal(Object.keys(process.env).includes(addedKey), true);

        process.env[inheritedKey] = "mutated";
        delete process.env[addedKey];

        assert.equal(process.env[inheritedKey], "mutated");
        assert.equal(getScopedProcessEnv()[inheritedKey], "mutated");
        assert.equal(process.env[addedKey], undefined);
        assert.equal(getScopedProcessEnv()[addedKey], undefined);
        assert.equal(addedKey in process.env, false);
        assert.equal(Object.keys(process.env).includes(addedKey), false);
      },
    );

    assert.equal(process.env[inheritedKey], "outside");
    assert.equal(process.env[addedKey], undefined);
  } finally {
    restoreProcessEnvValue(inheritedKey, originalInheritedValue);
    restoreProcessEnvValue(addedKey, originalAddedValue);
  }
});

test("getScopedProcessEnv falls back to the provided environment outside a scope", () => {
  const fallback = {
    MURPH_PROCESS_ENV_FALLBACK_TEST: "fallback",
  } as NodeJS.ProcessEnv;

  assert.equal(getScopedProcessEnv(fallback).MURPH_PROCESS_ENV_FALLBACK_TEST, "fallback");
});
