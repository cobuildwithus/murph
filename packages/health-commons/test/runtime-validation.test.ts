import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadGeneratedHealthCommonsWebBiomarkerIndex } from "@murphai/health-commons/runtime";
import {
  HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
  type HealthCommonsWebBiomarkerIndexEntry,
} from "../src/web-artifacts.ts";

const CATALOG_HASH = `sha256:${"0".repeat(64)}`;
const REVISION = { pageRevisionId: `sha256:${"1".repeat(64)}` };
const BIOMARKER_INDEX_PATH = "browse/biomarkers.json";
const BIOMARKER_INDEX_ERROR = "Health Commons generated web biomarker index is invalid.";

type WebOptions = { generatedWebRoot: string };

function writeJson(root: string, relativePath: string, value: unknown): unknown {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const raw = JSON.stringify(value);
  writeFileSync(target, raw, "utf8");
  // Expectations describe the JSON actually read, not omitted undefined properties.
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

function withGeneratedWebRoot(run: (options: WebOptions) => void): void {
  const generatedWebRoot = mkdtempSync(path.join(os.tmpdir(), "commons-validation-"));
  try {
    run({ generatedWebRoot });
  } finally {
    rmSync(generatedWebRoot, { recursive: true, force: true });
  }
}

const biomarkerEntry = {
  aliases: [], bundlePath: "bundles/biomarker/example-marker.json", categories: [],
  privateMetricBindings: [], valuePrecision: 0,
  desiredDirection: null, fallbackRanges: [], hidden: false, key: "biomarker:example-marker",
  published: false, quality: null, revision: REVISION, routeId: "example-marker", shortName: "",
  slug: "example-marker", status: null, summary: null, title: "", unit: null,
} satisfies HealthCommonsWebBiomarkerIndexEntry;

describe("generated biomarker index boundaries", () => {
  it.each([
    ["null required nullable fields", {}, true],
    ["empty strings and populated arrays", { summary: "", quality: "", status: "", aliases: [""], categories: [""], extra: "kept" }, true],
    ["missing required nullable field", { summary: undefined }, false],
    ["wrong required nullable primitive", { quality: 0 }, false],
    ["null array", { aliases: null }, false],
    ["non-array", { categories: {} }, false],
    ["bad nested string", { aliases: [null] }, false],
    ["array revision", { revision: [] }, false],
  ] as const)("preserves %s", (_name, overrides, accepted) => {
    withGeneratedWebRoot((options) => {
      const expected = writeJson(options.generatedWebRoot, BIOMARKER_INDEX_PATH, {
        catalogHash: CATALOG_HASH,
        schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
        biomarkers: [{ ...biomarkerEntry, ...overrides }],
      });
      if (accepted) expect(loadGeneratedHealthCommonsWebBiomarkerIndex(options)).toStrictEqual(expected);
      else expect(() => loadGeneratedHealthCommonsWebBiomarkerIndex(options)).toThrow(new Error(BIOMARKER_INDEX_ERROR));
    });
  });

  it("accepts empty collections but rejects invalid collections and entries", () => {
    withGeneratedWebRoot((options) => {
      for (const entries of [[], null, {}, [null], [[]]]) {
        const expected = writeJson(options.generatedWebRoot, BIOMARKER_INDEX_PATH, {
          catalogHash: CATALOG_HASH,
          schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
          biomarkers: entries,
        });
        if (Array.isArray(entries) && entries.length === 0) {
          expect(loadGeneratedHealthCommonsWebBiomarkerIndex(options)).toStrictEqual(expected);
        } else {
          expect(() => loadGeneratedHealthCommonsWebBiomarkerIndex(options)).toThrow(new Error(BIOMARKER_INDEX_ERROR));
        }
      }
    });
  });
});

describe("generated biomarker fallback arrays", () => {
  it("preserves finite bounds and nonempty specimen checks within checked arrays", () => {
    const range = { applicability: "", eligibleSpecimenKinds: ["serum"], label: "", unit: "",
      lowerBound: { inclusive: true, value: 1 }, upperBound: { inclusive: false, value: 2 } };
    withGeneratedWebRoot((options) => {
      for (const [fallbackRanges, accepted] of [
        [[range], true],
        [[{ ...range, upperBound: undefined }], true],
        [null, false], [undefined, false], [{}, false], [[null], false],
        [[{ ...range, eligibleSpecimenKinds: [] }], false],
        [[{ ...range, lowerBound: { inclusive: true, value: 2 } }], false],
        [[{ ...range, upperBound: { inclusive: false, value: "2" } }], false],
      ] as const) {
        const expected = writeJson(options.generatedWebRoot, BIOMARKER_INDEX_PATH, {
          catalogHash: CATALOG_HASH, schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
          // These fields are not validated by the current reader; do not tighten it.
          biomarkers: [{ ...biomarkerEntry, shortName: undefined, sortRank: "unchecked", fallbackRanges }],
        });
        const load = () => loadGeneratedHealthCommonsWebBiomarkerIndex(options);
        if (accepted) expect(load()).toStrictEqual(expected);
        else expect(load).toThrow(new Error(BIOMARKER_INDEX_ERROR));
      }
      const artifact = { catalogHash: CATALOG_HASH,
        schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
        biomarkers: [{ ...biomarkerEntry, fallbackRanges: [range] }] };
      const raw = JSON.stringify(artifact).replace('"value":2', '"value":1e400');
      writeFileSync(path.join(options.generatedWebRoot, BIOMARKER_INDEX_PATH), raw, "utf8");
      expect(() => loadGeneratedHealthCommonsWebBiomarkerIndex(options))
        .toThrow(new Error(BIOMARKER_INDEX_ERROR));
    });
  });
});
