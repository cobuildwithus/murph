import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyHostedWebMigrationOwner,
  withHostedWebMigrationOwner,
} from "./hosted-web-migration-owner";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOSTED_WEB_PRISMA_MIGRATIONS_DIR = path.join(CONFIG_DIR, "prisma", "migrations");
const KNOWN_POOLER_PORTS = new Set(["6432", "6543"]);
const SYSTEM_SSL_FILE_PARAMETERS = ["sslcert", "sslkey", "sslrootcert"] as const;

export const hostedWebPrismaPredeployDestructiveMigrationBaseline =
  "20260707170000_drop_stale_linq_recency_columns";

const hostedWebPrismaPredeployHistoricalMigrationIds = new Set([
  "2026040600_init",
  "20260425000000_drop_legacy_linq_control_plane",
  "20260425010000_drop_revnet_issuance",
  "20260426000000_hosted_member_pending_activation_timezone",
  "20260426010000_hosted_mailbox_workspace_groundwork",
  "20260426020000_hosted_mailbox_payload_hash",
  "2026042700_hosted_runtime_hard_cut",
  "20260428010000_drop_hosted_share_tables",
  "20260429020000_hosted_legal_consent",
  "20260501000000_hosted_user_crypto_envelopes",
  "20260501000001_hosted_user_crypto_envelope_hardening",
  "2026050100_device_connection_credentials_setup",
  "2026050101_device_connection_sources",
  "20260502000000_hosted_web_session",
  "2026050400_hosted_ai_usage_provider_request_outcome",
  "2026050401_hosted_ai_usage_sanitized_usage_metadata",
  "2026050402_device_oauth_session_metadata",
  "2026050403_linq_pending_participant_contact",
  "2026050500_device_sync_dirty_connection",
  "2026050501_stripe_checkout_email_authorization",
  "2026050502_hosted_ai_usage_allowance",
  "2026050503_pulse_trial_checkout_offer",
  "2026050601_hosted_ai_usage_limit_notice_sent",
  "2026050602_hosted_plan_switch_schedule_ref",
  "2026050801_device_webhook_trace_claim_token",
  "2026050802_device_connect_intent",
  "2026050900_hosted_web_session_row_cap_index",
  "2026051000_hosted_ai_usage_stripe_meter_skipped",
  "2026051900_device_connection_due_reconcile_sweep_idx",
  "2026052400_device_connection_refresh_lease",
  "2026052600_device_sync_dirty_payload",
  "2026052700_hosted_ingress_latency_trace",
  "2026052700_hosted_runtime_log_event_cooldown_index",
  "2026052800_hosted_signup_welcome_email_attempt",
  "2026060300_hosted_latency_milestones",
  "2026060501_device_sync_source_confirmed_backfill",
  "2026060900_hosted_latency_phase_breakdown",
  "2026061000_hosted_mailbox_consumed_seq",
  "2026061000_hosted_vault_share",
  "2026061001_hosted_ai_usage_turn_profile",
  "2026061500_hosted_ai_usage_token_pricing_basis",
  "2026061500_hosted_signup_notification_email_attempt",
  "2026061700_hosted_computer_use",
  "2026061800_hosted_family_plan",
  "2026062100_hosted_computer_single_member_profile",
  "2026062101_hosted_subscription_cancellation_email_sent",
  "20260622120000_connected_apps",
  "20260622190000_add_hosted_product_feedback",
  "20260623060000_hosted_workspace_inbox_media_retention_wake",
  "20260623120000_hosted_codex_auth_connection",
  "20260623170000_generalize_hosted_product_feedback",
  "20260623193000_hosted_product_feedback_summary",
  "20260624000000_clear_hosted_codex_auth_connected",
  "20260624090000_hosted_sensitive_action_challenge",
  "20260624120000_hosted_thread_routes",
  "20260624150000_hosted_sensitive_action_approval",
  "20260624200000_hosted_action_approval_return_contact_kind",
  "20260624210000_family_invite_telegram_username_lookup",
  "20260624230000_family_invite_email_lookup",
  "20260625000100_hosted_phone_calls",
  "2026062500_hosted_linq_observability",
  "2026062501_hosted_linq_egress_engagement",
  "20260625150000_hosted_action_approval_consumed_at",
  "20260626000000_linq_first_contact_admission_decision",
  "2026062600_computer_handoff_return_contact_kind",
  "20260626010000_linq_first_contact_admission_budget",
  "20260627210000_linq_first_contact_admission_drop_category",
  "20260627230000_hosted_linq_contact_card_share",
  "20260627230000_linq_first_contact_rejected_message_text",
  "20260628000000_linq_first_contact_scrub_rejected_message_text",
  "20260628010000_linq_first_contact_drop_rejected_message_text",
  "20260629160000_computer_handoff_viewport_session_hint",
  "20260630190000_hosted_linq_db_home_lines",
  "20260701040000_hosted_groups",
  "20260701050000_hosted_vault_share_drop_source",
  "20260701153000_hosted_vault_share_active_indexes",
  "20260703160000_device_oauth_session_consumed_at",
  "20260705120000_hosted_mailbox_item_consumed_at",
  "20260706120000_hosted_thread_container_participant",
  "20260706130000_hosted_group_join_offer",
  "20260706130000_hosted_growth_daily_snapshot",
  "20260707170000_drop_stale_linq_recency_columns",
  "20260707180000_hosted_vault_share_projection_scopes",
]);

