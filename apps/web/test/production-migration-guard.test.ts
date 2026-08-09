import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test, vi } from "vitest";

import {
  assertHostedWebMigrationOwner,
  hostedWebMigrationOwnerRole,
  withHostedWebMigrationOwner,
} from "../scripts/hosted-web-migration-owner";
import {
  applyHostedWebContractMigrations,
  listHostedWebContractMigrations,
  runHostedWebProductionContractMigrationsIfNeeded,
  shouldRunHostedWebProductionContractMigrations,
  type HostedWebContractMigrationClient,
  type HostedWebContractMigration,
} from "../scripts/run-production-contract-migrations";
import {
  resolveVercelProductionAliasSha,
  verifyVercelProductionDeploymentProtection,
} from "../scripts/resolve-vercel-production-alias-sha";
import {
  prepareHostedWebPrismaClientForBuild,
} from "../scripts/prepare-prisma-client-for-build";
import {
  assertHostedGroupFundingRecoveryConfiguration,
  hostedRuntimeLogProductionMigrationCommand,
  hostedWebProductionLinqLineSyncCommand,
  hostedWebProductionMigrationCommand,
  hostedWebProductionPrismaGenerateCommand,
  runHostedWebProductionMigrationsIfNeeded,
  shouldRunHostedWebProductionMigrations,
  type HostedWebProductionMigrationEnvironment,
} from "../scripts/run-production-migrations";
import {
  assertHostedWebPrismaPredeployMigrationsAreExpandOnly,
  findHostedWebPrismaPredeployDestructiveMigrations,
  hostedWebPrismaMigrateDeployCommand,
  hostedWebPrismaPredeployDestructiveMigrationBaseline,
  normalizeHostedWebMigrationDatabaseUrl,
  runHostedWebPrismaMigrateDeploy,
  resolveHostedWebMigrationDatabaseUrl,
} from "../scripts/run-prisma-migrate-deploy";

const appTestDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(appTestDir, "..");

