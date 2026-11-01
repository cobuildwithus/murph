import { readFile } from "node:fs/promises";

import { getDMMF } from "@prisma/get-dmmf";
import { Client } from "pg";

import type { HostedWebMigrationOwnerDatabase } from "./hosted-web-migration-owner";

export interface HostedWebSchemaContract {
  enums: Array<{ name: string; values: string[] }>;
  tables: Array<{ name: string; columns: string[] }>;
}

export async function readHostedWebSchemaContract(
  schema?: string,
): Promise<HostedWebSchemaContract> {
  const dmmf = getDMMF({
    datamodel: schema ?? await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
  });
  if ("error" in dmmf) {
    throw new Error("Unable to parse the hosted web Prisma schema for catalog verification.");
  }
  const { datamodel } = dmmf;
  return {
    enums: datamodel.enums.map((entry) => ({
      name: entry.dbName ?? entry.name,
      values: entry.values.map((value) => value.dbName ?? value.name),
    })),
    tables: datamodel.models.map((model) => ({
      name: model.dbName ?? model.name,
      columns: model.fields
        .filter((field) => field.kind !== "object")
        .map((field) => field.dbName ?? field.name),
    })),
  };
}

export function findMissingHostedWebSchemaObjects(
  expected: HostedWebSchemaContract,
  catalog: HostedWebSchemaContract,
): string[] {
  const missing: string[] = [];
  for (const entry of expected.enums) {
    const actual = catalog.enums.find((candidate) => candidate.name === entry.name);
    if (!actual) {
      missing.push(`enum ${JSON.stringify(entry.name)}`);
      continue;
    }
    for (const value of entry.values) {
      if (!actual.values.includes(value)) {
        missing.push(`enum value ${JSON.stringify(entry.name)}.${JSON.stringify(value)}`);
      }
    }
  }
  for (const table of expected.tables) {
    const actual = catalog.tables.find((candidate) => candidate.name === table.name);
    if (!actual) {
      missing.push(`table ${JSON.stringify(table.name)}`);
      continue;
    }
    for (const column of table.columns) {
      if (!actual.columns.includes(column)) {
        missing.push(`column ${JSON.stringify(table.name)}.${JSON.stringify(column)}`);
      }
    }
  }
  return missing.sort();
}

export async function assertHostedWebSchemaContract(
  database: HostedWebMigrationOwnerDatabase,
  expected: HostedWebSchemaContract,
): Promise<void> {
  // Only schema-declared names and labels are returned; no application rows.
  // Both result counts and each aggregate are bounded by the schema input.
  const enums = await database.query(`
    SELECT type.typname AS name,
      COALESCE(array_agg(value.enumlabel::text) FILTER (WHERE value.enumlabel IS NOT NULL),
        ARRAY[]::text[]) AS values
    FROM jsonb_to_recordset($1::jsonb) AS expected(name text, values text[])
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = 'public'
    JOIN pg_catalog.pg_type AS type
      ON type.typnamespace = namespace.oid AND type.typname = expected.name
      AND type.typtype = 'e'
    LEFT JOIN pg_catalog.pg_enum AS value
      ON value.enumtypid = type.oid AND value.enumlabel::text = ANY(expected.values)
    GROUP BY type.typname
    LIMIT $2
  `, [JSON.stringify(expected.enums), expected.enums.length]);
  const tables = await database.query(`
    SELECT table_info.table_name AS name,
      COALESCE(array_agg(column_info.column_name::text)
        FILTER (WHERE column_info.column_name IS NOT NULL), ARRAY[]::text[]) AS columns
    FROM jsonb_to_recordset($1::jsonb) AS expected(name text, columns text[])
    JOIN information_schema.tables AS table_info
      ON table_info.table_schema = 'public' AND table_info.table_name = expected.name
      AND table_info.table_type = 'BASE TABLE'
    LEFT JOIN information_schema.columns AS column_info
      ON column_info.table_schema = table_info.table_schema
      AND column_info.table_name = table_info.table_name
      AND column_info.column_name::text = ANY(expected.columns)
    GROUP BY table_info.table_name
    LIMIT $2
  `, [JSON.stringify(expected.tables), expected.tables.length]);
  const missing = findMissingHostedWebSchemaObjects(expected, {
    enums: enums.rows.map((row) => ({ name: String(row.name), values: row.values as string[] })),
    tables: tables.rows.map((row) => ({ name: String(row.name), columns: row.columns as string[] })),
  });
  if (missing.length > 0) {
    throw new Error(`Hosted web schema contract failed; missing database objects:\n${missing.map((entry) => `- ${entry}`).join("\n")}`);
  }
}

export async function verifyHostedWebSchemaContract(databaseUrl: string): Promise<void> {
  const expected = await readHostedWebSchemaContract();
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
  });
  try {
    await client.connect();
    await assertHostedWebSchemaContract(client, expected);
  } finally {
    await client.end();
  }
  console.log("Hosted web schema contract passed: nothing missing.");
}
