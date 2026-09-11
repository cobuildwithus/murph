import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client, type ClientConfig } from "pg";

export type DatabaseProofResult = "different database" | "unable to verify";
export type DatabaseProofReference = {
  salt: string;
  fingerprint: string;
  expiresAt: number;
};

// The reference collector runs this same query through the approved read-only
// production helper. Only a fresh salted digest leaves that connection.
export const databaseProofSql = `
SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  $1 || ':' || system_identifier::text || ':' || pg_catalog.current_database(),
  'UTF8'
)), 'hex') AS fingerprint,
NOT pg_catalog.pg_is_in_recovery() AS is_primary,
pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only
FROM pg_catalog.pg_control_system()
LIMIT 1`;

export function readProofReference(value: string | undefined, now = Date.now()): DatabaseProofReference | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (!parsed || typeof parsed !== "object") return null;
    if (!("salt" in parsed) || typeof parsed.salt !== "string" || !/^[a-f0-9]{64}$/u.test(parsed.salt)) return null;
    if (!("fingerprint" in parsed) || typeof parsed.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(parsed.fingerprint)) return null;
    if (!("expiresAt" in parsed) || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt <= now || parsed.expiresAt > now + 15 * 60_000) return null;
    return { salt: parsed.salt, fingerprint: parsed.fingerprint, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function databaseProofClientConfig(value: string): ClientConfig {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("Invalid database proof endpoint.");
  }
  // URL options must not override read-only mode, deadlines, or verified TLS.
  url.search = "";
  url.hash = "";
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    application_name: "murph-preview-database-proof",
    options: "-c default_transaction_read_only=on -c statement_timeout=3000 -c lock_timeout=500 -c search_path=pg_catalog",
    connectionTimeoutMillis: 4_000,
    query_timeout: 4_000,
  };
}

export async function readDatabaseFingerprint(url: string, salt: string): Promise<string> {
  const client = new Client(databaseProofClientConfig(url));
  // Driver errors may contain credentials or private hostnames. The caller
  // converts every failure into the closed result without printing the error.
  client.on("error", () => undefined);
  try {
    await client.connect();
    const result = await client.query<{ fingerprint: string; is_primary: boolean; read_only: boolean }>(databaseProofSql, [salt]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row || row.is_primary !== true || row.read_only !== true
      || typeof row.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(row.fingerprint)) {
      throw new Error("Database proof unavailable.");
    }
    return row.fingerprint;
  } finally {
    await client.end();
  }
}

export async function provePreviewDatabaseIsolation(
  environment: Record<string, string | undefined>,
  readFingerprint = readDatabaseFingerprint,
  now = Date.now,
): Promise<DatabaseProofResult> {
  const reference = readProofReference(environment.MURPH_DATABASE_PROOF_REFERENCE, now());
  if (environment.VERCEL !== "1" || environment.VERCEL_ENV !== "preview" || !reference
    || !environment.DATABASE_URL || !environment.DIRECT_DATABASE_URL) return "unable to verify";
  try {
    const runtime = await readFingerprint(environment.DATABASE_URL, reference.salt);
    const direct = await readFingerprint(environment.DIRECT_DATABASE_URL, reference.salt);
    if (now() >= reference.expiresAt || runtime !== direct || runtime === reference.fingerprint) return "unable to verify";
    // Physical clones can retain a system identifier: equality cannot establish
    // the same database. Distinct identities establish separate databases only.
    return "different database";
  } catch {
    return "unable to verify";
  }
}

async function main(): Promise<void> {
  const build = process.argv.includes("--vercel-build");
  if (build && (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "preview")) {
    process.stdout.write("unable to verify\n");
    process.exitCode = 1;
    return;
  }
  const reference = build
    ? await readFile("reference.json", "utf8").catch(() => undefined)
    : process.env.MURPH_DATABASE_PROOF_REFERENCE;
  const result = await provePreviewDatabaseIsolation({
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    MURPH_DATABASE_PROOF_REFERENCE: reference,
  });
  if (build) {
    const output = resolve(".vercel/output");
    await mkdir(resolve(".vercel"), { recursive: true });
    // Refuse cached output: this build must publish only the coarse result.
    await mkdir(output);
    await mkdir(resolve(output, "static"));
    await writeFile(resolve(output, "config.json"), JSON.stringify({ version: 3 }));
    await writeFile(resolve(output, "static/result.txt"), `${result}\n`);
  }
  process.stdout.write(`${result}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stdout.write("unable to verify\n");
    process.exitCode = 1;
  });
}
