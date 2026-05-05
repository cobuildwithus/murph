import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test } from "vitest";

import {
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

  test("runs prisma migrate deploy for main-branch production builds", async () => {
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

  test("keeps the production migration hook before next build", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(appRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    const scripts = packageJson.scripts ?? {};
    const buildScript = scripts.build ?? "";
    const hookScript = scripts["migrate:production:prebuild"] ?? "";

    assert.match(buildScript, /pnpm migrate:production:prebuild/u);
    assert.match(buildScript, /pnpm prisma:generate/u);
    assert.match(buildScript, /next build/u);
    assert.ok(
      buildScript.indexOf("pnpm prisma:generate") < buildScript.indexOf("pnpm migrate:production:prebuild"),
      "non-mutating build prep must finish before production migrations run",
    );
    assert.ok(
      buildScript.indexOf("pnpm migrate:production:prebuild") < buildScript.indexOf("next build"),
      "production migration hook must run before next build",
    );
    assert.equal(
      hookScript,
      "pnpm --dir ../.. exec tsx apps/web/scripts/run-production-migrations.ts",
    );
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
});