describe("hosted web production migration guard", () => {
  test("runs only for main-branch Vercel production deploys", () => {
    const runnable: HostedWebProductionMigrationEnvironment = {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    };

    assert.equal(shouldRunHostedWebProductionMigrations(runnable), true);

    const skippedEnvironments: HostedWebProductionMigrationEnvironment[] = [
      {},
      { NODE_ENV: "development" },
      { CI: "1" },
      { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
      { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feature" },
      { VERCEL: "0", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
      { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    ];

    for (const environment of skippedEnvironments) {
      assert.equal(shouldRunHostedWebProductionMigrations(environment), false);
    }
  });

  test("skips without invoking Prisma outside the gated deploy environment", async () => {
    const skippedEnvironments: HostedWebProductionMigrationEnvironment[] = [
      {},
      { NODE_ENV: "development" },
      { CI: "1" },
      { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
      { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feature" },
    ];

    for (const environment of skippedEnvironments) {
      let commandRan = false;

      const result = await runHostedWebProductionMigrationsIfNeeded(environment, async () => {
        commandRan = true;
      });

      assert.equal(result, "skipped");
      assert.equal(commandRan, false);
    }
  });

  test("preflights the session key and runs production commands without operator Vercel credentials", async () => {
    const calls: Array<{ args: readonly string[]; command: string }> = [];
    const environment = {
      HOSTED_APP_SESSION_HMAC_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    };

    const result = await runHostedWebProductionMigrationsIfNeeded(
      environment,
      async (command, args) => {
        calls.push({ args, command });
      },
    );

    assert.equal(result, "ran");
    assert.deepEqual(calls, [
      {
        command: hostedRuntimeLogProductionMigrationCommand.command,
        args: ["--dir", "apps/web", "runtime-logs:migrate:deploy"],
      },
      {
        command: hostedWebProductionMigrationCommand.command,
        args: ["--dir", "apps/web", "prisma:migrate:deploy"],
      },
      {
        command: hostedWebProductionPrismaGenerateCommand.command,
        args: ["--dir", "apps/web", "prisma:generate"],
      },
      {
        command: hostedWebProductionLinqLineSyncCommand.command,
        args: ["--dir", "apps/web", "linq:sync-lines", "--", "--skip-provider-inventory"],
      },
    ]);
  });

  test("preflights the canonical session key before migrations", async () => {
    let commands = 0;
    await assert.rejects(
      () => runHostedWebProductionMigrationsIfNeeded(
        { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", HOSTED_APP_SESSION_HMAC_KEY: "not-canonical" },
        async () => { commands += 1; },
      ),
      /HOSTED_APP_SESSION_HMAC_KEY/u,
    );
    assert.equal(commands, 0);
  });

  test("preflights a signed funding recovery URL on the configured origin", () => {
    assert.doesNotThrow(() => assertHostedGroupFundingRecoveryConfiguration({
      HOSTED_APP_SESSION_HMAC_KEY:
        "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
    }));
  });

  test.each([
    [
      "missing",
      undefined,
      /hosted public base URL is required/u,
    ],
    [
      "malformed",
      "https://[invalid",
      /Invalid URL/u,
    ],
    [
      "pathful",
      "https://join.example.test/app",
      /must not include a path/u,
    ],
    [
      "non-HTTPS",
      "http://localhost:3000",
      /must use HTTPS/u,
    ],
  ])("rejects a %s funding recovery origin before migrations", (
    _label,
    publicBaseUrl,
    expected,
  ) => {
    assert.throws(
      () => assertHostedGroupFundingRecoveryConfiguration({
        HOSTED_APP_SESSION_HMAC_KEY:
          "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        ...(publicBaseUrl
          ? { HOSTED_ONBOARDING_PUBLIC_BASE_URL: publicBaseUrl }
          : {}),
      }),
      expected,
    );
  });

  test("rejects an unusable funding recovery signing authority", () => {
    assert.throws(
      () => assertHostedGroupFundingRecoveryConfiguration({
        HOSTED_APP_SESSION_HMAC_KEY: "not-canonical",
        HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      }),
      /HOSTED_APP_SESSION_HMAC_KEY/u,
    );
  });

  test("reuses the Prisma client only after the guarded production migration step", async () => {
    let commands = 0;
    const result = await prepareHostedWebPrismaClientForBuild(
      {
        MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS: "1",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
      },
      async () => { commands += 1; },
    );

    assert.equal(result, "reused");
    assert.equal(commands, 0);
  });

  test("generates the Prisma client for ordinary and preview builds", async () => {
    const environments: HostedWebProductionMigrationEnvironment[] = [
      {},
      {
        MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS: "1",
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature",
      },
    ];

    for (const environment of environments) {
      const calls: Array<{ args: readonly string[]; command: string }> = [];
      const result = await prepareHostedWebPrismaClientForBuild(
        environment,
        async (command, args) => { calls.push({ args, command }); },
      );

      assert.equal(result, "generated");
      assert.deepEqual(calls, [hostedWebProductionPrismaGenerateCommand]);
    }
  });

  test("rejects an invalid production Prisma handoff marker", async () => {
    await assert.rejects(
      () => prepareHostedWebPrismaClientForBuild(
        { MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS: "yes" },
        async () => undefined,
      ),
      /MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS must be 0 or 1/u,
    );
  });

  test("blocks future destructive Prisma migrations before Vercel deploy promotion", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );

    try {
      await writeMigrationSql(
        migrationsDir,
        hostedWebPrismaPredeployDestructiveMigrationBaseline,
        'ALTER TABLE "hosted_member_routing" DROP COLUMN "legacy_value";',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707170001_add_expand_column",
        'ALTER TABLE "hosted_member_routing" ADD COLUMN "expand_value" TEXT;',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707170002_drop_contract_column",
        'ALTER TABLE "hosted_member_routing" DROP COLUMN "contract_value";',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707170003_rename_contract_column",
        'ALTER TABLE "hosted_member_routing" RENAME COLUMN "expand_value" TO "contract_value";',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707170004_set_not_null",
        'ALTER TABLE "hosted_member_routing" ALTER COLUMN "contract_value" SET NOT NULL;',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707170005_add_required_column",
        'ALTER TABLE "hosted_member_routing" ADD COLUMN "required_value" TEXT NOT NULL;',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707170006_add_validating_check",
        'ALTER TABLE "hosted_mailbox_item" ADD CONSTRAINT "required_value_check" CHECK ("required_value" IS NOT NULL);',
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId, reason }) => ({
          migrationId,
          reason,
        })),
        [
          {
            migrationId: "20260707170002_drop_contract_column",
            reason: "DROP COLUMN",
          },
          {
            migrationId: "20260707170003_rename_contract_column",
            reason: "RENAME COLUMN",
          },
          {
            migrationId: "20260707170004_set_not_null",
            reason: "ALTER COLUMN SET NOT NULL",
          },
          {
            migrationId: "20260707170005_add_required_column",
            reason: "ADD COLUMN NOT NULL",
          },
          {
            migrationId: "20260707170006_add_validating_check",
            reason: "ADD CONSTRAINT CHECK",
          },
        ],
      );
      await assert.rejects(
        () => assertHostedWebPrismaPredeployMigrationsAreExpandOnly(migrationsDir),
        /apps\/web\/prisma\/contract-migrations/u,
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("keeps existing hosted web Prisma migration history exempt", async () => {
    await assert.doesNotReject(() =>
      assertHostedWebPrismaPredeployMigrationsAreExpandOnly(
        path.join(appRoot, "prisma", "migrations"),
      ),
    );
  });

  test("limits the detached direct-proof predeploy exception to its proved DDL", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    const migrationId =
      "20260727040000_relax_hosted_usage_credit_detached_direct_proof";

    try {
      await writeMigrationSql(
        migrationsDir,
        migrationId,
        [
          'ALTER TABLE "hosted_usage_credit_purchase"',
          '  DROP CONSTRAINT "hosted_usage_credit_purchase_active_payer_required",',
          '  ADD CONSTRAINT "hosted_usage_credit_purchase_active_payer_required"',
          '    CHECK ("payer_member_id" IS NOT NULL);',
          'DROP TABLE "hosted_member";',
        ].join("\n"),
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId: id, reason }) => ({
          migrationId: id,
          reason,
        })),
        [{
          migrationId,
          reason: "DROP TABLE",
        }],
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("limits the referral ledger constraint predeploy exception to its proved DDL", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    const migrationId =
      "20260728030000_hosted_usage_referral_credit_entry_constraints";

    try {
      await writeMigrationSql(
        migrationsDir,
        migrationId,
        [
          'ALTER TABLE "hosted_usage_credit_entry"',
          '  DROP CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid",',
          '  ADD CONSTRAINT "hosted_usage_credit_entry_amount_direction_valid"',
          '    CHECK ("amount_usd_micros" <> 0) NOT VALID;',
          'DROP TABLE "hosted_member";',
        ].join("\n"),
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId: id, reason }) => ({
          migrationId: id,
          reason,
        })),
        [{
          migrationId,
          reason: "DROP TABLE",
        }],
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("limits the composable referral index relaxation to its proved DDL", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    const migrationId =
      "20260729190000_composable_usage_referral_missions";

    try {
      await writeMigrationSql(
        migrationsDir,
        migrationId,
        [
          'DROP INDEX "hosted_usage_referral_target_container_key";',
          'DROP INDEX "hosted_usage_referral_one_armed_per_referrer";',
          'DROP TABLE "hosted_member";',
        ].join("\n"),
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId: id, reason }) => ({
          migrationId: id,
          reason,
        })),
        [{
          migrationId,
          reason: "DROP TABLE",
        }],
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("limits capped sponsorship predeploy compatibility to its proved DDL", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    const migrationId = "20260730120000_hosted_capped_group_sponsorship";

    try {
      await writeMigrationSql(
        migrationsDir,
        migrationId,
        [
          'ALTER TABLE "hosted_usage_credit_purchase"',
          '  ADD CONSTRAINT "sponsorship_shape"',
          '    CHECK ("group_sponsorship_authorization_id" IS NULL) NOT VALID;',
          'DROP INDEX "hosted_usage_credit_purchase_active_payer_key";',
          'DROP TABLE "hosted_member";',
        ].join("\n"),
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId: id, reason }) => ({
          migrationId: id,
          reason,
        })),
        [{
          migrationId,
          reason: "DROP TABLE",
        }],
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("limits the complete Family Max plan-code contract to its proved DDL", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    const migrationId = "20260809160000_add_hosted_family_max_plan_code";

    try {
      await writeMigrationSql(
        migrationsDir,
        migrationId,
        [
          'ALTER TABLE "hosted_account_group_membership"',
          '  ALTER COLUMN "plan_code" SET NOT NULL,',
          '  DROP CONSTRAINT "hosted_account_group_membership_plan_code_check",',
          '  ADD CONSTRAINT "hosted_account_group_membership_plan_code_check"',
          '    CHECK ("plan_code" IN (\'pulse\', \'edge\', \'max\')) NOT VALID;',
          'DROP TABLE "hosted_member";',
        ].join("\n"),
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId: id, reason }) => ({
          migrationId: id,
          reason,
        })),
        [{
          migrationId,
          reason: "DROP TABLE",
        }],
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("keeps known post-baseline destructive migration history exempt", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );

    try {
      await writeMigrationSql(
        migrationsDir,
        hostedWebPrismaPredeployDestructiveMigrationBaseline,
        'ALTER TABLE "hosted_member_routing" DROP COLUMN "legacy_value";',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707180000_hosted_vault_share_projection_scopes",
        [
          'ALTER TABLE "hosted_vault_share"',
          '  ALTER COLUMN "projection_scope_key" SET NOT NULL;',
          'DROP INDEX IF EXISTS "hosted_vault_share_active_grantor_projection_idx";',
        ].join("\n"),
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(destructiveMigrations, []);
      await assert.doesNotReject(() =>
        assertHostedWebPrismaPredeployMigrationsAreExpandOnly(migrationsDir),
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("blocks newly introduced backdated destructive Prisma migrations", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    let commandRan = false;

    try {
      await writeMigrationSql(
        migrationsDir,
        hostedWebPrismaPredeployDestructiveMigrationBaseline,
        'ALTER TABLE "hosted_member_routing" DROP COLUMN "legacy_value";',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707165959_drop_contract_column",
        'ALTER TABLE "hosted_member_routing" DROP COLUMN "contract_value";',
      );

      const destructiveMigrations =
        await findHostedWebPrismaPredeployDestructiveMigrations(migrationsDir);

      assert.deepEqual(
        destructiveMigrations.map(({ migrationId, reason }) => ({
          migrationId,
          reason,
        })),
        [
          {
            migrationId: "20260707165959_drop_contract_column",
            reason: "DROP COLUMN",
          },
        ],
      );
      await assert.rejects(
        () =>
          runHostedWebPrismaMigrateDeploy(
            {
              DIRECT_DATABASE_URL: "postgresql://direct.example.com:5432/app",
            },
            async () => {
              commandRan = true;
            },
            { prismaMigrationsDir: migrationsDir },
          ),
        /Destructive or incompatible hosted web Prisma migration/u,
      );
      assert.equal(commandRan, false);
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("stops Prisma deploy before the database when a future destructive migration is present", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-prisma-migrations-"),
    );
    let commandRan = false;

    try {
      await writeMigrationSql(
        migrationsDir,
        "20260707180000_drop_contract_table",
        'DROP TABLE "hosted_obsolete_state";',
      );

      await assert.rejects(
        () =>
          runHostedWebPrismaMigrateDeploy(
            {
              DIRECT_DATABASE_URL: "postgresql://direct.example.com:5432/app",
            },
            async () => {
              commandRan = true;
            },
            { prismaMigrationsDir: migrationsDir },
          ),
        /Destructive or incompatible hosted web Prisma migration/u,
      );
      assert.equal(commandRan, false);
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("propagates migration failures so the production build stops", async () => {
    await assert.rejects(
      () =>
        runHostedWebProductionMigrationsIfNeeded(
          {
            HOSTED_APP_SESSION_HMAC_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
            VERCEL: "1",
            VERCEL_ENV: "production",
            VERCEL_GIT_COMMIT_REF: "main",
          },
          async () => {
            throw new Error("migration failed");
          },
        ),
      /migration failed/u,
    );
  });

  test("uses DIRECT_DATABASE_URL for Prisma migrations when it is configured", () => {
    assert.deepEqual(
      resolveHostedWebMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://runtime.example.com:5432/app",
        DIRECT_DATABASE_URL: "postgresql://direct.example.com:5432/app",
      }),
      {
        source: "DIRECT_DATABASE_URL",
        url: "postgresql://direct.example.com:5432/app",
      },
    );
  });

  test("normalizes Prisma system SSL file markers for raw migration clients", () => {
    assert.equal(
      normalizeHostedWebMigrationDatabaseUrl(
        "postgresql://direct.example.com:5432/app?sslmode=require&sslrootcert=system&sslcert=system&sslkey=system",
      ),
      "postgresql://direct.example.com:5432/app?sslmode=require",
    );
    assert.equal(
      normalizeHostedWebMigrationDatabaseUrl(
        "postgresql://direct.example.com:5432/app?sslrootcert=/etc/ssl/root.pem",
      ),
      "postgresql://direct.example.com:5432/app?sslrootcert=/etc/ssl/root.pem",
    );
  });

  test("uses normalized DIRECT_DATABASE_URL for migration clients", () => {
    assert.deepEqual(
      resolveHostedWebMigrationDatabaseUrl({
        DIRECT_DATABASE_URL:
          "postgresql://direct.example.com:5432/app?sslmode=require&sslrootcert=system",
      }),
      {
        source: "DIRECT_DATABASE_URL",
        url: "postgresql://direct.example.com:5432/app?sslmode=require",
      },
    );
  });

  test("pins every production migration connection to the canonical schema owner", () => {
    const ownerUrl = withHostedWebMigrationOwner(
      "postgresql://direct.example.com:5432/app?sslmode=require&options=-c%20statement_timeout%3D5000",
    );
    const parsed = new URL(ownerUrl);

    assert.equal(
      parsed.searchParams.get("options"),
      `-c statement_timeout=5000 -c role=${hostedWebMigrationOwnerRole}`,
    );
  });

  test("fails closed on ownership drift while allowing canonical bootstrap", async () => {
    const database = (
      isCanonicalOwner: boolean,
      ledgerExists: boolean,
      ownsLedger: boolean,
    ) => ({
      async query() {
        return {
          rows: [
            {
              is_canonical_owner: isCanonicalOwner,
              owns_prisma_migration_ledger: ownsLedger,
              prisma_migration_ledger_exists: ledgerExists,
            },
          ],
        };
      },
    });

    await assert.rejects(
      () => assertHostedWebMigrationOwner(database(false, true, true)),
      /did not assume the canonical schema owner/u,
    );
    await assert.rejects(
      () => assertHostedWebMigrationOwner(database(true, true, false)),
      /does not own the Prisma migration ledger/u,
    );
    await assertHostedWebMigrationOwner(database(true, false, false));
  });

  test("requires DIRECT_DATABASE_URL for Vercel production migrations", () => {
    assert.throws(
      () =>
        resolveHostedWebMigrationDatabaseUrl({
          VERCEL: "1",
          VERCEL_ENV: "production",
          DATABASE_URL: "postgresql://runtime.example.com:5432/app",
        }),
      /DIRECT_DATABASE_URL is required/u,
    );
  });

  test("rejects known pooled Postgres endpoints for Prisma migrations", () => {
    assert.throws(
      () =>
        resolveHostedWebMigrationDatabaseUrl({
          DIRECT_DATABASE_URL: "postgresql://pool.example.com:6432/app",
        }),
      /known pooled Postgres port 6432/u,
    );
  });

  test("rejects the other known pooled Postgres endpoint for Prisma migrations", () => {
    assert.throws(
      () =>
        resolveHostedWebMigrationDatabaseUrl({
          DIRECT_DATABASE_URL: "postgresql://pool.example.com:6543/app",
        }),
      /known pooled Postgres port 6543/u,
    );
  });

  test("verifies the canonical owner before passing the direct URL to Prisma", async () => {
    const calls: Array<{
      args: readonly string[];
      command: string;
      databaseUrl: string | undefined;
      directDatabaseUrl: string | undefined;
    }> = [];
    const events: string[] = [];
    const verifiedUrls: string[] = [];

    await runHostedWebPrismaMigrateDeploy(
      {
        DATABASE_URL: "postgresql://runtime.example.com:5432/app",
        DIRECT_DATABASE_URL:
          "postgresql://direct.example.com:5432/app?sslmode=require&sslrootcert=system",
      },
      async (command, args, environment) => {
        events.push("run");
        calls.push({
          args,
          command,
          databaseUrl: environment.DATABASE_URL,
          directDatabaseUrl: environment.DIRECT_DATABASE_URL,
        });
      },
      {
        async verifyMigrationOwner(databaseUrl) {
          events.push("verify:start");
          await Promise.resolve();
          events.push("verify:complete");
          verifiedUrls.push(databaseUrl);
        },
      },
    );

    const expectedOwnerUrl =
      "postgresql://direct.example.com:5432/app?sslmode=require&options=-c+role%3Dpostgres";
    assert.deepEqual(events, ["verify:start", "verify:complete", "run"]);
    assert.deepEqual(verifiedUrls, [expectedOwnerUrl]);
    assert.deepEqual(calls, [
      {
        command: hostedWebPrismaMigrateDeployCommand.command,
        args: hostedWebPrismaMigrateDeployCommand.args,
        databaseUrl: expectedOwnerUrl,
        directDatabaseUrl: expectedOwnerUrl,
      },
    ]);
  });

  test("requires explicit opt-in for hosted web contract migrations", async () => {
    assert.equal(shouldRunHostedWebProductionContractMigrations({}), false);
    assert.equal(
      shouldRunHostedWebProductionContractMigrations({
        MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS: "1",
      }),
      true,
    );
    assert.equal(
      await runHostedWebProductionContractMigrationsIfNeeded(
        {},
        { migrationsDir: path.join(appRoot, "missing-contract-migrations") },
      ),
      "skipped",
    );
  });

  test("lists hosted web contract migrations in id order with stable checksums", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-contract-migrations-"),
    );

    try {
      await writeMigrationSql(
        migrationsDir,
        "20260707180002_second",
        'ALTER TABLE "hosted_member_routing" DROP COLUMN IF EXISTS "second";',
      );
      await writeMigrationSql(
        migrationsDir,
        "20260707180001_first",
        'ALTER TABLE "hosted_member_routing" DROP COLUMN IF EXISTS "first";',
      );

      const migrations = await listHostedWebContractMigrations(migrationsDir);

      assert.deepEqual(
        migrations.map(({ id }) => id),
        ["20260707180001_first", "20260707180002_second"],
      );
      assert.ok(migrations[0]!.checksum.length > 0);
      assert.notEqual(migrations[0]!.checksum, migrations[1]!.checksum);
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("omits contract migrations superseded by predeploy proof constraints", async () => {
    const migrations = await listHostedWebContractMigrations();

    for (const migrationId of [
      "20260714150000_require_hosted_family_plan_codes",
      "20260720233000_hosted_group_usage_funding_invariants",
      "20260726123000_allow_hosted_usage_referral_credit_entries",
    ]) {
      assert.equal(
        migrations.some(({ id }) => id === migrationId),
        false,
      );
    }
    assert.equal(
      migrations.some(
        ({ id }) =>
          id === "20260728031000_resynchronize_hosted_usage_credit_purchase_grants",
      ),
      true,
    );
    assert.equal(
      migrations.some(
        ({ id }) =>
          id === "20260729183000_rebuild_linq_delivery_health_after_drain",
      ),
      true,
    );
  });

  test("checks the canonical owner before contract migration SQL", async () => {
    const migrationsDir = await mkdtemp(
      path.join(tmpdir(), "hosted-web-contract-owner-"),
    );
    const database = new FakeContractMigrationDatabase();
    let connectionString: string | undefined;

    try {
      await writeMigrationSql(
        migrationsDir,
        "20260707180000_owner_guard",
        'ALTER TABLE "hosted_member_routing" DROP COLUMN IF EXISTS "legacy";',
      );

      assert.equal(
        await runHostedWebProductionContractMigrationsIfNeeded(
          {
            DIRECT_DATABASE_URL: "postgresql://direct.example.com:5432/app",
            MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS: "1",
          },
          {
            clientFactory(ownerUrl) {
              connectionString = ownerUrl;
              return database;
            },
            migrationsDir,
          },
        ),
        "ran",
      );

      assert.equal(database.connected, true);
      assert.equal(database.ended, true);
      assert.equal(
        new URL(connectionString ?? "").searchParams.get("options"),
        `-c role=${hostedWebMigrationOwnerRole}`,
      );
      assert.ok(
        database.queries.findIndex((query) => query.includes("is_canonical_owner"))
          < database.queries.indexOf("BEGIN"),
        "contract migrations must verify canonical ownership before opening a DDL transaction",
      );
    } finally {
      await rm(migrationsDir, { force: true, recursive: true });
    }
  });

  test("keeps warm-old group join bridges until the post-drain contract lane", async () => {
    const sql = await readFile(
      path.join(
        appRoot,
        "prisma",
        "contract-migrations",
        "20260711230000_drop_group_join_compatibility_bridges",
        "migration.sql",
      ),
      "utf8",
    );

    assert.match(
      sql,
      /DROP TRIGGER IF EXISTS "hosted_group_join_confirmation_eligibility_bridge"/u,
    );
    assert.match(
      sql,
      /DROP TRIGGER IF EXISTS "hosted_linq_home_participant_clear_bridge"/u,
    );
    assert.match(sql, /DROP FUNCTION IF EXISTS set_hosted_group_join_confirmation_eligibility\(\)/u);
    assert.match(sql, /DROP FUNCTION IF EXISTS clear_orphaned_hosted_linq_home_participant\(\)/u);
  });

  test("repeats the Linq invite orphan scrub in the post-drain contract lane", async () => {
    const migrationId =
      "20260715150000_delete_orphaned_linq_invite_deliveries_after_drain";
    const migrations = await listHostedWebContractMigrations();
    const migration = migrations.find(({ id }) => id === migrationId);
    const predeploySql = await readFile(
      path.join(
        appRoot,
        "prisma",
        "migrations",
        "20260715120000_delete_orphaned_linq_invite_deliveries",
        "migration.sql",
      ),
      "utf8",
    );

    assert.ok(migration, `Expected contract migration ${migrationId}`);
    assert.equal(migration.sql, predeploySql);
  });

  test("pins the Linq invite deletion producer rollback floor in operator docs", async () => {
    const readme = await readFile(path.join(appRoot, "README.md"), "utf8");

    assert.match(
      readme,
      /Linq invite-delivery data-producer rollback floor is\s+`e67aedb61fd021f50cadae147b92006fef43b97e`/u,
    );
    assert.match(readme, /do not\s+roll Vercel below this floor/iu);
    assert.match(
      readme,
      /Rerunning the existing workflow is not a repair[\s\S]*recorded migration ID[\s\S]*make its SQL skip/u,
    );
    assert.match(
      readme,
      /new\s+timestamped cleanup migration or explicit operator SQL/u,
    );
  });

  test("applies hosted web contract migrations idempotently and rejects checksum drift", async () => {
    const database = new FakeContractMigrationDatabase();
    const migration: HostedWebContractMigration = {
      checksum: "checksum-1",
      id: "20260707180000_drop_legacy_column",
      sql: 'ALTER TABLE "hosted_member_routing" DROP COLUMN IF EXISTS "legacy";',
      sqlPath: "migration.sql",
    };

    assert.deepEqual(
      await applyHostedWebContractMigrations(database, [migration]),
      { applied: 1, skipped: 0 },
    );
    assert.ok(
      database.queries.indexOf("SET LOCAL lock_timeout = '5s'")
        < database.queries.indexOf(migration.sql),
      "contract migrations must set a short lock timeout before DDL",
    );
    assert.ok(
      database.queries.indexOf("SET LOCAL statement_timeout = '30s'")
        < database.queries.indexOf(migration.sql),
      "contract migrations must bound statement runtime before DDL",
    );
    assert.deepEqual(
      await applyHostedWebContractMigrations(database, [migration]),
      { applied: 0, skipped: 1 },
    );
    await assert.rejects(
      () =>
        applyHostedWebContractMigrations(database, [
          {
            ...migration,
            checksum: "checksum-2",
          },
        ]),
      /different checksum/u,
    );
  });

  test("fails closed instead of waiting on hosted web contract migration lock contention", async () => {
    const database = new FakeContractMigrationDatabase({
      advisoryLockAcquired: false,
    });
    const migration: HostedWebContractMigration = {
      checksum: "checksum-1",
      id: "20260707180000_drop_legacy_column",
      sql: 'ALTER TABLE "hosted_member_routing" DROP COLUMN IF EXISTS "legacy";',
      sqlPath: "migration.sql",
    };

    await assert.rejects(
      () => applyHostedWebContractMigrations(database, [migration]),
      /lock is already held/u,
    );
    assert.ok(
      database.queries.some((query) => query.includes("pg_try_advisory_xact_lock")),
    );
    assert.ok(
      !database.queries.some((query) =>
        /\bpg_advisory_xact_lock\s*\(/u.test(query),
      ),
      "contract migrations must not wait on the advisory lock",
    );
    assert.ok(!database.queries.includes(migration.sql));
    assert.ok(database.queries.includes("ROLLBACK"));
  });

  test("resolves current Vercel production alias SHA from provider-shaped JSON", async () => {
    const environment = {
      HOSTED_WEB_PRODUCTION_BASE_URL: "https://www.withmurph.ai",
      HOSTED_WEB_VERCEL_PROJECT_ID: "project-id",
      HOSTED_WEB_VERCEL_TEAM_ID: "team-id",
      HOSTED_WEB_VERCEL_TOKEN: "token",
    };
    const aliasUrl =
      "https://api.vercel.com/v4/aliases/www.withmurph.ai?projectId=project-id&teamId=team-id";
    const cases = [
      {
        aliasResponse: { deploymentId: "dpl_direct" },
        deploymentUrl:
          "https://api.vercel.com/v13/deployments/dpl_direct?withGitRepoInfo=true&teamId=team-id",
      },
      {
        aliasResponse: { deployment: { id: "dpl_nested" } },
        deploymentUrl:
          "https://api.vercel.com/v13/deployments/dpl_nested?withGitRepoInfo=true&teamId=team-id",
      },
      {
        aliasResponse: { deployment: { url: "murph-abc.vercel.app" } },
        deploymentUrl:
          "https://api.vercel.com/v13/deployments/murph-abc.vercel.app?withGitRepoInfo=true&teamId=team-id",
      },
    ];

    for (const testCase of cases) {
      const requests: Array<{
        authorization: string | undefined;
        url: string;
      }> = [];
      const resolvedSha = await resolveVercelProductionAliasSha(
        environment,
        async (url, init) => {
          requests.push({
            authorization:
              init?.headers === undefined
                ? undefined
                : new Headers(init.headers).get("authorization") ?? undefined,
            url,
          });

          if (url.includes("/v4/aliases/")) {
            return jsonFetchResponse(testCase.aliasResponse);
          }

          if (url.includes("/v13/deployments/")) {
            return jsonFetchResponse({
              gitSource: { sha: "sha-from-git-source" },
              meta: { githubCommitSha: "spoofed-meta-sha" },
            });
          }

          throw new Error(`Unexpected Vercel URL: ${url}`);
        },
      );

      assert.equal(resolvedSha, "sha-from-git-source");
      assert.deepEqual(requests, [
        {
          authorization: "Bearer token",
          url: aliasUrl,
        },
        {
          authorization: "Bearer token",
          url: testCase.deploymentUrl,
        },
      ]);
    }

    await assert.rejects(
      () =>
        resolveVercelProductionAliasSha(environment, async (url) => {
          if (url.includes("/v4/aliases/")) {
            return jsonFetchResponse({ deploymentId: "dpl_123" });
          }

          return jsonFetchResponse({
            meta: { githubCommitSha: "spoofed-meta-sha" },
          });
        }),
      /gitSource\.sha/u,
    );
  });

  test("requires Vercel protection for generated production deployment URLs", async () => {
    const environment = {
      HOSTED_WEB_PRODUCTION_BASE_URL: "https://www.withmurph.ai",
      HOSTED_WEB_VERCEL_PROJECT_ID: "project-id",
      HOSTED_WEB_VERCEL_TEAM_ID: "team-id",
      HOSTED_WEB_VERCEL_TOKEN: "token",
    };
    const projectUrl =
      "https://api.vercel.com/v9/projects/project-id?teamId=team-id";
    const protectedTypes = [
      "all_except_custom_domains",
      "prod_deployment_urls_and_all_previews",
    ];

    for (const deploymentType of protectedTypes) {
      const requests: Array<{
        authorization: string | undefined;
        url: string;
      }> = [];
      const result = await verifyVercelProductionDeploymentProtection(
        environment,
        async (url, init) => {
          requests.push({
            authorization:
              init?.headers === undefined
                ? undefined
                : new Headers(init.headers).get("authorization") ?? undefined,
            url,
          });
          if (url.includes("/v4/aliases/")) return jsonFetchResponse({ deploymentId: "dpl_123" });
          if (url.includes("/v13/deployments/")) return jsonFetchResponse({ projectId: "project-id" });
          return jsonFetchResponse({ ssoProtection: { deploymentType } });
        },
      );

      assert.equal(result, deploymentType);
      assert.equal(requests.length, 3);
    }

    for (const response of [
      {},
      { ssoProtection: null },
      { ssoProtection: { deploymentType: "all" } },
      { ssoProtection: { deploymentType: "preview" } },
    ]) {
      await assert.rejects(
        () =>
          verifyVercelProductionDeploymentProtection(
            environment,
            async (url) => {
              if (url.includes("/v4/aliases/")) return jsonFetchResponse({ deploymentId: "dpl_123" });
              if (url.includes("/v13/deployments/")) return jsonFetchResponse({ projectId: "project-id" });
              return jsonFetchResponse(response);
            },
          ),
        /Standard or All Except Custom Domains protection/u,
      );
    }
  });

  test("rejects an alias deployment from a different project before protection lookup", async () => {
    const environment = {
      HOSTED_WEB_PRODUCTION_BASE_URL: "https://www.withmurph.ai",
      HOSTED_WEB_VERCEL_PROJECT_ID: "expected-project",
      HOSTED_WEB_VERCEL_TOKEN: "token",
    };
    let projectRequested = false;
    await assert.rejects(
      () => verifyVercelProductionDeploymentProtection(environment, async (url) => {
        if (url.includes("/v4/aliases/")) return jsonFetchResponse({ deploymentId: "dpl_123" });
        if (url.includes("/v13/deployments/")) return jsonFetchResponse({ projectId: "actual-project" });
        projectRequested = true;
        return jsonFetchResponse({ ssoProtection: { deploymentType: "all_except_custom_domains" } });
      }),
      /different project/u,
    );
    assert.equal(projectRequested, false);
  });

  test("aborts a hung Vercel fetch at the bounded deadline", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const pendingFetch = (_url: string, init?: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      });
      const request = resolveVercelProductionAliasSha({
        HOSTED_WEB_PRODUCTION_BASE_URL: "https://www.withmurph.ai",
        HOSTED_WEB_VERCEL_PROJECT_ID: "project-id",
        HOSTED_WEB_VERCEL_TOKEN: "token",
      }, pendingFetch);
      const outcome = request.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(15_000);
      await assert.match((await outcome as Error).message, /timed out after 15000ms/u);
      assert.equal(aborted, true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps package build non-mutating and keeps Vercel deploy migrations automatic", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(appRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const vercelJson = JSON.parse(
      await readFile(path.join(appRoot, "vercel.json"), "utf8"),
    ) as {
      buildCommand?: string;
    };
    const verifyFastScript = await readFile(
      path.join(appRoot, "scripts", "verify-fast.sh"),
      "utf8",
    );
    const productionNextBuildScript = await readFile(
      path.join(appRoot, "scripts", "run-production-next-build.sh"),
      "utf8",
    );

    const scripts = packageJson.scripts ?? {};
    const buildScript = scripts.build ?? "";
    const prismaBuildScript = scripts["prisma:generate:build"] ?? "";
    const typecheckScript = scripts.typecheck ?? "";
    const preparedTypecheckScript = scripts["typecheck:prepared"] ?? "";
    const watchTypecheckScript = scripts["typecheck:watch"] ?? "";
    const contractMigrationScript =
      scripts["release:production:contract-migrate"] ?? "";
    const releaseMigrationScript = scripts["release:production:migrate"] ?? "";
    const deploymentProtectionScript =
      scripts["release:production:verify-deployment-protection"] ?? "";

    assert.match(buildScript, /pnpm prisma:generate:build/u);
    assert.doesNotMatch(buildScript, /pnpm prisma:generate(?=\s|&&|$)/u);
    assert.equal(
      prismaBuildScript,
      "pnpm --dir ../.. exec tsx apps/web/scripts/prepare-prisma-client-for-build.ts",
    );
    assert.match(buildScript, /pnpm typecheck:prepared/u);
    assert.match(buildScript, /bash scripts\/run-production-next-build\.sh/u);
    assert.doesNotMatch(buildScript, /&& next build &&/u);
    assert.equal(
      typecheckScript,
      "pnpm health-commons:generate && pnpm prisma:generate && pnpm typecheck:prepared",
    );
    assert.equal(
      preparedTypecheckScript,
      "pnpm --dir ../.. exec tsx scripts/ensure-next-route-type-stubs.ts apps/web && node ../../scripts/run-typescript.mjs web -p tsconfig.json --pretty false",
    );
    assert.equal(
      watchTypecheckScript,
      "pnpm health-commons:generate && pnpm prisma:generate && pnpm --dir ../.. exec tsx scripts/ensure-next-route-type-stubs.ts apps/web && node ../../scripts/run-typescript.mjs watch -p tsconfig.json --pretty false --watch --tsBuildInfoFile typecheck.watch.tsbuildinfo",
    );
    assert.match(
      buildScript,
      /pnpm typecheck:prepared && bash scripts\/run-production-next-build\.sh/u,
    );
    assert.match(
      buildScript,
      /^node \.\.\/\.\.\/scripts\/run-with-host-verification-slot\.mjs 'apps\/web build' -- bash -c /u,
    );
    assert.match(productionNextBuildScript, /^#!\/usr\/bin\/env bash\nset -euo pipefail$/mu);
    assert.match(productionNextBuildScript, /parent_old_space_mb=1024/u);
    assert.match(productionNextBuildScript, /typecheck_worker_old_space_mb=3072/u);
    assert.match(
      productionNextBuildScript,
      /sed -E 's\/\(\^\|\[\[:space:\]\]\)--max\[-_\]old\[-_\]space\[-_\]size/u,
    );
    assert.match(
      productionNextBuildScript,
      /require\.resolve\("next\/dist\/bin\/next"\)/u,
    );
    assert.match(
      productionNextBuildScript,
      /exec node "--max-old-space-size=\$parent_old_space_mb" "\$next_bin" build/u,
    );
    assert.doesNotMatch(productionNextBuildScript, /--webpack/u);
    assert.match(
      verifyFastScript,
      /local next_build_command=\(bash "\$script_dir\/run-production-next-build\.sh"\)/u,
    );
    assert.doesNotMatch(buildScript, /migrate:production/u);
    assert.doesNotMatch(buildScript, /release:production:contract-migrate/u);
    assert.doesNotMatch(buildScript, /release:production:migrate/u);
    assert.doesNotMatch(buildScript, /run-production-migrations/u);
    assert.ok(
      buildScript.indexOf("pnpm prisma:generate:build") <
        buildScript.indexOf("run-production-next-build.sh"),
      "non-mutating build prep must finish before next build",
    );
    assert.ok(
      buildScript.indexOf("pnpm typecheck:prepared") <
        buildScript.indexOf("run-production-next-build.sh"),
      "the TypeScript 7 source check must finish before Next validates its generated contracts",
    );
    assert.match(verifyFastScript, /^set -euo pipefail$/mu);
    assert.match(
      verifyFastScript,
      /run_timed_step "TypeScript 7 typecheck" run_typescript_typecheck/u,
    );
    assert.match(
      verifyFastScript,
      /hosted_web_verify_skip_typecheck="\$\{MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK:-0\}"/u,
    );
    assert.match(
      verifyFastScript,
      /MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK must be 0 or 1/u,
    );
    assert.match(
      verifyFastScript,
      /run_typescript_typecheck\(\) \{[\s\S]*?"\$hosted_web_verify_skip_typecheck" == "1"[\s\S]*?return 0[\s\S]*?pnpm typecheck:prepared[\s\S]*?\n\}/u,
    );
    assert.equal(
      verifyFastScript.match(/run_timed_step "next build" run_next_build/gu)?.length,
      3,
      "skipping the TypeScript 7 source check must preserve every Next build path",
    );
    const artifactLockGuardIndex = verifyFastScript.indexOf(
      'if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]]',
    );
    const hostSlotGuardIndex = verifyFastScript.indexOf(
      'if [[ "$shared_host_mode" == "1" && "${MURPH_VERIFY_HOST_SLOT_HELD:-0}" != "1" ]]',
    );
    assert.ok(artifactLockGuardIndex >= 0, "workspace artifact-lock guard must remain present");
    assert.ok(
      hostSlotGuardIndex > artifactLockGuardIndex,
      "shared-host admission must happen inside the workspace artifact lock",
    );
    assert.ok(
      verifyFastScript.includes(
        'verify_step_parallel_default="$([[ -n "${CI:-}" || "$shared_host_mode" == "1" ]] && echo 0 || echo 1)"',
      ),
      "shared-host verification must default its internal steps to serial execution",
    );
    assert.match(
      verifyFastScript,
      /-z "\$\{CI:-\}" && -n "\$\{CODEX_THREAD_ID:-\}"/u,
      "Codex app verification must join shared-host admission by default",
    );
    assert.equal(
      contractMigrationScript,
      "pnpm --dir ../.. exec tsx apps/web/scripts/run-production-contract-migrations.ts",
    );
    assert.equal(
      releaseMigrationScript,
      // The migration entrypoint imports @murphai/hosted-execution/env at
      // module load, and on Vercel migrations run before `pnpm build`, so the
      // package's dist output must be built first or the deploy fails.
      "pnpm --dir ../../packages/hosted-execution build && pnpm --dir ../.. exec tsx apps/web/scripts/run-production-migrations.ts",
    );
    assert.equal(
      deploymentProtectionScript,
      "pnpm --dir ../.. exec tsx apps/web/scripts/verify-vercel-production-deployment-protection.ts",
    );
    assert.equal(
      vercelJson.buildCommand,
      "pnpm release:production:migrate && MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS=1 pnpm build",
    );
    assert.equal(scripts["migrate:production:prebuild"], undefined);
    assert.equal(
      scripts["prisma:migrate:deploy"],
      "pnpm --dir ../.. exec tsx apps/web/scripts/run-prisma-migrate-deploy.ts",
    );
    assert.deepEqual(hostedWebPrismaMigrateDeployCommand.args, [
      "--dir",
      "apps/web",
      "exec",
      "prisma",
      "migrate",
      "deploy",
    ]);
  });

  test("runs hosted web contract migrations after successful production deployment status", async () => {
    const workflowRoot = path.resolve(appRoot, "..", "..");
    const workflow = await readFile(
      path.join(workflowRoot, ".github/workflows/hosted-web-contract-migrations.yml"),
      "utf8",
    );

    assert.match(workflow, /deployment_status/u);
    assert.match(workflow, /workflow_dispatch/u);
    assert.match(workflow, /deployed_sha/u);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch'/u);
    assert.match(workflow, /github\.event\.deployment_status\.state == 'success'/u);
    assert.match(
      workflow,
      /github\.event\.deployment_status\.description == 'Deployment has completed'/u,
    );
    assert.match(workflow, /deployment_status\.creator\.login == 'vercel\[bot\]'/u);
    assert.match(workflow, /deployment\.creator\.login == 'vercel\[bot\]'/u);
    assert.match(workflow, /environment: production/u);
    assert.match(workflow, /timeout-minutes: 20/u);
    assert.doesNotMatch(workflow, /concurrency:/u);
    assert.doesNotMatch(workflow, /cancel-in-progress/u);
    assert.doesNotMatch(workflow, /hosted-web-contract-migrations-production/u);
    assert.match(workflow, /github\.event\.deployment\.sha \|\| inputs\.deployed_sha/u);
    assert.match(workflow, /fetch-depth: 0/u);
    assert.match(workflow, /git merge-base --is-ancestor "\$\{DEPLOYED_SHA\}" origin\/main/u);
    assert.match(
      workflow,
      /resolve-vercel-production-alias-sha\.ts/u,
    );
    assert.doesNotMatch(workflow, /alias_host=/u);
    assert.doesNotMatch(workflow, /alias_url=/u);
    assert.doesNotMatch(workflow, /data\?\.meta\?\.githubCommitSha/u);
    assert.doesNotMatch(workflow, /meta\.githubCommitSha/u);
    assert.match(workflow, /HOSTED_WEB_VERCEL_TOKEN/u);
    assert.match(workflow, /HOSTED_WEB_VERCEL_PROJECT_ID/u);
    assert.match(workflow, /HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS/u);
    assert.match(
      workflow,
      /vars\.HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS \|\| '300'/u,
    );
    assert.match(
      workflow,
      /sleep "\$\{HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS\}"/u,
    );
    assert.match(
      workflow,
      /steps\.production-branch\.outputs\.should_run == 'true'/u,
    );
    assert.match(workflow, /steps\.current-production\.outputs\.should_apply == 'true'/u);
    assert.doesNotMatch(workflow, /deployment\.ref == 'main'/u);
    assert.match(workflow, /release:production:contract-migrate/u);

    const productionProofStep = extractWorkflowStep(
      workflow,
      "Verify current Vercel production deployment",
    );
    const contractMigrationStep = extractWorkflowStep(
      workflow,
      "Apply contract migrations",
    );
    assert.match(productionProofStep, /id: current-production/u);
    assert.match(productionProofStep, /HOSTED_WEB_VERCEL_TOKEN/u);
    assert.match(productionProofStep, /resolve-vercel-production-alias-sha\.ts/u);
    assert.match(productionProofStep, /echo "should_apply=true" >> "\$\{GITHUB_OUTPUT\}"/u);
    assert.match(productionProofStep, /echo "should_apply=false" >> "\$\{GITHUB_OUTPUT\}"/u);
    assert.doesNotMatch(productionProofStep, /HOSTED_WEB_DIRECT_DATABASE_URL/u);
    assert.doesNotMatch(productionProofStep, /DIRECT_DATABASE_URL/u);
    assert.match(
      contractMigrationStep,
      /steps\.current-production\.outputs\.should_apply == 'true'/u,
    );
    assert.match(contractMigrationStep, /HOSTED_WEB_VERCEL_TOKEN/u);
    assert.match(contractMigrationStep, /resolve-vercel-production-alias-sha\.ts/u);
    assert.match(contractMigrationStep, /-u DIRECT_DATABASE_URL/u);
    assert.match(
      contractMigrationStep,
      /-u MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS/u,
    );
    assert.match(
      contractMigrationStep,
      /-u MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS/u,
    );
    assert.match(
      contractMigrationStep,
      /DIRECT_DATABASE_URL: \$\{\{ secrets\.HOSTED_WEB_DIRECT_DATABASE_URL \}\}/u,
    );
    assert.match(
      contractMigrationStep,
      /MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "1"/u,
    );
    assert.match(
      contractMigrationStep,
      /MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS: "1"/u,
    );
    assert.match(contractMigrationStep, /release:production:contract-migrate/u);
    assert.ok(
      productionProofStep.indexOf('sleep "${HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS}"')
        < productionProofStep.indexOf('current_sha="$('),
      "contract migrations must wait for production drain before the final alias check",
    );
    assert.ok(
      contractMigrationStep.indexOf("-u DIRECT_DATABASE_URL")
        < contractMigrationStep.indexOf("resolve-vercel-production-alias-sha.ts"),
      "contract migration step must strip the database env before running the resolver",
    );
    assert.ok(
      contractMigrationStep.indexOf('current_sha="$(')
        < contractMigrationStep.indexOf('if [ "${current_sha}" != "${DEPLOYED_SHA}" ]; then'),
      "contract migration step must compare the fresh production alias SHA before SQL",
    );
    assert.ok(
      contractMigrationStep.indexOf('if [ "${current_sha}" != "${DEPLOYED_SHA}" ]; then')
        < contractMigrationStep.indexOf("release:production:contract-migrate"),
      "contract migrations must re-check the current production deployment SHA immediately before SQL",
    );
    assert.ok(
      workflow.indexOf('echo "should_apply=true" >> "${GITHUB_OUTPUT}"')
        < workflow.indexOf("release:production:contract-migrate"),
      "contract migrations must expose the database secret only after the alias proof output is set",
    );

    const nodeVersion = workflow.match(/node-version:\s*([^\s#]+)/u)?.[1] ?? "";
    const escapedNodeVersion = nodeVersion.replaceAll(".", "\\.");
    const workspaceConfig = await readFile(
      path.join(workflowRoot, "pnpm-workspace.yaml"),
      "utf8",
    );

    assert.doesNotMatch(workflow, /node-version-file/u);
    assert.match(nodeVersion, /^\d+\.\d+\.\d+$/u);
    assert.match(
      workspaceConfig,
      new RegExp(`^nodeVersion: ${escapedNodeVersion}$`, "mu"),
    );
  });

  test("registers only the approved Vercel cron routes", async () => {
    const vercelJson = JSON.parse(
      await readFile(path.join(appRoot, "vercel.json"), "utf8"),
    ) as {
      crons?: Array<{
        path?: string;
        schedule?: string;
      }>;
    };

    const cronPaths = (vercelJson.crons ?? []).map((cron) => cron.path).sort();

    assert.deepEqual(cronPaths, [
      "/api/internal/hosted-execution/product-feedback/digest/cron",
      "/api/internal/hosted-execution/retention/cron",
      "/api/internal/hosted-growth/snapshot/cron",
      "/api/internal/hosted-growth/usage-referral/cron",
      "/api/internal/hosted-onboarding/linq/contact-card/cron",
      "/api/internal/hosted-onboarding/linq/health/cron",
      "/api/internal/hosted-onboarding/stripe/cron",
      "/api/internal/hosted-runtime/latency-alert/cron",
    ]);
    assert.deepEqual(
      (vercelJson.crons ?? []).find(
        (cron) =>
          cron.path
            === "/api/internal/hosted-execution/product-feedback/digest/cron",
      ),
      {
        path: "/api/internal/hosted-execution/product-feedback/digest/cron",
        schedule: "*/10 * * * *",
      },
    );
    assert.deepEqual(
      (vercelJson.crons ?? []).find(
        (cron) =>
          cron.path === "/api/internal/hosted-runtime/latency-alert/cron",
      ),
      {
        path: "/api/internal/hosted-runtime/latency-alert/cron",
        schedule: "*/5 * * * *",
      },
    );
    assert.ok(!cronPaths.includes("/api/internal/device-sync/dirty-sweeper/cron"));
  });

  test("enables only production and the explicit Turbopack preview branch", async () => {
    const vercelJson = JSON.parse(
      await readFile(path.join(appRoot, "vercel.json"), "utf8"),
    ) as {
      git?: {
        deploymentEnabled?: Record<string, boolean>;
      };
    };

    assert.deepEqual(vercelJson.git?.deploymentEnabled, {
      main: true,
      "*": false,
    });
  });

  test("generates Prisma before direct local Next dev starts", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(appRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    const devLocalEnvScript = packageJson.scripts?.["dev:local-env"] ?? "";

    assert.match(devLocalEnvScript, /pnpm prisma:generate/u);
    assert.match(devLocalEnvScript, /apps\/web\/scripts\/dev-local\.ts/u);
    assert.ok(
      devLocalEnvScript.indexOf("pnpm prisma:generate")
        < devLocalEnvScript.indexOf("apps/web/scripts/dev-local.ts"),
      "Prisma client generation must finish before Next dev evaluates route modules",
    );
  });
});

async function writeMigrationSql(
  migrationsDir: string,
  migrationId: string,
  sql: string,
): Promise<void> {
  const migrationDir = path.join(migrationsDir, migrationId);
  await mkdir(migrationDir, { recursive: true });
  await writeFile(path.join(migrationDir, "migration.sql"), sql);
}

function extractWorkflowStep(workflow: string, stepName: string): string {
  const marker = `      - name: ${stepName}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow step was not found: ${stepName}`);

  const nextStep = workflow.indexOf("\n      - name: ", start + marker.length);
  return nextStep === -1 ? workflow.slice(start) : workflow.slice(start, nextStep);
}

function jsonFetchResponse(data: unknown): {
  ok: boolean;
  status: number;
  text(): Promise<string>;
} {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(data);
    },
  };
}

class FakeContractMigrationDatabase implements HostedWebContractMigrationClient {
  readonly checksums = new Map<string, string>();
  readonly queries: string[] = [];
  connected = false;
  ended = false;

  constructor(
    private readonly options: {
      advisoryLockAcquired?: boolean;
    } = {},
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  async query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(text);

    if (text.includes("is_canonical_owner")) {
      return {
        rows: [
          {
            is_canonical_owner: true,
            owns_prisma_migration_ledger: true,
            prisma_migration_ledger_exists: true,
          },
        ],
      };
    }

    if (text.includes("pg_try_advisory_xact_lock")) {
      return {
        rows: [{ acquired: this.options.advisoryLockAcquired ?? true }],
      };
    }

    if (text.includes("SELECT checksum")) {
      const migrationId = String(values?.[0] ?? "");
      const checksum = this.checksums.get(migrationId);

      return {
        rows: checksum === undefined ? [] : [{ checksum }],
      };
    }

    if (text.includes("INSERT INTO")) {
      this.checksums.set(String(values?.[0] ?? ""), String(values?.[1] ?? ""));
    }

    return { rows: [] };
  }
}
