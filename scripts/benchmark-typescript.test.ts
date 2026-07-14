import assert from "node:assert/strict";

import { describe, test } from "vitest";

interface BenchmarkModule {
  median(values: number[]): number;
  parseArguments(argv: string[]): {
    runs: number;
    label: string;
    command: string[];
  };
  parseDarwinMaxRssMiB(output: string): number;
  parseLinuxMaxRssMiB(output: string): number;
}

const benchmark = await import(
  new URL("./benchmark-typescript.mjs", import.meta.url).href
) as BenchmarkModule;

describe("benchmark-typescript", () => {
  test("parses benchmark arguments with defaults and overrides", () => {
    assert.deepEqual(benchmark.parseArguments(["--", "pnpm", "typecheck"]), {
      runs: 5,
      label: "benchmark",
      command: ["pnpm", "typecheck"],
    });
    assert.deepEqual(
      benchmark.parseArguments([
        "--",
        "--runs",
        "1",
        "--label",
        "pnpm smoke",
        "--",
        "node",
        "smoke.mjs",
      ]),
      {
        runs: 1,
        label: "pnpm smoke",
        command: ["node", "smoke.mjs"],
      },
    );
    assert.deepEqual(
      benchmark.parseArguments([
        "--runs",
        "3",
        "--label",
        "typecheck",
        "--",
        "pnpm",
        "typecheck",
      ]),
      {
        runs: 3,
        label: "typecheck",
        command: ["pnpm", "typecheck"],
      },
    );
    assert.deepEqual(benchmark.parseArguments(["--", "node", "--", "flag"]), {
      runs: 5,
      label: "benchmark",
      command: ["node", "--", "flag"],
    });
    assert.throws(
      () => benchmark.parseArguments(["--runs", "0", "--", "true"]),
      /positive integer/u,
    );
    assert.throws(
      () => benchmark.parseArguments(["--label", "--", "true"]),
      /requires a value/u,
    );
    assert.throws(() => benchmark.parseArguments(["true"]), /Unknown option/u);
  });

  test("normalizes Darwin byte RSS and Linux KiB RSS to MiB", () => {
    assert.equal(
      benchmark.parseDarwinMaxRssMiB(
        "  134217728  maximum resident set size\n",
      ),
      128,
    );
    assert.equal(
      benchmark.parseLinuxMaxRssMiB(
        "\tMaximum resident set size (kbytes): 131072\n",
      ),
      128,
    );
    assert.throws(
      () => benchmark.parseDarwinMaxRssMiB("no rss here"),
      /Darwin maximum RSS/u,
    );
    assert.throws(
      () => benchmark.parseLinuxMaxRssMiB("no rss here"),
      /Linux maximum RSS/u,
    );
  });

  test("computes odd and even medians without mutating input", () => {
    const values = [9, 1, 5, 3];
    assert.equal(benchmark.median(values), 4);
    assert.deepEqual(values, [9, 1, 5, 3]);
    assert.equal(benchmark.median([9, 1, 5]), 5);
    assert.throws(() => benchmark.median([]), /one or more finite numbers/u);
  });
});
