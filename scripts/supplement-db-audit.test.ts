import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  DEFAULT_STATEMENT_TIMEOUT_MS,
  MAX_CANDIDATE_IDS,
  buildCandidateAuditSql,
  buildDataAuditSql,
  buildSchemaAuditSql,
  extractJsonPayload,
  parseArgs,
  runAudit,
} from "../.agents/skills/research-supplements/scripts/supplement-db-audit.mjs";

const DML_OR_DDL = /\b(?:insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|vacuum|analyze|refresh|reindex|cluster|copy)\b/iu;

function assertReadOnlySql(sql: string): void {
  assert.match(sql, /begin transaction read only;/iu);
  assert.match(sql, /rollback;/iu);
  assert.doesNotMatch(sql, DML_OR_DDL);
}

describe("supplement database audit", () => {
  test("parses bounded candidate and timeout options", () => {
    assert.deepEqual(parseArgs([]), {
      candidateLimit: 0,
      statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
      help: false,
    });
    assert.deepEqual(parseArgs(["--candidate-limit", "25", "--statement-timeout-ms", "30000"]), {
      candidateLimit: 25,
      statementTimeoutMs: 30000,
      help: false,
    });
    assert.equal(parseArgs(["--help"]).help, true);
    assert.throws(() => parseArgs(["--candidate-limit", "0"]), /1 to 500/u);
    assert.throws(() => parseArgs(["--candidate-limit", String(MAX_CANDIDATE_IDS + 1)]), /1 to 500/u);
    assert.throws(() => parseArgs(["--statement-timeout-ms", "999"]), /1000/u);
    assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/u);
  });

  test("builds schema, data, and bounded candidate queries as read-only transactions", () => {
    const schemaSql = buildSchemaAuditSql();
    const dataSql = buildDataAuditSql({ includeProductTests: true });
    const candidateSql = buildCandidateAuditSql({ candidateLimit: 50 });

    assertReadOnlySql(schemaSql);
    assertReadOnlySql(dataSql);
    assertReadOnlySql(candidateSql);
    assert.match(schemaSql, /supplements_payload_format_check/u);
    assert.match(schemaSql, /supplements_serving_grams_check/u);
    assert.match(schemaSql, /product_tests_supplement_id_fkey/u);
    assert.match(dataSql, /observed_values_only_no_gs1_width_assumption/u);
    assert.match(dataSql, /review_candidates_not_deletion_candidates/u);
    assert.match(dataSql, /from product_tests tests/u);
    assert.match(candidateSql, /limit 50/u);
    assert.match(candidateSql, /'scope', 'selected_drilldowns'/u);
    assert.match(candidateSql, /jsonb_build_object\('issue', issue, 'id', id, 'dataOrigin', data_origin\)/u);
    assert.doesNotMatch(candidateSql, /'label'\s*,/iu);
  });

  test("omits product-test reads when the related schema is absent", () => {
    const sql = buildDataAuditSql({ includeProductTests: false });
    assertReadOnlySql(sql);
    assert.match(sql, /skipped_schema_missing/u);
    assert.doesNotMatch(sql, /from product_tests tests/u);
  });

  test("extracts the compact JSON row from psql transaction output", () => {
    assert.deepEqual(extractJsonPayload("BEGIN\nSET\n{\"ok\":true}\nROLLBACK\n"), { ok: true });
    assert.throws(() => extractJsonPayload("BEGIN\nROLLBACK\n"), /Expected a JSON audit payload/u);
  });

  test("runs no data query when the required schema does not match", () => {
    const calls: string[] = [];
    const result = runAudit({
      dbUrl: "postgresql://redacted.invalid/db",
      candidateLimit: 10,
      executeSql: (_dbUrl, sql) => {
        calls.push(sql);
        return 'BEGIN\nSET\n{"dataAuditReady":false,"relatedProductTests":{}}\nROLLBACK\n';
      },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(result.data, { status: "skipped_schema_mismatch" });
    assert.deepEqual(result.candidates, { status: "skipped_schema_mismatch" });
  });

  test("returns stable summary sections and omits candidate IDs by default", () => {
    const calls: string[] = [];
    const result = runAudit({
      dbUrl: "postgresql://redacted.invalid/db",
      executeSql: (_dbUrl, sql) => {
        calls.push(sql);
        if (calls.length === 1) {
          return 'BEGIN\nSET\n{"dataAuditReady":true,"relatedProductTests":{"product_tests_present":true,"product_tests_supplement_id_present":true}}\nROLLBACK\n';
        }
        return 'BEGIN\nSET\n{"status":"completed","totalRows":2}\nROLLBACK\n';
      },
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(Object.keys(result), ["auditVersion", "readOnly", "schema", "data", "candidates"]);
    assert.deepEqual(result.candidates, {
      status: "omitted",
      scope: "selected_drilldowns",
      reason: "use_--candidate-limit_to_include_bounded_ids",
    });
    assert.equal(result.readOnly, true);
  });
});
