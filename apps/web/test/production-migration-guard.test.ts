import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test } from "vitest";

import {
  hostedWebProductionLinqLineSyncCommand,
  hostedWebProductionMigrationCommand,
  runHostedWebProductionMigrationsIfNeeded,
  shouldRunHostedWebProductionMigrations,
  type HostedWebProductionMigrationEnvironment,
} from "../scripts/run-production-migrations";
import {
  hostedWebPrismaMigrateDeployCommand,
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

  test("runs prisma migrate deploy and Linq line sync for main-branch production builds", async () => {
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
        command: hostedWebProductionLinqLineSyncCommand.command,
        args: ["--dir", "apps/web", "linq:sync-lines", "--", "--skip-provider-inventory"],
      },
    ]);
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
    const releaseMigrationScript = scripts["release:production:migrate"] ?? "";

    assert.match(buildScript, /pnpm prisma:generate/u);
    assert.match(buildScript, /next build/u);
    assert.doesNotMatch(buildScript, /migrate:production/u);
    assert.doesNotMatch(buildScript, /release:production:migrate/u);
    assert.doesNotMatch(buildScript, /run-production-migrations/u);
    assert.ok(
      buildScript.indexOf("pnpm prisma:generate") < buildScript.indexOf("next build"),
      "non-mutating build prep must finish before next build",
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
