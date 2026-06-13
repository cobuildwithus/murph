import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const exportPreparedCases: Array<{
  archiveDirName?: string;
  env?: Record<string, string>;
  expectedReleaseDate: string;
  name: string;
}> = [
  {
    env: { FDC_RELEASE_DATE: "2026-04-30" },
    expectedReleaseDate: "2026-04-30",
    name: "uses FDC_RELEASE_DATE for prepared exports without FDC_DATA_DIR",
  },
  {
    archiveDirName: "FoodData_Central_csv_2025-10-31",
    expectedReleaseDate: "2025-10-31",
    name: "derives the prepared export release date from FDC_DATA_DIR",
  },
];

describe("FDC foods import script", () => {
  it("does not fall back to the legacy supplement database URL", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-fdc-export-"));

    try {
      const outputCsvPath = path.join(tempRoot, "prepared.csv");

      await expect(
        execFileAsync(
          "bash",
          [
            path.resolve("apps/web/sql/foods/import-fdc.sh"),
            "--export-prepared",
            outputCsvPath,
          ],
          {
            env: {
              FDC_RELEASE_DATE: "2026-04-30",
              MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/labels",
              NODE_ENV: process.env.NODE_ENV ?? "test",
              PATH: process.env.PATH ?? "",
              PSQL_BIN: path.join(tempRoot, "missing-psql-stub"),
            },
          },
        ),
      ).rejects.toMatchObject({
        code: 64,
        stderr: expect.stringContaining("MURPH_LABELS_DB_URL is required"),
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it.each(exportPreparedCases)(
    "$name",
    async ({ archiveDirName, env, expectedReleaseDate }) => {
      const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-fdc-export-"));

      try {
        const capturedCommandPath = path.join(tempRoot, "psql-command.txt");
        const outputCsvPath = path.join(tempRoot, "prepared.csv");
        const psqlStubPath = path.join(tempRoot, "psql-stub.sh");
        let fdcDataDir: string | undefined;

        if (archiveDirName) {
          fdcDataDir = path.join(tempRoot, archiveDirName);
          await mkdir(fdcDataDir);
        }

        await writeFile(
          psqlStubPath,
          `#!/usr/bin/env bash
set -euo pipefail

copy_command=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-c" ]; then
    copy_command="$2"
    shift 2
    continue
  fi
  shift
done

printf '%s' "$copy_command" > "$CAPTURED_PSQL_COMMAND"
out_file="$(printf '%s' "$copy_command" | sed -n "s/.* TO '\\([^']*\\)' WITH.*/\\1/p")"
if [ -z "$out_file" ]; then
  echo "missing COPY output path" >&2
  exit 2
fi
printf 'id,canonical_key,data_origin,data_origin_id,data_origin_url,data_origin_priority,name,brand,upc,off_market,search_text,label,fdc_release_date\\n' > "$out_file"
`,
          { mode: 0o700 },
        );

        const scriptEnv: NodeJS.ProcessEnv = {
          CAPTURED_PSQL_COMMAND: capturedCommandPath,
          MURPH_LABELS_DB_URL: "postgres://labels.example.test/murph",
          NODE_ENV: process.env.NODE_ENV ?? "test",
          PATH: process.env.PATH ?? "",
          PSQL_BIN: psqlStubPath,
          ...(env ?? {}),
        };

        if (fdcDataDir) {
          scriptEnv.FDC_DATA_DIR = fdcDataDir;
        }

        const { stdout } = await execFileAsync(
          "bash",
          [
            path.resolve("apps/web/sql/foods/import-fdc.sh"),
            "--export-prepared",
            outputCsvPath,
          ],
          { env: scriptEnv },
        );
        const capturedCommand = await readFile(capturedCommandPath, "utf8");

        expect(stdout).toContain(
          `Exporting prepared foods rows for FDC release ${expectedReleaseDate}`,
        );
        expect(capturedCommand).toContain("FROM foods");
        expect(capturedCommand).toContain(
          `WHERE fdc_release_date = '${expectedReleaseDate}'`,
        );
        expect(capturedCommand).toContain("ORDER BY id");
        expect(capturedCommand).toContain(`TO '${outputCsvPath}'`);
      } finally {
        await rm(tempRoot, { force: true, recursive: true });
      }
    },
  );
});