const hostedWebPrismaPredeployCompatibleMigrationReasons = new Map([
  [
    "20260810010000_member_owned_device_provider_applications",
    // Both application-binding columns are introduced nullable in this same
    // migration, so every existing row has the accepted all-null shape. The
    // NOT VALID checks avoid a table scan while still enforcing the paired,
    // positive revision shape for every subsequent insert or update.
    new Set(["ADD CONSTRAINT CHECK"]),
  ],
  [
    "20260727040000_relax_hosted_usage_credit_detached_direct_proof",
    new Set(["ADD CONSTRAINT CHECK", "DROP CONSTRAINT"]),
  ],
  [
    "20260810050000_relax_detached_automatic_refill_failure",
    // This replacement only admits the terminal, reference-free automatic
    // refill failure already accepted by the account-deletion owner.
    new Set(["ADD CONSTRAINT CHECK", "DROP CONSTRAINT"]),
  ],
  [
    "20260728030000_hosted_usage_referral_credit_entry_constraints",
    new Set(["ADD CONSTRAINT CHECK", "DROP CONSTRAINT"]),
  ],
  [
    "20260729190000_composable_usage_referral_missions",
    // The replacement indexes are created first. Dropping the old indexes
    // only relaxes cardinality, so both the old and new application remain
    // valid throughout the Vercel deploy window.
    new Set(["DROP INDEX"]),
  ],
  [
    "20260730120000_hosted_capped_group_sponsorship",
    // The new sponsorship columns are nullable, so every old writer produces
    // the all-null shape accepted by the NOT VALID check. The replacement
    // active-payer index is created before the old, stricter index is dropped;
    // removing it only permits independent automatic refill purchases.
    new Set(["ADD CONSTRAINT CHECK", "DROP INDEX"]),
  ],
  [
    "20260809160000_add_hosted_family_max_plan_code",
    // Membership and invite assignments are already required by the Prisma
    // schema and every supported writer. Reasserting that contract here
    // replaces the superseded postdeploy migration, while each check only
    // widens the existing Pulse/Edge vocabulary with Max. Old writers remain
    // valid before, during, and after the transaction.
    new Set([
      "ADD CONSTRAINT CHECK",
      "ALTER COLUMN SET NOT NULL",
      "DROP CONSTRAINT",
    ]),
  ],
  [
    "20260810150000_hosted_usage_credit_grant_slot_release",
    // The insert trigger derives the new immutable grant identity from the
    // canonical entry before either NOT NULL check runs, so the prior writer
    // remains valid throughout the Vercel deploy window.
    new Set(["ALTER COLUMN SET NOT NULL"]),
  ],
]);

