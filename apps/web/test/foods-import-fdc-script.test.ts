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

if [ -n "\${MURPH_LABELS_DB_URL:-}" ] || [ -n "\${PGPASSWORD:-}" ]; then
  echo "database credentials leaked into psql environment" >&2
  exit 3
fi
if printf '%s\\n' "$*" | grep -Eq 'postgres(ql)?://'; then
  echo "database URL leaked into psql argv" >&2
  exit 3
fi

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
printf 'id,canonical_key,data_origin,data_origin_id,data_origin_url,data_origin_priority,name,brand,upc,off_market,search_text,label,serving_grams,fdc_release_date\\n' > "$out_file"
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
          `Exporting prepared foods rows for the latest import run in FDC release ${expectedReleaseDate}`,
        );
        expect(capturedCommand).toContain("FROM foods");
        expect(capturedCommand).toContain(
          `WHERE fdc_release_date = '${expectedReleaseDate}'`,
        );
        expect(capturedCommand).toContain("last_seen_at = (");
        expect(capturedCommand).toContain("max(latest_foods.last_seen_at)");
        expect(capturedCommand).toContain(
          `latest_foods.fdc_release_date = '${expectedReleaseDate}'`,
        );
        expect(capturedCommand).toContain("ORDER BY id");
        expect(capturedCommand).toContain(`TO '${outputCsvPath}'`);
      } finally {
        await rm(tempRoot, { force: true, recursive: true });
      }
    },
  );

  it("normalizes full FDC display data types while reducing nutrients", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-fdc-prepare-"));
    const fdcDataDir = path.join(tempRoot, "FoodData_Central_csv_2026-04-30");
    const reducedCsvPath = path.resolve(
      ".fdc-work/foods-import/food-nutrient-reduced.csv",
    );

    try {
      await mkdir(fdcDataDir);
      await rm(reducedCsvPath, { force: true });
      await rm(`${reducedCsvPath}.tmp`, { force: true });

      await Promise.all([
        writeFile(
          path.join(fdcDataDir, "food.csv"),
          [
            '"fdc_id","data_type","description","food_category_id","publication_date"',
            '"1001","Foundation","Foundation item","","2026-04-30"',
            '"1002","SR Legacy","Legacy item","","2026-04-30"',
            '"1003","Survey (FNDDS)","Survey item","","2026-04-30"',
            '"2001","Branded","Branded item","","2026-04-30"',
            "",
          ].join("\n"),
        ),
        writeFile(
          path.join(fdcDataDir, "branded_food.csv"),
          '"fdc_id","brand_owner","brand_name","subbrand_name","gtin_upc","ingredients","not_a_significant_source_of","serving_size","serving_size_unit","household_serving_fulltext","branded_food_category","data_source","package_weight","modified_date","available_date","market_country","discontinued_date","preparation_state_code","trade_channel","short_description","material_code"\n',
        ),
        writeFile(
          path.join(fdcDataDir, "survey_fndds_food.csv"),
          '"fdc_id","food_code","wweia_category_code","start_date","end_date"\n',
        ),
        writeFile(
          path.join(fdcDataDir, "wweia_food_category.csv"),
          '"wweia_food_category","wweia_food_category_description"\n',
        ),
        writeFile(
          path.join(fdcDataDir, "nutrient.csv"),
          [
            '"id","name","unit_name","nutrient_nbr","rank"',
            '"1","Protein","g","203","600"',
            '"2","Non-label nutrient","g","999","999"',
            "",
          ].join("\n"),
        ),
        writeFile(
          path.join(fdcDataDir, "food_nutrient.csv"),
          [
            '"id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","loq","footnote","min_year_acquired","percent_daily_value"',
            '"1","1001","2","9","","","","","","","","",""',
            '"2","1002","2","10","","","","","","","","",""',
            '"3","1003","2","11","","","","","","","","",""',
            '"4","2001","2","12","","","","","","","","",""',
            '"5","2001","1","13","","","","","","","","",""',
            "",
          ].join("\n"),
        ),
        writeFile(
          path.join(fdcDataDir, "food_portion.csv"),
          '"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight","data_points","footnote","min_year_acquired"\n',
        ),
        writeFile(
          path.join(fdcDataDir, "food_category.csv"),
          '"id","code","description"\n',
        ),
        writeFile(
          path.join(fdcDataDir, "measure_unit.csv"),
          '"id","name"\n',
        ),
      ]);

      const { stdout } = await execFileAsync(
        "bash",
        [path.resolve("apps/web/sql/foods/import-fdc.sh"), "--prepare-only"],
        {
          env: {
            FDC_DATA_DIR: fdcDataDir,
            FDC_RELEASE_DATE: "2026-04-30",
            NODE_ENV: process.env.NODE_ENV ?? "test",
            PATH: process.env.PATH ?? "",
          },
        },
      );
      const reducedCsv = await readFile(reducedCsvPath, "utf8");

      expect(stdout).toContain("Reduced food_nutrient rows: 4");
      expect(reducedCsv).toContain('"1001","2","9"');
      expect(reducedCsv).toContain('"1002","2","10"');
      expect(reducedCsv).toContain('"1003","2","11"');
      expect(reducedCsv).toContain('"2001","1","13"');
      expect(reducedCsv).not.toContain('"2001","2","12"');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      await rm(reducedCsvPath, { force: true });
      await rm(`${reducedCsvPath}.tmp`, { force: true });
    }
  });

  it("normalizes full FDC display data types in the SQL import", async () => {
    const importSql = await readFile(
      path.resolve("apps/web/sql/foods/import-fdc.sql"),
      "utf8",
    );

    expect(importSql).toContain("CREATE OR REPLACE FUNCTION pg_temp.fdc_data_type");
    expect(importSql).toContain("WHEN 'branded' THEN 'branded_food'");
    expect(importSql).toContain("WHEN 'branded_food' THEN 'branded_food'");
    expect(importSql).toContain("WHEN 'foundation' THEN 'foundation_food'");
    expect(importSql).toContain("WHEN 'foundation_food' THEN 'foundation_food'");
    expect(importSql).toContain("WHEN 'sr_legacy' THEN 'sr_legacy_food'");
    expect(importSql).toContain("WHEN 'sr_legacy_food' THEN 'sr_legacy_food'");
    expect(importSql).toContain("WHEN 'survey_fndds' THEN 'survey_fndds_food'");
    expect(importSql).toContain("WHEN 'survey_fndds_food' THEN 'survey_fndds_food'");
    expect(importSql).toContain("CASE food.normalized_data_type");
    expect(importSql).toContain("food.normalized_data_type AS data_type");
    expect(importSql).toContain("food.normalized_data_type IN");
    expect(importSql).toContain("food.normalized_data_type = 'branded_food'");
    expect(importSql).toContain("food.normalized_data_type = 'survey_fndds_food'");
  });
});
