import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = process.env.PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH;
const outputPath = process.env.PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH;
const workOutputDir = ".product-tests-work";

const outputColumns = [
  "source_key",
  "tested_source_product_id",
  "product_test_rows",
  "tested_product_name",
  "tested_product_brand",
  "tested_product_upc",
  "candidate_kind",
  "candidate_id",
  "candidate_name",
  "candidate_brand",
  "candidate_upc",
  "candidate_reason",
  "candidate_score",
  "suggested_food_id",
  "suggested_supplement_id",
  "suggested_match_method",
  "review_note",
] as const;

type CandidateRecord = Record<string, string>;

async function main(): Promise<void> {
  if (!inputPath) {
    throw new Error("PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH is required");
  }

  if (!outputPath) {
    throw new Error("PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH is required");
  }

  assertSafeOutputPath(outputPath);

  const rows = parseTsv(await readFile(inputPath, "utf8"));
  const rankOneRows = rows
    .filter((row) => row.candidate_rank === "1")
    .sort((left, right) =>
      compareSourceIdentity(left, right)
      || Number(right.product_test_rows || "0") - Number(left.product_test_rows || "0"),
    );

  const reviewRows = rankOneRows.map((row) => {
    const isFood = row.candidate_kind === "food";
    const isSupplement = row.candidate_kind === "supplement";

    return {
      source_key: row.source_key,
      tested_source_product_id: row.tested_source_product_id,
      product_test_rows: row.product_test_rows,
      tested_product_name: row.tested_product_name,
      tested_product_brand: row.tested_product_brand,
      tested_product_upc: row.tested_product_upc,
      candidate_kind: row.candidate_kind,
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_brand: row.candidate_brand,
      candidate_upc: row.candidate_upc,
      candidate_reason: row.candidate_reason,
      candidate_score: row.candidate_score,
      suggested_food_id: isFood ? row.candidate_id : "",
      suggested_supplement_id: isSupplement ? row.candidate_id : "",
      suggested_match_method: row.suggested_match_method || "manual_confirmed",
      review_note: "",
    };
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializeTsv(reviewRows), "utf8");
}

function assertSafeOutputPath(candidatePath: string): void {
  const outputPathAbsolute = path.resolve(process.cwd(), candidatePath);
  const workDirAbsolute = path.resolve(process.cwd(), workOutputDir);
  const relativePath = path.relative(workDirAbsolute, outputPathAbsolute);

  if (
    relativePath === ""
    || relativePath.startsWith("..")
    || path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH must be under .product-tests-work/",
    );
  }
}

function compareSourceIdentity(
  left: CandidateRecord,
  right: CandidateRecord,
): number {
  return left.source_key.localeCompare(right.source_key)
    || numericTextCompare(
      left.tested_source_product_id,
      right.tested_source_product_id,
    );
}

function numericTextCompare(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right);
}

function parseTsv(text: string): CandidateRecord[] {
  const records = parseDelimitedRows(text);
  const [header, ...rows] = records;

  if (!header) {
    return [];
  }

  return rows
    .filter((row) => row.some((value) => value !== ""))
    .map((row) => Object.fromEntries(
      header.map((column, index) => [column, row[index] ?? ""]),
    ));
}

function serializeTsv(rows: readonly Record<string, string>[]): string {
  const lines = [
    outputColumns.join("\t"),
    ...rows.map((row) =>
      outputColumns.map((column) => formatTsvCell(row[column] ?? "")).join("\t"),
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function formatTsvCell(value: string): string {
  if (!/[\t\n\r"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, "\"\"")}"`;
}

function parseDelimitedRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === "\"") {
      quoted = true;
    } else if (character === "\t") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