const incompatiblePredeploySqlPatterns = [
  {
    label: "ADD CONSTRAINT CHECK",
    pattern: /\bADD\s+CONSTRAINT\b[\s\S]{0,480}?\bCHECK\s*\(/iu,
  },
  {
    label: "ADD COLUMN NOT NULL",
    pattern: /\bADD\s+COLUMN\b[\s\S]{0,240}?\bNOT\s+NULL\b/iu,
  },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/iu },
  { label: "DROP CONSTRAINT", pattern: /\bDROP\s+CONSTRAINT\b/iu },
  { label: "DROP INDEX", pattern: /\bDROP\s+INDEX\b/iu },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/iu },
  { label: "DROP TYPE", pattern: /\bDROP\s+TYPE\b/iu },
  { label: "DROP VIEW", pattern: /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/iu },
  { label: "RENAME COLUMN", pattern: /\bRENAME\s+COLUMN\b/iu },
  { label: "RENAME TABLE", pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+TO\b/iu },
  {
    label: "ALTER COLUMN SET NOT NULL",
    pattern: /\bALTER\s+COLUMN\b[\s\S]{0,240}?\bSET\s+NOT\s+NULL\b/iu,
  },
  {
    label: "ALTER COLUMN TYPE",
    pattern: /\bALTER\s+COLUMN\b[\s\S]{0,240}?\b(?:SET\s+DATA\s+)?TYPE\b/iu,
  },
] as const;

export const hostedWebPrismaMigrateDeployCommand = {
  command: resolvePnpmCommand(),
  args: ["--dir", "apps/web", "exec", "prisma", "migrate", "deploy"],
} as const;

export type HostedWebMigrationEnvironment = Record<string, string | undefined>;

export type HostedWebMigrationRunner = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => Promise<void>;

export interface HostedWebPrismaMigrateDeployOptions {
  prismaMigrationsDir?: string;
  verifyMigrationOwner?: (databaseUrl: string) => Promise<void>;
}

export interface HostedWebMigrationDatabaseUrl {
  source: "DIRECT_DATABASE_URL" | "DATABASE_URL";
  url: string;
}

export interface HostedWebPredeployDestructiveMigration {
  migrationId: string;
  reason: string;
  sqlPath: string;
}

export function resolveHostedWebMigrationDatabaseUrl(
  environment: HostedWebMigrationEnvironment,
): HostedWebMigrationDatabaseUrl {
  const directDatabaseUrl = nonEmptyEnv(environment.DIRECT_DATABASE_URL);

  if (directDatabaseUrl !== undefined) {
    const normalizedDirectDatabaseUrl =
      normalizeHostedWebMigrationDatabaseUrl(directDatabaseUrl);
    assertDirectMigrationDatabaseUrl(
      normalizedDirectDatabaseUrl,
      "DIRECT_DATABASE_URL",
    );
    return { source: "DIRECT_DATABASE_URL", url: normalizedDirectDatabaseUrl };
  }

  if (shouldRequireDirectDatabaseUrl(environment)) {
    throw new Error(
      "DIRECT_DATABASE_URL is required for hosted web production migrations. Set it to the direct Postgres endpoint, not the pooled runtime DATABASE_URL.",
    );
  }

  const databaseUrl = nonEmptyEnv(environment.DATABASE_URL);
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required when DIRECT_DATABASE_URL is not set.");
  }

  assertDirectMigrationDatabaseUrl(databaseUrl, "DATABASE_URL");
  return {
    source: "DATABASE_URL",
    url: normalizeHostedWebMigrationDatabaseUrl(databaseUrl),
  };
}

export function normalizeHostedWebMigrationDatabaseUrl(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return databaseUrl;
  }

  for (const key of SYSTEM_SSL_FILE_PARAMETERS) {
    if (parsed.searchParams.get(key) === "system") {
      parsed.searchParams.delete(key);
    }
  }

  return parsed.toString();
}

export function assertDirectMigrationDatabaseUrl(
  databaseUrl: string,
  source: "DIRECT_DATABASE_URL" | "DATABASE_URL",
): void {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return;
  }

  if (
    (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
    KNOWN_POOLER_PORTS.has(parsed.port)
  ) {
    throw new Error(
      `${source} points at known pooled Postgres port ${parsed.port}; use the direct database endpoint for Prisma migrations.`,
    );
  }
}

