import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test } from "vitest";

import {
  applyHostedWebContractMigrations,
  listHostedWebContractMigrations,
  runHostedWebProductionContractMigrationsIfNeeded,
  shouldRunHostedWebProductionContractMigrations,
  type HostedWebContractMigration,
  type HostedWebContractMigrationDatabase,
} from "../scripts/run-production-contract-migrations";
import {
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

  test("runs migrate, Prisma generate, and Linq line sync for main-branch production builds", async () => {
    const calls: Array<{ args: readonly string[]; command: string }> = [];

    const result = await runHostedWebProductionMigrationsIfNeeded(
      {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
      },
      async (command, args) => {
        calls.push({ args, command });
      },
    );

    assert.equal(result, "ran");
    assert.deepEqual(calls, [
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

  test("passes the selected direct migration URL to the Prisma child process", async () => {
    const calls: Array<{
      args: readonly string[];
      command: string;
      databaseUrl: string | undefined;
      directDatabaseUrl: string | undefined;
    }> = [];

    await runHostedWebPrismaMigrateDeploy(
      {
        DATABASE_URL: "postgresql://runtime.example.com:5432/app",
        DIRECT_DATABASE_URL: "postgresql://direct.example.com:5432/app",
      },
      async (command, args, environment) => {
        calls.push({
          args,
          command,
          databaseUrl: environment.DATABASE_URL,
          directDatabaseUrl: environment.DIRECT_DATABASE_URL,
        });
      },
    );

    assert.deepEqual(calls, [
      {
        command: hostedWebPrismaMigrateDeployCommand.command,
        args: hostedWebPrismaMigrateDeployCommand.args,
        databaseUrl: "postgresql://direct.example.com:5432/app",
        directDatabaseUrl: "postgresql://direct.example.com:5432/app",
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

    const scripts = packageJson.scripts ?? {};
    const buildScript = scripts.build ?? "";
    const contractMigrationScript =
      scripts["release:production:contract-migrate"] ?? "";
    const releaseMigrationScript = scripts["release:production:migrate"] ?? "";

    assert.match(buildScript, /pnpm prisma:generate/u);
    assert.match(buildScript, /next build/u);
    assert.doesNotMatch(buildScript, /migrate:production/u);
    assert.doesNotMatch(buildScript, /release:production:contract-migrate/u);
    assert.doesNotMatch(buildScript, /release:production:migrate/u);
    assert.doesNotMatch(buildScript, /run-production-migrations/u);
    assert.ok(
      buildScript.indexOf("pnpm prisma:generate") < buildScript.indexOf("next build"),
      "non-mutating build prep must finish before next build",
    );
    assert.equal(
      contractMigrationScript,
      "pnpm --dir ../.. exec tsx apps/web/scripts/run-production-contract-migrations.ts",
    );
    assert.equal(
      releaseMigrationScript,
      "pnpm --dir ../.. exec tsx apps/web/scripts/run-production-migrations.ts",
    );
    assert.equal(
      vercelJson.buildCommand,
      "pnpm release:production:migrate && pnpm build",
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
    assert.match(workflow, /github\.event\.deployment_status\.state == 'success'/u);
    assert.match(workflow, /deployment_status\.creator\.login == 'vercel\[bot\]'/u);
    assert.match(workflow, /deployment\.creator\.login == 'vercel\[bot\]'/u);
    assert.match(workflow, /timeout-minutes: 20/u);
    assert.doesNotMatch(workflow, /concurrency:/u);
    assert.doesNotMatch(workflow, /cancel-in-progress/u);
    assert.doesNotMatch(workflow, /hosted-web-contract-migrations-production/u);
    assert.match(workflow, /github\.event\.deployment\.sha/u);
    assert.match(workflow, /fetch-depth: 0/u);
    assert.match(workflow, /git merge-base --is-ancestor "\$\{DEPLOYED_SHA\}" origin\/main/u);
    assert.match(workflow, /https:\/\/api\.vercel\.com\/v4\/aliases\/\$\{alias_host\}/u);
    assert.match(workflow, /deployment\?\.meta\?\.githubCommitSha/u);
    assert.match(workflow, /HOSTED_WEB_VERCEL_TOKEN/u);
    assert.match(workflow, /HOSTED_WEB_VERCEL_PROJECT_ID/u);
    assert.match(workflow, /HOSTED_WEB_DIRECT_DATABASE_URL/u);
    assert.match(workflow, /DIRECT_DATABASE_URL="\$\{HOSTED_WEB_DIRECT_DATABASE_URL\}"/u);
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
    assert.doesNotMatch(workflow, /steps\.current-production/u);
    assert.doesNotMatch(workflow, /deployment\.ref == 'main'/u);
    assert.match(workflow, /release:production:contract-migrate/u);
    assert.ok(
      workflow.indexOf('sleep "${HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS}"')
        < workflow.indexOf('alias_response="$('),
      "contract migrations must wait for production drain before the final alias check",
    );
    assert.ok(
      workflow.indexOf('alias_response="$(')
        < workflow.indexOf("release:production:contract-migrate"),
      "contract migrations must re-check the current production alias before SQL",
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

  test("does not register device-sync recovery as a Vercel cron", async () => {
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
      "/api/internal/hosted-execution/retention/cron",
      "/api/internal/hosted-growth/snapshot/cron",
      "/api/internal/hosted-onboarding/linq/contact-card/cron",
      "/api/internal/hosted-onboarding/stripe/cron",
    ]);
    assert.ok(!cronPaths.includes("/api/internal/device-sync/dirty-sweeper/cron"));
  });

  test("Render worker startup ensures the Temporal device-sync schedule", async () => {
    const renderYaml = await readFile(
      path.resolve(appRoot, "..", "..", "render.yaml"),
      "utf8",
    );

    const ensureCommand =
      "temporal:ensure-device-sync-reconciler-schedule:prod";
    const workerCommand = "temporal:worker:prod";

    assert.match(renderYaml, new RegExp(ensureCommand, "u"));
    assert.match(renderYaml, new RegExp(workerCommand, "u"));
    assert.ok(
      renderYaml.indexOf(ensureCommand) < renderYaml.indexOf(workerCommand),
      "Render startup must ensure the Temporal Schedule before starting the worker.",
    );
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

class FakeContractMigrationDatabase implements HostedWebContractMigrationDatabase {
  readonly checksums = new Map<string, string>();
  readonly queries: string[] = [];

  async query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(text);

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
