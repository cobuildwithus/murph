import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import type {
  JunctionWearableBiomarkerPanelExpectation,
} from "@murphai/vault-usecases/testing";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const generatedHealthCommonsWebRoot = path.join(repoRoot, "packages/health-commons/generated/web");

export async function expectJunctionWearableBiomarkerExpectationsToMatchProduction(
  expectations: readonly JunctionWearableBiomarkerPanelExpectation[],
): Promise<void> {
  const routes = readArray(readRecord(await readJson("routes/index.json")).routes);
  const seenKeys = new Set<string>();

  for (const expectation of expectations) {
    expect(seenKeys.has(expectation.biomarkerKey)).toBe(false);
    seenKeys.add(expectation.biomarkerKey);

    const route = routes
      .map(readRecord)
      .find((entry) => readString(entry.key) === expectation.biomarkerKey);
    expect(route, `Expected Health Commons route for ${expectation.biomarkerKey}.`)
      .toBeDefined();
    if (!route) {
      throw new Error(`Expected Health Commons route for ${expectation.biomarkerKey}.`);
    }

    const projections = readRecord(route.projections);
    const overviewPath = readString(projections["biomarker.overview"]);
    expect(overviewPath, `Expected production biomarker overview for ${expectation.biomarkerKey}.`)
      .toBeTruthy();
    if (!overviewPath) {
      throw new Error(`Expected production biomarker overview for ${expectation.biomarkerKey}.`);
    }

    const overview = readRecord(await readJson(overviewPath));
    expect(readString(overview.key)).toBe(expectation.biomarkerKey);
    expect(readString(overview.shortName)).toBe(expectation.label);
    expect(readString(overview.unit)).toBe(expectation.unit);
    expect(readNumber(overview.valuePrecision)).toBe(expectation.valuePrecision);
    expect(overview.privateMetricBindings).toEqual(expectation.privateMetricBindings);
    expect(overview.trendDefaults).toEqual(expectation.trendDefaults);
  }
}

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.join(generatedHealthCommonsWebRoot, relativePath);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