export async function runHostedWebPrismaMigrateDeploy(
  environment: HostedWebMigrationEnvironment = process.env,
  runCommand: HostedWebMigrationRunner = runCommandInherited,
  options: HostedWebPrismaMigrateDeployOptions = {},
): Promise<void> {
  await assertHostedWebPrismaPredeployMigrationsAreExpandOnly(
    options.prismaMigrationsDir,
  );

  const migrationDatabaseUrl = resolveHostedWebMigrationDatabaseUrl(environment);
  const ownerDatabaseUrl = withHostedWebMigrationOwner(migrationDatabaseUrl.url);
  await (options.verifyMigrationOwner ?? verifyHostedWebMigrationOwner)(
    ownerDatabaseUrl,
  );
  console.log(`Applying hosted web Prisma migrations with ${migrationDatabaseUrl.source}.`);
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ...environment,
    DATABASE_URL: ownerDatabaseUrl,
  };
  if (migrationDatabaseUrl.source === "DIRECT_DATABASE_URL") {
    childEnvironment.DIRECT_DATABASE_URL = ownerDatabaseUrl;
  }

  await runCommand(
    hostedWebPrismaMigrateDeployCommand.command,
    hostedWebPrismaMigrateDeployCommand.args,
    childEnvironment,
  );
}

export async function assertHostedWebPrismaPredeployMigrationsAreExpandOnly(
  migrationsDir = HOSTED_WEB_PRISMA_MIGRATIONS_DIR,
): Promise<void> {
  const destructiveMigrations =
    await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

  if (destructiveMigrations.length === 0) {
    return;
  }

  const summary = destructiveMigrations
    .map((migration) => `${migration.migrationId} (${migration.reason})`)
    .join(", ");

  throw new Error(
    `Destructive or incompatible hosted web Prisma migration(s) cannot run in the predeploy Prisma path outside the frozen hosted web migration history set ending at ${hostedWebPrismaPredeployDestructiveMigrationBaseline}: ${summary}. Use an expand/backfill/switch/final-cleanup sequence; only final cleanup SQL belongs in apps/web/prisma/contract-migrations after production promotion.`,
  );
}

export async function findHostedWebPrismaPredeployDestructiveMigrations(
  migrationsDir = HOSTED_WEB_PRISMA_MIGRATIONS_DIR,
): Promise<HostedWebPredeployDestructiveMigration[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const violations: HostedWebPredeployDestructiveMigration[] = [];

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      hostedWebPrismaPredeployHistoricalMigrationIds.has(entry.name)
    ) {
      continue;
    }

    const sqlPath = path.join(migrationsDir, entry.name, "migration.sql");
    const sql = stripSqlComments(await readFile(sqlPath, "utf8"));
    const compatibleReasons =
      hostedWebPrismaPredeployCompatibleMigrationReasons.get(entry.name);
    const destructivePattern = incompatiblePredeploySqlPatterns.find(
      ({ label, pattern }) =>
        pattern.test(sql) && !compatibleReasons?.has(label),
    );

    if (destructivePattern !== undefined) {
      violations.push({
        migrationId: entry.name,
        reason: destructivePattern.label,
        sqlPath,
      });
    }
  }

  return violations;
}

async function main(): Promise<void> {
  loadHostedWebEnvFiles();
  await runHostedWebPrismaMigrateDeploy();
}

function loadHostedWebEnvFiles(): void {
  for (const envPath of [".env.local", ".env"]) {
    const absoluteEnvPath = path.join(CONFIG_DIR, envPath);

    if (existsSync(absoluteEnvPath)) {
      process.loadEnvFile(absoluteEnvPath);
    }
  }
}

function shouldRequireDirectDatabaseUrl(environment: HostedWebMigrationEnvironment): boolean {
  return (
    environment.MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS === "1" ||
    (environment.VERCEL === "1" && environment.VERCEL_ENV === "production")
  );
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gmu, "").replace(/\/\*[\s\S]*?\*\//gu, "");
}

function runCommandInherited(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: resolveRepoRoot(),
      env: environment,
      stdio: "inherit",
    } satisfies SpawnOptions);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with ${formatExitStatus(code, signal)}.`));
    });
  });
}

function resolveRepoRoot(): URL {
  return new URL("../../../", import.meta.url);
}

function resolvePnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function formatExitStatus(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `exit code ${code}`;
  }

  return signal === null ? "unknown status" : `signal ${signal}`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
