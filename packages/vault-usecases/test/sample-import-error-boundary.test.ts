import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { projectVaultCliError } from "@murphai/operator-config/vault-cli-error-projection";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { test, vi } from "vitest";

import { importWithMocks, mockActualModule } from "./mock-import.ts";

const SAMPLE_PAYLOAD = {
  stream: "heart_rate",
  unit: "bpm",
  samples: [{ recordedAt: "2026-03-12T08:00:00.000Z", value: 61 }],
};

test("sample import error projection preserves every supported field mapping", async () => {
  const mappings = [
    ["recordedAt", "samples.2.recordedAt", "string"],
    ["startAt", "samples.2.startAt", "string"],
    ["endAt", "samples.2.endAt", "string"],
    ["timeZone", "samples.2.timeZone", "string"],
    ["unit", "unit", "string"],
    ["externalRef", "samples.2.externalRef", "object"],
    ["dataOrigin", "samples.2.dataOrigin", "object"],
    ["value", "samples.2.value", "number"],
    ["durationMinutes", "samples.2.durationMinutes", "number"],
    ["stage", "samples.2.stage", "string"],
  ] as const;
  let sampleField: string = mappings[0][0];
  const importSamples = vi.fn(async () => {
    throw Object.assign(new Error("Sample record failed validation."), {
      code: "VAULT_INVALID_SAMPLE",
      details: { sampleField, sampleIndex: 2 },
      name: "VaultError",
    });
  });
  const provider = await importWithMocks<
    typeof import("../src/usecases/provider-event.ts")
  >("../src/usecases/provider-event.ts", {
    "../src/runtime-import.ts": mockActualModule(
      "../src/runtime-import.ts",
      (actual) => ({
        ...actual,
        loadRuntimeModule: vi.fn(async () => ({ importSamples })),
      }),
    ),
  });

  for (const [field, expectedPath, expectedType] of mappings) {
    sampleField = field;
    await assert.rejects(
      () => provider.addSampleRecords({ vault: "./vault", payload: SAMPLE_PAYLOAD }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const code = Reflect.get(error, "code");
        const context = Reflect.get(error, "context");
        assert.equal(typeof code, "string");
        assert.ok(typeof context === "object" && context !== null && !Array.isArray(context));
        const projection = projectVaultCliError(new VaultCliError(
          code,
          error.message,
          Object.fromEntries(Object.entries(context)),
        ));
        assert.deepEqual(projection.fieldErrors, [{
          code: "invalid_type",
          expected: expectedType,
          message: "This field is invalid.",
          path: expectedPath,
          received: "invalid",
        }]);
        return true;
      },
    );
  }

  assert.equal(importSamples.mock.calls.length, mappings.length);
});

test("identifier-shaped private sample context is not projected or written", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-sample-context-boundary-"));
  const privateField = "privateFutureField";
  const importSamples = vi.fn(async () => {
    throw Object.assign(new Error("Sample record failed validation."), {
      code: "VAULT_INVALID_SAMPLE",
      details: { sampleField: privateField, sampleIndex: 0 },
      name: "VaultError",
    });
  });

  try {
    const provider = await importWithMocks<
      typeof import("../src/usecases/provider-event.ts")
    >("../src/usecases/provider-event.ts", {
      "../src/runtime-import.ts": mockActualModule(
        "../src/runtime-import.ts",
        (actual) => ({
          ...actual,
          loadRuntimeModule: vi.fn(async () => ({ importSamples })),
        }),
      ),
    });

    await assert.rejects(
      () => provider.addSampleRecords({ vault: vaultRoot, payload: SAMPLE_PAYLOAD }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const code = Reflect.get(error, "code");
        const context = Reflect.get(error, "context");
        assert.equal(typeof code, "string");
        assert.ok(typeof context === "object" && context !== null && !Array.isArray(context));
        const projection = projectVaultCliError(new VaultCliError(
          code,
          error.message,
          Object.fromEntries(Object.entries(context)),
        ));
        assert.equal(projection.fieldErrors, undefined);
        assert.equal(JSON.stringify(projection).includes(privateField), false);
        assert.equal(JSON.stringify(projection).includes("samples.0"), false);
        return true;
      },
    );

    assert.equal(importSamples.mock.calls.length, 1);
    assert.deepEqual(await readdir(vaultRoot), []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
