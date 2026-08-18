import { Client } from "pg";

export const hostedWebMigrationOwnerRole = "postgres";

const HOSTED_WEB_MIGRATION_OWNER_CONNECTION_OPTION =
  `-c role=${hostedWebMigrationOwnerRole}`;

export interface HostedWebMigrationOwnerDatabase {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export function withHostedWebMigrationOwner(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return databaseUrl;
  }

  const existingOptions = parsed.searchParams.get("options")?.trim();
  parsed.searchParams.set(
    "options",
    existingOptions === undefined || existingOptions.length === 0
      ? HOSTED_WEB_MIGRATION_OWNER_CONNECTION_OPTION
      : `${existingOptions} ${HOSTED_WEB_MIGRATION_OWNER_CONNECTION_OPTION}`,
  );
  parsed.search = parsed.searchParams.toString().replaceAll("+", "%20");
  return parsed.toString();
}

export async function assertHostedWebMigrationOwner(
  database: HostedWebMigrationOwnerDatabase,
): Promise<void> {
  const result = await database.query(
    `
      SELECT
        current_user = $1::name AS is_canonical_owner,
        EXISTS (
          SELECT 1
          FROM pg_class AS relation
          INNER JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = '_prisma_migrations'
            AND relation.relkind IN ('r', 'p')
        ) AS prisma_migration_ledger_exists,
        EXISTS (
          SELECT 1
          FROM pg_class AS relation
          INNER JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          INNER JOIN pg_roles AS owner
            ON owner.oid = relation.relowner
          WHERE namespace.nspname = 'public'
            AND relation.relname = '_prisma_migrations'
            AND relation.relkind IN ('r', 'p')
            AND owner.rolname = $1
        ) AS owns_prisma_migration_ledger
    `,
    [hostedWebMigrationOwnerRole],
  );
  const row = result.rows[0];

  if (row?.is_canonical_owner !== true) {
    throw new Error(
      "Hosted web migration connection did not assume the canonical schema owner before DDL.",
    );
  }
  if (
    row.prisma_migration_ledger_exists === true &&
    row.owns_prisma_migration_ledger !== true
  ) {
    throw new Error(
      "Hosted web canonical schema owner does not own the Prisma migration ledger; repair database ownership before running migrations.",
    );
  }
}

export async function verifyHostedWebMigrationOwner(
  databaseUrl: string,
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await assertHostedWebMigrationOwner(client);
  } finally {
    await client.end();
  }
}
