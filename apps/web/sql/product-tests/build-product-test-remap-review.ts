import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = process.env.PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH;
const outputPath = process.env.PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH;
const workOutputDir = ".product-tests-work";

const outputColumns = [
  "source_key",
  "tested_source_product_id",
  "source_fingerprint",
  "source_snapshot_fingerprint",
  "product_test_rows",
  "tested_product_name",
  "tested_product_brand",
  "tested_product_upc",
  "tested_product_upc_raw",
  "tested_package_size",
  "canonical_source_gtin",
  "exact_upc_canonical_groups",
  "contaminant_keys",
  "current_food_id",
  "current_supplement_id",
  "current_match_method",
  "current_remap_revision",
  "expected_current_state_fingerprint",
  "desired_remap_revision",
  "candidate_kind",
  "candidate_id",
  "candidate_canonical_key",
  "candidate_name",
  "candidate_brand",
  "candidate_upc",
  "candidate_data_origin",
  "candidate_data_origin_id",
  "candidate_reason",
  "candidate_score",
  "runner_up_score",
  "candidate_score_margin",
  "target_fingerprint",
  "candidate_options_json",
  "suggested_food_id",
  "suggested_supplement_id",
  "suggested_match_method",
  "source_id_namespace",
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
  const rowsBySourceIdentity = new Map<string, CandidateRecord[]>();

  for (const row of rows) {
    const key = sourceIdentityKey(row);
    const sourceRows = rowsBySourceIdentity.get(key) ?? [];
    sourceRows.push(row);
    rowsBySourceIdentity.set(key, sourceRows);
  }

  const rankOneRows = rows
    .filter((row) => row.candidate_rank === "1")
    .sort((left, right) =>
      compareSourceIdentity(left, right)
      || Number(right.product_test_rows || "0") - Number(left.product_test_rows || "0"),
    );

  const reviewRows = rankOneRows.map((row) => {
    const isFood = row.candidate_kind === "food";
    const isSupplement = row.candidate_kind === "supplement";
    const candidateOptions = (rowsBySourceIdentity.get(sourceIdentityKey(row)) ?? [])
      .slice()
      .sort((left, right) =>
        Number(left.candidate_rank || "0") - Number(right.candidate_rank || "0"),
      )
      .slice(0, 5)
      .map((candidate) => ({
        rank: candidate.candidate_rank,
        kind: candidate.candidate_kind,
        id: candidate.candidate_id,
        canonicalKey: candidate.candidate_canonical_key,
        name: candidate.candidate_name,
        brand: candidate.candidate_brand,
        upc: candidate.candidate_upc,
        dataOrigin: candidate.candidate_data_origin,
        dataOriginId: candidate.candidate_data_origin_id,
        reason: candidate.candidate_reason,
        score: candidate.candidate_score,
        targetFingerprint: candidate.target_fingerprint,
      }));

    return {
      source_key: row.source_key,
      tested_source_product_id: row.tested_source_product_id,
      source_fingerprint: row.source_fingerprint,
      source_snapshot_fingerprint: row.source_snapshot_fingerprint,
      product_test_rows: row.product_test_rows,
      tested_product_name: row.tested_product_name,
      tested_product_brand: row.tested_product_brand,
      tested_product_upc: row.tested_product_upc,
      tested_product_upc_raw: row.tested_product_upc_raw,
      tested_package_size: row.tested_package_size,
      canonical_source_gtin: row.canonical_source_gtin,
      exact_upc_canonical_groups: row.exact_upc_canonical_groups,
      contaminant_keys: row.contaminant_keys,
      current_food_id: row.current_food_id,
      current_supplement_id: row.current_supplement_id,
      current_match_method: row.current_match_method,
      current_remap_revision: row.current_remap_revision,
      expected_current_state_fingerprint: row.current_state_fingerprint,
      desired_remap_revision: String(Number(row.current_remap_revision || "0") + 1),
      candidate_kind: row.candidate_kind,
      candidate_id: row.candidate_id,
      candidate_canonical_key: row.candidate_canonical_key,
      candidate_name: row.candidate_name,
      candidate_brand: row.candidate_brand,
      candidate_upc: row.candidate_upc,
      candidate_data_origin: row.candidate_data_origin,
      candidate_data_origin_id: row.candidate_data_origin_id,
      candidate_reason: row.candidate_reason,
      candidate_score: row.candidate_score,
      runner_up_score: row.runner_up_score,
      candidate_score_margin: row.candidate_score_margin,
      target_fingerprint: row.target_fingerprint,
      candidate_options_json: JSON.stringify(candidateOptions),
      suggested_food_id: isFood ? row.candidate_id : "",
      suggested_supplement_id: isSupplement ? row.candidate_id : "",
      suggested_match_method: row.suggested_match_method || "manual_confirmed",
      source_id_namespace: "",
      review_note: "",
    };
  });

  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, serializeTsv(reviewRows), { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
}

function sourceIdentityKey(row: CandidateRecord): string {
  return `${row.source_key}\u0000${row.tested_source_product_id}`;
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
